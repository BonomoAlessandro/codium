// App-Kern: besitzt den App-Zustand, die Fenster mit ihren Projekt-Kernen und den Vertrag mit der Oberfläche.
// Er entscheidet, welche Fenster beim Start aufgehen, dass ein Projekt nur einmal offen ist und wann Codium
// endet. Spätere Tickets ergänzen Einstellungen und Voraussetzungen. Lädt nie Electron.

import * as path from 'node:path';
import {
  ErrorCode,
  type AppInfo,
  type CommandName,
  type CommandParams,
  type CommandResult,
  type EventName,
  type Events,
  type ProjectInfo,
  type RecentProject,
  type WindowInfo,
} from '../../shared/types';
import { BufferedEventSink } from './bufferedEvents';
import type { EventSink, Ports, WindowPlacement } from './ports';
import { DEFAULT_CLEANUP_TIMEOUT_MS, ProjectCore } from './projectCore';
import { normalizeProjectPath, projectFolderExists, projectKey, projectName, projectStateFileName } from './projectPath';
import { CommandError, CommandRouter, type CallContext } from './router';
import {
  APP_STATE_FILE,
  PROJECT_STATE_DIR,
  RECENT_PROJECTS_LIMIT,
  SCHEMA_VERSION,
  emptyAppState,
  emptyProjectState,
  normalizeAppState,
  normalizeProjectState,
  type AppState,
  type ProjectState,
} from './schema';
import { StateFile } from './stateFile';
import { placeWindow } from './windowPlacement';

/** Titel des Willkommensfensters. */
export const WELCOME_TITLE = 'Welcome to Codium';

/** Titel eines Projektfensters, auch in der Taskleiste. */
export function projectWindowTitle(name: string): string {
  return `${name} – Codium`;
}

export interface AppCoreOptions {
  /** Datenordner (im Betrieb `%APPDATA%\Codium` bzw. `Codium-dev`, im Test ein Temp-Ordner). */
  dataDir: string;
  ports: Ports;
  events: EventSink;
  appInfo: AppInfo;
  /** Wartezeit für das entprellte Schreiben der Zustandsdateien. */
  saveDebounceMs?: number;
  /** Höchstdauer einer Aufräumarbeit beim Abbau eines Projekt-Kerns. */
  cleanupTimeoutMs?: number;
  log?: (message: string) => void;
}

export class AppCore {
  readonly router = new CommandRouter();
  readonly ports: Ports;
  private readonly events: BufferedEventSink;
  private readonly appStateFile: StateFile<AppState>;
  private appState: AppState;
  private readonly projects = new Map<number, ProjectCore>();
  /** Laufende Abbauten, nach Projektschlüssel: Beenden und Wiederöffnen warten auf sie. */
  private readonly disposals = new Map<string, Promise<void>>();
  private welcomeWindowId: number | null = null;
  /** Fenster in der Reihenfolge ihrer Benutzung, das zuletzt benutzte am Ende. */
  private windowOrder: number[] = [];
  /**
   * Codium wird beendet: Was jetzt offen ist, gilt als „beim Beenden offen“. Fenster, die sich ab hier schliessen,
   * ändern daran nichts mehr, und es öffnet sich nichts Neues.
   */
  private quitting = false;
  private readonly log: (message: string) => void;
  private shuttingDown: Promise<void> | null = null;

  constructor(private readonly options: AppCoreOptions) {
    this.ports = options.ports;
    this.log = options.log ?? ((message) => console.error(message));
    this.events = new BufferedEventSink(options.events);
    this.appStateFile = new StateFile(path.join(options.dataDir, APP_STATE_FILE), SCHEMA_VERSION, emptyAppState, {
      debounceMs: options.saveDebounceMs,
      normalize: normalizeAppState,
      onCorrupt: (backup, reason) => this.log(`App-Zustand unlesbar (${reason}), gesichert als ${backup}`),
      onError: (message) => this.log(message),
    });
    this.appState = this.appStateFile.load();

    // Lebenszyklus der Fenster: Ereignisse erst zustellen, wenn die Seite bereit ist; ein geschlossenes Fenster
    // baut seinen Projekt-Kern ab und kann Codium beenden.
    this.ports.windows.onReady((windowId) => this.events.markReady(windowId));
    this.ports.windows.onFocused((windowId) => this.markUsed(windowId));
    this.ports.windows.onClosed((windowId, lastPlacement) => this.windowClosed(windowId, lastPlacement));
    this.ports.windows.onSessionEnd(() => this.quit());
    this.registerCommands();
  }

