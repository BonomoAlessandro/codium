// App-Kern: besitzt den App-Zustand, die Projekt-Kerne und den Vertrag mit der Oberfläche. Spätere Tickets
// ergänzen Fenster, Projekte, Einstellungen und Voraussetzungen. Lädt nie Electron.

import * as path from 'node:path';
import type { AppInfo, CommandName, CommandParams, CommandResult, EventName, Events } from '../../shared/types';
import { BufferedEventSink } from './bufferedEvents';
import type { EventSink, Ports } from './ports';
import { DEFAULT_CLEANUP_TIMEOUT_MS, ProjectCore } from './projectCore';
import { normalizeProjectPath, projectKey, projectStateFileName } from './projectPath';
import { CommandError, CommandRouter, type CallContext } from './router';
import {
  APP_STATE_FILE,
  PROJECT_STATE_DIR,
  SCHEMA_VERSION,
  emptyAppState,
  emptyProjectState,
  normalizeAppState,
  normalizeProjectState,
  type AppState,
  type ProjectState,
} from './schema';
import { StateFile } from './stateFile';

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
    // baut seinen Projekt-Kern ab.
    this.ports.windows.onReady((windowId) => this.events.markReady(windowId));
    this.ports.windows.onClosed((windowId) => {
      this.events.forget(windowId);
      this.closeProjectCore(windowId).catch((err: unknown) =>
        this.log(`Abbau des Projekts in Fenster ${windowId} fehlgeschlagen: ${(err as Error).message}`),
      );
    });
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
   * Erzeugt den Projekt-Kern für ein Projekt in einem Fenster und lädt seinen Zustand. Läuft für dasselbe Projekt
   * noch ein Abbau, wartet das Öffnen darauf, damit es den zuletzt gesicherten Stand liest. Ein Projekt kann nur
   * einmal offen sein; ein Fenster hat höchstens ein Projekt.
   */
  async openProjectCore(projectPath: string, windowId: number): Promise<ProjectCore> {
    const normalized = normalizeProjectPath(projectPath);
    const key = projectKey(normalized);
    const pendingDisposal = this.disposals.get(key);
    if (pendingDisposal) await pendingDisposal;
    if (this.shuttingDown) throw new Error('Codium wird beendet.');
    // Das Fenster kann geschlossen worden sein, während das Öffnen gewartet hat; dann kein Kern für ein totes Fenster.
    if (this.ports.windows.getBounds(windowId) === null) throw new Error(`Fenster ${windowId} ist nicht mehr offen.`);
    if (this.findProjectCore(normalized)) throw new Error(`Projekt ist schon offen: ${normalized}`);
    if (this.projects.has(windowId)) throw new Error(`Fenster ${windowId} hat schon ein Projekt.`);
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
    const core = new ProjectCore(
      normalized,
      windowId,
      stateFile,
      this.events,
      this.log,
      this.options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
    );
    this.projects.set(windowId, core);
    return core;
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

  /**
   * Beendet den Kern: baut alle Projekt-Kerne ab, wartet auch auf schon laufende Abbauten und schreibt den
   * App-Zustand sofort. Mehrfacher Aufruf liefert dasselbe Beenden.
   */
  shutdown(): Promise<void> {
    this.shuttingDown ??= (async () => {
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
  }
}