  /** Eine Kopie des App-Zustands. */
  get state(): AppState {
    return structuredClone(this.appState);
  }

  /** Ändert den App-Zustand und speichert ihn entprellt. */
  updateState(mutate: (state: AppState) => void): void {
    const next = structuredClone(this.appState);
    mutate(next);
    this.appState = next;
    this.appStateFile.save(next);
  }

  /** Schickt ein Ereignis an ein Fenster, auch an eines ohne Projekt (etwa das Willkommensfenster). */
  emitToWindow<K extends EventName>(windowId: number, name: K, payload: Events[K]): void {
    this.events.send(windowId, name, payload);
  }

  /**
   * Start: öffnet die Projekte, die beim Beenden offen waren. Ein fehlender Projektordner wird übersprungen und
   * gemeldet. Bleibt kein Projekt offen, erscheint das Willkommensfenster.
   */
  async start(): Promise<void> {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const projectPath of this.appState.openProjects) {
      const key = projectKey(projectPath);
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.quitting) return;
      if (!projectFolderExists(projectPath)) {
        missing.push(projectPath);
        continue;
      }
      try {
        // Das Wiederöffnen ändert die Reihenfolge der zuletzt geöffneten Projekte nicht.
        await this.openProjectWindow(projectPath, false);
      } catch (err) {
        this.log(`Projekt ${projectPath} liess sich beim Start nicht öffnen: ${(err as Error).message}`);
      }
    }
    if (this.quitting) return;
    // Übersprungene Projekte gelten nicht mehr als offen; sie bleiben aber unter den zuletzt geöffneten.
    this.updateState((state) => {
      state.openProjects = state.openProjects.filter((p) => this.findProjectCore(p) !== undefined);
    });
    if (this.projects.size === 0) this.openWelcomeWindow();
    const target = this.lastUsedWindow();
    if (target === undefined) return;
    for (const projectPath of missing) {
      this.emitToWindow(target, 'app.notice', { level: 'error', text: `Project folder not found: ${projectPath}` });
    }
  }

  /**
   * Öffnet ein Projekt in einem neuen Fenster mit eigenem Projekt-Kern, in der gespeicherten Fensterlage. Ist das
   * Projekt schon offen (auch in anderer Schreibweise), kommt sein Fenster nach vorne. Ein offenes
   * Willkommensfenster schliesst sich danach.
   */
  openProject(projectPath: string): Promise<ProjectInfo> {
    return this.openProjectWindow(projectPath, true);
  }

  /** `openProject`; mit `remember = false` bleibt die Reihenfolge der zuletzt geöffneten Projekte, wie sie ist. */
  private async openProjectWindow(projectPath: string, remember: boolean): Promise<ProjectInfo> {
    this.assertNotQuitting();
    const normalized = normalizeProjectPath(projectPath);
    const open = this.focusIfOpen(normalized, remember);
    if (open) return open;
    if (!projectFolderExists(normalized)) {
      throw new CommandError(`Folder not found: ${normalized}`, ErrorCode.projectNotFound, { path: normalized });
    }
    await this.waitForDisposal(normalized);
    this.assertNotQuitting();
    // Während des Wartens kann dasselbe Projekt schon geöffnet worden sein, etwa nach einem Doppelklick.
    const openedMeanwhile = this.focusIfOpen(normalized, remember);
    if (openedMeanwhile) return openedMeanwhile;

    // Ab hier synchron: Zustand lesen, Fenster öffnen und Kern anlegen, damit nie ein Fenster ohne Kern dasteht.
    const { stateFile, state } = this.loadProjectState(normalized);
    const windowId = this.ports.windows.open({
      kind: 'project',
      title: projectWindowTitle(projectName(normalized)),
      placement: state.window ? placeWindow(state.window, this.ports.windows.displays()) : undefined,
    });
    this.markUsed(windowId);
    const core = this.createProjectCore(normalized, windowId, stateFile, state);
    this.rememberOpened(normalized, remember);
    this.closeWelcomeWindow();
    return core.info;
  }

  /**
   * Erzeugt den Projekt-Kern für ein Projekt in einem schon geöffneten Fenster und lädt seinen Zustand. Läuft für
   * dasselbe Projekt noch ein Abbau, wartet das Öffnen darauf, damit es den zuletzt gesicherten Stand liest. Ein
   * Projekt kann nur einmal offen sein; ein Fenster hat höchstens ein Projekt. Die Listen der offenen und der
   * zuletzt geöffneten Projekte bleiben unberührt; das übernimmt `openProject`.
   */
  async openProjectCore(projectPath: string, windowId: number): Promise<ProjectCore> {
    const normalized = normalizeProjectPath(projectPath);
    await this.waitForDisposal(normalized);
    if (this.shuttingDown) throw new Error('Codium wird beendet.');
    // Das Fenster kann geschlossen worden sein, während das Öffnen gewartet hat; dann kein Kern für ein totes Fenster.
    if (this.ports.windows.getBounds(windowId) === null) throw new Error(`Fenster ${windowId} ist nicht mehr offen.`);
    if (this.findProjectCore(normalized)) throw new Error(`Projekt ist schon offen: ${normalized}`);
    if (this.projects.has(windowId)) throw new Error(`Fenster ${windowId} hat schon ein Projekt.`);
    const { stateFile, state } = this.loadProjectState(normalized);
    return this.createProjectCore(normalized, windowId, stateFile, state);
  }

  /** Der Projekt-Kern eines Fensters, falls es eines hat. */
  projectCoreForWindow(windowId: number): ProjectCore | undefined {
    return this.projects.get(windowId);
  }

  /** Der Projekt-Kern eines Projekts, falls es offen ist (Pfadvergleich über den Projektschlüssel). */
  findProjectCore(projectPath: string): ProjectCore | undefined {
    const key = projectKey(projectPath);
    return [...this.projects.values()].find((core) => projectKey(core.path) === key);
  }

  /** Alle offenen Projekt-Kerne. */
  get projectCores(): ProjectCore[] {
    return [...this.projects.values()];
  }

  /** Baut den Projekt-Kern eines Fensters geordnet ab, etwa wenn das Fenster geschlossen wurde. */
  closeProjectCore(windowId: number): Promise<void> {
    const core = this.projects.get(windowId);
    if (!core) return Promise.resolve();
    this.projects.delete(windowId);
    const key = projectKey(core.path);
    const disposal = core.dispose().finally(() => {
      if (this.disposals.get(key) === disposal) this.disposals.delete(key);
    });
    this.disposals.set(key, disposal);
    return disposal;
  }

  /** Ein zweiter Start von Codium: Das zuletzt benutzte Fenster kommt nach vorne. */
  secondInstanceStarted(): void {
    if (this.quitting) return;
    const windowId = this.lastUsedWindow();
    if (windowId !== undefined) this.focusWindow(windowId);
  }

  /**
   * Beendet Codium mit allen offenen Projekten („Exit“, Abmelden von Windows, letztes Fenster geschlossen): Sie
   * gelten als „beim Beenden offen“. Der Abbau beginnt sofort und schreibt den Zustand noch im selben Aufruf, denn
   * beim Abmelden wartet Windows nicht lange. Danach wird die App beendet.
   */
  quit(): void {
    if (this.quitting) return;
    this.shutdown().catch((err: unknown) => this.log(`Beenden des Kerns fehlgeschlagen: ${(err as Error).message}`));
    this.ports.windows.quit();
  }

  /**
   * Beendet den Kern: sichert die Lage der offenen Fenster, baut alle Projekt-Kerne ab, wartet auch auf schon
   * laufende Abbauten und schreibt den App-Zustand sofort. Mehrfacher Aufruf liefert dasselbe Beenden.
   */
  shutdown(): Promise<void> {
    this.shuttingDown ??= (async () => {
      this.quitting = true;
      this.savePlacements();
      this.appStateFile.flush();
      const closing = [...this.projects.keys()].map((windowId) => this.closeProjectCore(windowId));
      await Promise.all([...closing, ...this.disposals.values()]);
      this.appStateFile.flush();
    })();
    return this.shuttingDown;
  }

  /**
   * Meldet einen Befehl an, der ein offenes Projekt braucht. Ohne Projekt im anfragenden Fenster oder während
   * des Abbaus scheitert er mit dem Code `NO_PROJECT`.
   */
  registerProjectCommand<K extends CommandName>(
    name: K,
    handler: (
      project: ProjectCore,
      params: CommandParams<K>,
      ctx: CallContext,
    ) => CommandResult<K> | Promise<CommandResult<K>>,
  ): void {
    this.router.register(name, (ctx, params) => {
      const project = this.projects.get(ctx.windowId);
      if (!project || project.disposed) throw new CommandError('Dieses Fenster hat kein offenes Projekt.', 'NO_PROJECT');
      return handler(project, params, ctx);
    });
  }

  private registerCommands(): void {
    this.router.register('app.info', () => this.options.appInfo);
    this.router.register('project.info', (ctx) => this.projects.get(ctx.windowId)?.info ?? null);
    this.router.register('window.info', (ctx) => this.windowInfo(ctx.windowId));
    this.router.register('app.recentProjects', () => this.recentProjects());
    this.router.register('app.openFolder', async (ctx) => {
      this.assertNotQuitting();
      const picked = await this.ports.folderPicker.pickFolder({ windowId: ctx.windowId, title: 'Open Folder' });
      return picked === null ? null : this.openProject(picked);
    });
    this.router.register('app.openProject', (_ctx, params) => this.openProject(requirePath(params)));
    this.router.register('app.removeRecentProject', (_ctx, params) => {
      const key = projectKey(requirePath(params));
      this.updateState((state) => {
        state.recentProjects = state.recentProjects.filter((p) => projectKey(p) !== key);
      });
      return this.recentProjects();
    });
    this.router.register('app.exit', () => this.quit());
  }

  private windowInfo(windowId: number): WindowInfo | null {
    if (windowId === this.welcomeWindowId) return { kind: 'welcome', title: WELCOME_TITLE };
    const core = this.projects.get(windowId);
    return core ? { kind: 'project', title: projectWindowTitle(core.name), project: core.info } : null;
  }

  private recentProjects(): RecentProject[] {
    return this.appState.recentProjects.map((p) => ({ path: p, name: projectName(p), exists: projectFolderExists(p) }));
  }

  /**
   * Ein Fenster ist zu. Ein Projektfenster, das neben anderen geschlossen wurde, öffnet beim nächsten Start nicht
   * wieder. Ist es das letzte Fenster, endet Codium; ein Projekt darin bleibt „offen“.
   */
  private windowClosed(windowId: number, lastPlacement: WindowPlacement | null): void {
    this.events.forget(windowId);
    this.windowOrder = this.windowOrder.filter((id) => id !== windowId);
    // Nur das Willkommensfenster und Projektfenster zählen fürs Beenden; ein Fenster, dessen Projekt-Kern noch
    // gar nicht steht, beendet nichts.
    const counts = windowId === this.welcomeWindowId || this.projects.has(windowId);
    if (windowId === this.welcomeWindowId) {
      this.welcomeWindowId = null;
      // Beim Beenden hat `shutdown` die Lage schon gesichert und den App-Zustand zum letzten Mal geschrieben.
      if (lastPlacement && !this.quitting) {
        this.updateState((state) => {
          state.welcomeWindow = lastPlacement;
        });
      }
    }
    const project = this.projects.get(windowId);
    if (project) {
      if (lastPlacement) {
        project.updateState((state) => {
          state.window = lastPlacement;
        });
      }
      if (!this.quitting && this.projects.size > 1) {
        const key = projectKey(project.path);
        this.updateState((state) => {
          state.openProjects = state.openProjects.filter((p) => projectKey(p) !== key);
        });
      }
      this.closeProjectCore(windowId).catch((err: unknown) =>
        this.log(`Abbau des Projekts in Fenster ${windowId} fehlgeschlagen: ${(err as Error).message}`),
      );
    }
    if (counts && !this.quitting && this.projects.size === 0 && this.welcomeWindowId === null) this.quit();
  }

  /** Sichert die Lage aller offenen Fenster in ihren Zuständen (im Testmodus meldet der Port keine Lage). */
  private savePlacements(): void {
    for (const core of this.projects.values()) {
      const placement = this.ports.windows.placement(core.windowId);
      if (placement) {
        core.updateState((state) => {
          state.window = placement;
        });
      }
    }
    const welcome = this.welcomeWindowId === null ? null : this.ports.windows.placement(this.welcomeWindowId);
    if (welcome) {
      this.updateState((state) => {
        state.welcomeWindow = welcome;
      });
    }
  }

  private openWelcomeWindow(): void {
    if (this.welcomeWindowId !== null) {
      this.focusWindow(this.welcomeWindowId);
      return;
    }
    const saved = this.appState.welcomeWindow;
    this.welcomeWindowId = this.ports.windows.open({
      kind: 'welcome',
      title: WELCOME_TITLE,
      placement: saved ? placeWindow(saved, this.ports.windows.displays()) : undefined,
    });
    this.markUsed(this.welcomeWindowId);
  }

  private closeWelcomeWindow(): void {
    if (this.welcomeWindowId !== null) this.ports.windows.close(this.welcomeWindowId);
  }

  /** Holt das Fenster eines offenen Projekts nach vorne und liefert das Projekt; `undefined`, wenn es nicht offen ist. */
  private focusIfOpen(normalized: string, remember: boolean): ProjectInfo | undefined {
    const core = this.findProjectCore(normalized);
    if (!core) return undefined;
    this.focusWindow(core.windowId);
    this.rememberOpened(core.path, remember);
    this.closeWelcomeWindow();
    return core.info;
  }

  private focusWindow(windowId: number): void {
    this.ports.windows.focus(windowId);
    this.markUsed(windowId);
  }

  private markUsed(windowId: number): void {
    this.windowOrder = [...this.windowOrder.filter((id) => id !== windowId), windowId];
  }

  private lastUsedWindow(): number | undefined {
    return this.windowOrder.at(-1);
  }

  /**
   * Führt ein Projekt als offen und setzt es an den Anfang der zuletzt geöffneten (ohne Doppelungen); mit
   * `recent = false` nur Ersteres.
   */
  private rememberOpened(normalized: string, recent: boolean): void {
    const key = projectKey(normalized);
    this.updateState((state) => {
      if (recent) {
        const others = state.recentProjects.filter((p) => projectKey(p) !== key);
        state.recentProjects = [normalized, ...others].slice(0, RECENT_PROJECTS_LIMIT);
      }
      if (!state.openProjects.some((p) => projectKey(p) === key)) state.openProjects.push(normalized);
    });
  }

  private async waitForDisposal(normalized: string): Promise<void> {
    const pending = this.disposals.get(projectKey(normalized));
    if (pending) await pending;
  }

  private assertNotQuitting(): void {
    if (this.quitting) throw new CommandError('Codium is shutting down.', ErrorCode.shuttingDown);
  }

  private loadProjectState(normalized: string): { stateFile: StateFile<ProjectState>; state: ProjectState } {
    const stateFile = new StateFile<ProjectState>(
      path.join(this.options.dataDir, PROJECT_STATE_DIR, projectStateFileName(normalized)),
      SCHEMA_VERSION,
      () => emptyProjectState(normalized),
      {
        debounceMs: this.options.saveDebounceMs,
        normalize: (raw) => normalizeProjectState(normalized, raw),
        onCorrupt: (backup, reason) => this.log(`Projekt-Zustand unlesbar (${reason}), gesichert als ${backup}`),
        onError: (message) => this.log(message),
      },
    );
    return { stateFile, state: stateFile.load() };
  }

  private createProjectCore(
    normalized: string,
    windowId: number,
    stateFile: StateFile<ProjectState>,
    state: ProjectState,
  ): ProjectCore {
    const core = new ProjectCore(
      normalized,
      windowId,
      stateFile,
      this.events,
      this.log,
      this.options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
      state,
    );
    this.projects.set(windowId, core);
    return core;
  }
}

/** Der Pfad aus den Parametern eines Befehls; die Oberfläche ist eigener Code, geprüft wird trotzdem. */
function requirePath(params: unknown): string {
  const value = (params as { path?: unknown } | undefined)?.path;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CommandError('Ein Pfad wird erwartet.', ErrorCode.invalidParams);
  }
  return value;
}
