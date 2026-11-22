// App-Kern: besitzt den App-Zustand, die Fenster mit ihren Projekt-Kernen und den Vertrag mit der Oberfläche.
// Er entscheidet, welche Fenster beim Start aufgehen, dass ein Projekt nur einmal offen ist und wann Codium
// endet. Er besitzt die Einstellungen (ab Ticket 05 die Schriftgrösse) und schickt Änderungen an alle Fenster.
// Spätere Tickets ergänzen Voraussetzungen. Lädt nie Electron.
//
// Abfragen auf Projektordnern laufen asynchron, mit Zeitlimit und mit Rücksicht auf nicht erreichbare
// Netzlaufwerke (siehe folderQueries.ts). Vergleiche von Projektpfaden gehen ohne Dateizugriff über einen
// Zwischenspeicher der echten Schlüssel.

import * as path from 'node:path';
import {
  ErrorCode,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type AppInfo,
  type AppSettings,
  type CommandName,
  type CommandParams,
  type CommandResult,
  type EventName,
  type Events,
  type Notice,
  type ProjectInfo,
  type RecentProject,
  type WindowInfo,
} from '../../shared/types';
import { BufferedEventSink } from './bufferedEvents';
import type { EventSink, Ports, WindowPlacement } from './ports';
import { ProgressReporter } from './progress';
import { DEFAULT_CLEANUP_TIMEOUT_MS, ProjectCore } from './projectCore';
import { FolderQueries, type FolderStatus } from './folderQueries';
import { startClone, type CloneJob } from './clone';
import { detectShells, shellFor } from './shells';
import { registerEditorCommands } from './editorCommands';
import { JDTLS_MIN_JAVA, detectJdks, hasJavaMarkers, jdkForLanguageServer, sameJdkPath } from './jdks';
import { registerFileCommands } from './fileCommands';
import {
  isAbsoluteCommandPath,
  lexicalProjectKey,
  normalizeProjectPath,
  projectName,
  projectStateFileName,
} from './projectPath';
import { CommandError, CommandRouter, type CallContext } from './router';
import {
  APP_STATE_FILE,
  PROJECT_STATE_DIR,
  RECENT_PROJECTS_LIMIT,
  SCHEMA_VERSION,
  appSettings,
  defaultLayout,
  isFontSize,
  isJdkPath,
  isShellId,
  emptyAppState,
  emptyProjectState,
  normalizeAppState,
  normalizeProjectState,
  parseLayout,
  type AppState,
  type ProjectState,
} from './schema';
import { StateFile } from './stateFile';
import { cascadeFrom, placeWindow } from './windowPlacement';

/** So lange wartet der Kern höchstens, bis ein Fenster vor dem Schliessen oder Beenden seine Tabs gespeichert hat. */
export const DEFAULT_FLUSH_TIMEOUT_MS = 3000;

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
  /** Zeitlimit einer Abfrage auf einem Projektordner; danach gilt sein Laufwerk eine Weile als nicht erreichbar. */
  folderQueryTimeoutMs?: number;
  /**
   * Zeitlimit für das Speichern der Tabs eines Fensters vor dem Schliessen oder Beenden (Standard 3 s); 0 heisst:
   * nicht fragen (für Tests ohne Oberfläche).
   */
  flushTimeoutMs?: number;
  /** Wartezeiten der Dateiüberwachung (siehe fileWatcher.ts). */
  watchDebounceMs?: number;
  watchMaxDelayMs?: number;
  /** Ab dieser Dauer zeigt eine Dateioperation Fortschritt (siehe fileService.ts). */
  fileProgressDelayMs?: number;
  /** Pfad zu ripgrep (mitgeliefert, im Paket ausserhalb des App-Archivs). */
  ripgrepPath: string;
  /** Terminals gleich über die ConPTY von Windows statt der mitgelieferten (Tests des Rückfallwegs). */
  windowsConpty?: boolean;
  /** Pfad zum mitgelieferten README (im Paket ausserhalb des App-Archivs), für „Open README“. */
  readmePath?: string;
  /** Umgebung für gestartete Programme (Git); ohne Angabe die des Prozesses. Tests schirmen damit die Git-Konfiguration ab. */
  processEnv?: NodeJS.ProcessEnv;
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
  /** Echte Schlüssel schon aufgelöster Projektpfade, nach dem Schlüssel ohne Dateizugriff. */
  private readonly realKeys = new Map<string, string>();
  private readonly folders: FolderQueries;
  private welcomeWindowId: number | null = null;
  /** Fenster in der Reihenfolge ihrer Benutzung, das zuletzt benutzte am Ende. */
  private windowOrder: number[] = [];
  /**
   * Codium wird beendet: Was jetzt offen ist, gilt als „beim Beenden offen“. Fenster, die sich ab hier schliessen,
   * ändern daran nichts mehr, und es öffnet sich nichts Neues.
   */
  private quitting = false;
  /** Während des Beendens kam ein zweiter Start: Codium startet nach dem Beenden neu. */
  private relaunchRequested = false;
  private readonly log: (message: string) => void;
  private shuttingDown: Promise<void> | null = null;
  /** Laufende Klone je Fenster; beim Beenden werden sie abgebrochen (sonst liefe Git verwaist weiter). */
  private readonly clones = new Map<CloneJob, { windowId: number; target: string }>();
  /** Das gefundene Git (Pfad), `null` ohne Git: Die Git-Funktionen bleiben dann aus (ab Ticket 15). */
  readonly gitPath: string | null;

  constructor(private readonly options: AppCoreOptions) {
    this.ports = options.ports;
    this.log = options.log ?? ((message) => console.error(message));
    this.folders = new FolderQueries({ timeoutMs: options.folderQueryTimeoutMs });
    this.events = new BufferedEventSink(options.events);
    this.appStateFile = new StateFile(path.join(options.dataDir, APP_STATE_FILE), SCHEMA_VERSION, emptyAppState, {
      debounceMs: options.saveDebounceMs,
      normalize: normalizeAppState,
      onCorrupt: (backup, reason) => this.log(`App-Zustand unlesbar (${reason}), gesichert als ${backup}`),
      onError: (message) => this.log(message),
    });
    this.appState = this.appStateFile.load();
    // Voraussetzungen: Git beim Start (für alle Projekte), das JDK erst beim Öffnen eines Java-Projekts.
    this.gitPath = this.ports.system.findProgram('git');

    // Lebenszyklus der Fenster: Ereignisse erst zustellen, wenn die Seite bereit ist; ein geschlossenes Fenster
    // baut seinen Projekt-Kern ab und kann Codium beenden.
    this.ports.windows.onReady((windowId) => this.events.markReady(windowId));
    this.ports.windows.onFocused((windowId) => this.markUsed(windowId));
    this.ports.windows.onClosed((windowId, lastPlacement) => this.windowClosed(windowId, lastPlacement));
    this.ports.windows.onSessionEnd(() => void this.quit());
    this.ports.windows.onCloseRequested((windowId) => this.closeRequested(windowId));
    this.registerCommands();
  }

  /** Der Projekt-Kern eines Fensters (für Tests, etwa um laufende Sprachserver zu prüfen). */
  projectCore(windowId: number): ProjectCore | undefined {
    return this.projects.get(windowId);
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

  /** Zeigt eine Meldung in einem Fenster, auch in einem ohne Projekt. Für Projektfenster gibt es `ProjectCore.notify`. */
  notifyWindow(windowId: number, notice: Notice): void {
    this.emitToWindow(windowId, 'app.notice', notice);
  }

  /**
   * Fortschritt für die Statusleiste eines Fensters, auch eines ohne Projekt (etwa beim Klonen aus dem
   * Willkommensfenster). Für Projektfenster gibt es `ProjectCore.progress`.
   */
  progressForWindow(windowId: number): ProgressReporter {
    return new ProgressReporter((event) => this.emitToWindow(windowId, 'app.progress', event));
  }

  /**
   * Start: öffnet die Projekte, die beim Beenden offen waren. Bleibt keines offen, erscheint das
   * Willkommensfenster. Übersprungene Projekte werden gemeldet:
   * - Ein fehlender Ordner fällt aus den beim Beenden offenen Projekten (er bleibt unter den zuletzt geöffneten).
   * - Ein nicht erreichbarer Ordner (etwa ein Netzlaufwerk, das noch nicht verbunden ist) wird nur diesmal
   *   übersprungen und beim nächsten Start wieder versucht.
   */
  async start(): Promise<void> {
    // Alle Ordner gleichzeitig prüfen; die Abfragen selbst sorgen dafür, dass ein nicht erreichbares Laufwerk nur
    // einmal das Zeitlimit kostet.
    const checks = await Promise.all(
      this.appState.openProjects.map(async (p) => {
        const normalized = normalizeProjectPath(p);
        const [key, status] = await Promise.all([this.keyOf(normalized), this.folders.folderStatus(normalized)]);
        return { normalized, key, status };
      }),
    );
    const skipped: Array<{ path: string; status: Exclude<FolderStatus, 'exists'> }> = [];
    const seen = new Set<string>();
    for (const { normalized, key, status } of checks) {
      if (this.quitting) return;
      if (seen.has(key)) continue;
      seen.add(key);
      if (status !== 'exists') {
        skipped.push({ path: normalized, status });
        continue;
      }
      try {
        // Das Wiederöffnen ändert die Reihenfolge der zuletzt geöffneten Projekte nicht.
        await this.openChecked(normalized, key, false);
      } catch (err) {
        this.log(`Projekt ${normalized} liess sich beim Start nicht öffnen: ${(err as Error).message}`);
      }
    }
    if (this.quitting) return;
    const retryLater = new Set(skipped.filter((s) => s.status === 'unreachable').map((s) => this.knownKey(s.path)));
    this.updateState((state) => {
      state.openProjects = state.openProjects.filter(
        (p) => this.findProjectCore(p) !== undefined || retryLater.has(this.knownKey(p)),
      );
    });
    if (this.projects.size === 0) this.openWelcomeWindow();
    const target = this.lastUsedWindow();
    if (target !== undefined) {
      for (const { path: projectPath, status } of skipped) this.notifyWindow(target, this.skippedNotice(projectPath, status));
    }
    // Erst jetzt, nach den Prüfungen fürs Wiederöffnen: die Schlüssel der zuletzt geöffneten Projekte im
    // Hintergrund auflösen, damit spätere Vergleiche auch Kurznamen und Junctions erkennen.
    void Promise.all(this.appState.recentProjects.map((p) => this.keyOf(p)));
  }

  /**
   * Meldung für ein beim Start übersprungenes Projekt. Ein fehlender Ordner, der noch unter den zuletzt geöffneten
   * steht, lässt sich gleich aus der Liste entfernen; ein nicht erreichbarer bleibt, er geht vielleicht bald wieder.
   */
  private skippedNotice(projectPath: string, status: Exclude<FolderStatus, 'exists'>): Notice {
    if (status === 'unreachable') return { level: 'error', text: `Project folder not reachable: ${projectPath}` };
    const key = this.knownKey(projectPath);
    const recent = this.appState.recentProjects.find((p) => this.knownKey(p) === key);
    return {
      level: 'error',
      text: `Project folder not found: ${projectPath}`,
      ...(recent === undefined
        ? {}
        : { actions: [{ label: 'Remove from List', action: 'recentProjects.remove', params: { path: recent } }] }),
    };
  }

  /**
   * Öffnet ein Projekt in einem neuen Fenster mit eigenem Projekt-Kern, in der gespeicherten Fensterlage. Ist das
   * Projekt schon offen (auch in anderer Schreibweise), kommt sein Fenster nach vorne. Ein offenes
   * Willkommensfenster schliesst sich danach.
   */
  openProject(projectPath: string): Promise<ProjectInfo> {
    return this.openProjectWindow(projectPath, true);
  }

  /**
   * Erzeugt den Projekt-Kern für ein Projekt in einem schon geöffneten Fenster und lädt seinen Zustand. Läuft für
   * dasselbe Projekt noch ein Abbau, wartet das Öffnen darauf, damit es den zuletzt gesicherten Stand liest. Ein
   * Projekt kann nur einmal offen sein; ein Fenster hat höchstens ein Projekt. Die Listen der offenen und der
   * zuletzt geöffneten Projekte bleiben unberührt; das übernimmt `openProject`.
   */
  async openProjectCore(projectPath: string, windowId: number): Promise<ProjectCore> {
    const normalized = normalizeProjectPath(projectPath);
    const key = await this.keyOf(normalized);
    await this.waitForDisposal(key);
    if (this.shuttingDown) throw new Error('Codium wird beendet.');
    // Das Fenster kann geschlossen worden sein, während das Öffnen gewartet hat; dann kein Kern für ein totes Fenster.
    if (!this.ports.windows.isOpen(windowId)) throw new Error(`Fenster ${windowId} ist nicht mehr offen.`);
    if (this.coreWithKey(key)) throw new Error(`Projekt ist schon offen: ${normalized}`);
    if (this.projects.has(windowId)) throw new Error(`Fenster ${windowId} hat schon ein Projekt.`);
    const { stateFile, state } = this.loadProjectState(normalized, key);
    return this.createProjectCore(normalized, windowId, stateFile, state);
  }

  /** Der Projekt-Kern eines Fensters, falls es eines hat. */
  projectCoreForWindow(windowId: number): ProjectCore | undefined {
    return this.projects.get(windowId);
  }

  /**
   * Der Projekt-Kern eines Projekts, falls es offen ist. Verglichen wird ohne Dateizugriff: über den echten
   * Schlüssel, soweit der Kern ihn schon kennt, sonst über den normalisierten Pfad.
   */
  findProjectCore(projectPath: string): ProjectCore | undefined {
    return this.coreWithKey(this.knownKey(projectPath));
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
    const key = this.knownKey(core.path);
    const disposal = core.dispose().finally(() => {
      if (this.disposals.get(key) === disposal) this.disposals.delete(key);
    });
    this.disposals.set(key, disposal);
    return disposal;
  }

  /**
   * Ein zweiter Start von Codium: Das zuletzt benutzte Fenster kommt nach vorne. Wird Codium gerade beendet, hält
   * es die Einzelinstanz-Sperre noch bis zum Ende des Abbaus, und der neue Start hat schon aufgegeben; dann
   * startet Codium nach dem Beenden neu.
   */
  secondInstanceStarted(): void {
    if (this.quitting) {
      if (this.relaunchRequested) return;
      this.relaunchRequested = true;
      this.ports.windows.quit({ relaunch: true });
      return;
    }
    const windowId = this.lastUsedWindow();
    if (windowId !== undefined) this.focusWindow(windowId);
  }

  /**
   * Beendet Codium mit allen offenen Projekten („Exit“, Abmelden von Windows, letztes Fenster geschlossen): Sie
   * gelten als „beim Beenden offen“. Der Abbau beginnt sofort und schreibt den Zustand noch im selben Aufruf, denn
   * beim Abmelden wartet Windows nicht lange. Danach wird die App beendet.
   */
  quit(): Promise<void> {
    if (this.quitting) return Promise.resolve();
    // Ab hier öffnet sich nichts mehr, und was offen ist, gilt als „beim Beenden offen“.
    this.quitting = true;
    const finish = () => {
      this.shutdown().catch((err: unknown) => this.log(`Beenden des Kerns fehlgeschlagen: ${(err as Error).message}`));
      this.ports.windows.quit();
    };
    // Erst speichern die Projektfenster ihre Tabs (höchstens bis zum Zeitlimit), dann endet der Kern.
    const windows = [...this.projects.keys()];
    if (windows.length === 0 || this.flushTimeoutMs === 0) {
      finish();
      return Promise.resolve();
    }
    return this.flushWindows(windows).then(finish);
  }

  /** Zeitlimit für das Speichern der Tabs eines Fensters vor dem Schliessen oder Beenden; 0 heisst: nicht warten. */
  private get flushTimeoutMs(): number {
    return this.options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  }

  private flushCounter = 0;
  private readonly flushWaiters = new Map<number, () => void>();

  /**
   * Bittet Projektfenster, ihre Tabs zu speichern (`editor.flushRequest`), und wartet auf ihre Antworten, je höchstens
   * bis zum Zeitlimit. Fenster ohne Projekt werden übergangen.
   */
  private flushWindows(windowIds: number[]): Promise<void> {
    return Promise.all(
      windowIds
        .filter((id) => this.projects.has(id) && this.ports.windows.isOpen(id))
        .map(
          (windowId) =>
            new Promise<void>((resolve) => {
              const requestId = ++this.flushCounter;
              const done = () => {
                clearTimeout(timer);
                this.flushWaiters.delete(requestId);
                resolve();
              };
              const timer = setTimeout(done, this.flushTimeoutMs);
              this.flushWaiters.set(requestId, done);
              this.emitToWindow(windowId, 'editor.flushRequest', { requestId });
            }),
        ),
    ).then(() => {});
  }

  /** Schliesst der Nutzer ein Projektfenster, speichert es vorher seine Tabs; sonst schliesst es sofort. */
  private closeRequested(windowId: number): Promise<void> | null {
    if (this.quitting || this.flushTimeoutMs === 0 || !this.projects.has(windowId)) return null;
    return this.flushWindows([windowId]);
  }

  /**
   * Beendet den Kern: sichert die Lage der offenen Fenster, baut alle Projekt-Kerne ab, wartet auch auf schon
   * laufende Abbauten und schreibt den App-Zustand sofort. Mehrfacher Aufruf liefert dasselbe Beenden.
   */
  shutdown(): Promise<void> {
    this.shuttingDown ??= (async () => {
      this.quitting = true;
      const cancelling = [...this.clones.keys()].map((job) => job.cancel());
      this.savePlacements();
      this.appStateFile.flush();
      const closing = [...this.projects.keys()].map((windowId) => this.closeProjectCore(windowId));
      await Promise.all([...closing, ...cancelling, ...this.disposals.values()]);
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
      if (!project || project.disposed) throw new CommandError('This window has no open project.', ErrorCode.noProject);
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
    this.router.register('app.openProject', (_ctx, params) => this.openProject(requireAbsolutePath(params)));
    this.router.register('app.removeRecentProject', async (_ctx, params) => {
      const key = await this.keyOf(requireAbsolutePath(params));
      this.updateState((state) => {
        state.recentProjects = state.recentProjects.filter((p) => this.knownKey(p) !== key);
      });
      return this.recentProjects();
    });
    this.router.register('app.exit', () => this.quit());
    this.registerProjectCommand('project.layout', (project) => project.state.layout ?? defaultLayout());
    this.registerProjectCommand('project.setLayout', (project, params) => {
      const layout = parseLayout(params);
      if (!layout) throw new CommandError('The tool window layout is invalid.', ErrorCode.invalidParams);
      project.updateState((state) => {
        state.layout = layout;
      });
    });
    registerFileCommands((name, handler) => this.registerProjectCommand(name, handler));
    registerEditorCommands((name, handler) => this.registerProjectCommand(name, handler));
    this.router.register('app.settings', () => appSettings(this.appState.settings));
    this.router.register('app.jdks', () => {
      const jdks = detectJdks(this.ports.system);
      return { jdks, forLanguageServer: jdkForLanguageServer(jdks, this.appState.settings.jdk ?? null) };
    });
    this.router.register('app.prerequisites', () => ({ git: this.gitPath !== null }));
    this.router.register('app.cloneDefaults', () => ({ parent: this.appState.cloneParent ?? this.ports.system.homeDir() }));
    this.router.register('app.pickFolder', (ctx, params) => {
      const title = (params as { title?: unknown } | undefined)?.title;
      return this.ports.folderPicker.pickFolder({ windowId: ctx.windowId, title: typeof title === 'string' ? title : 'Select Folder' });
    });
    this.router.register('app.clone', (ctx, params) => this.clone(ctx.windowId, params));
    this.router.register('app.cancelClone', async (ctx) => {
      await Promise.all([...this.clones].filter(([, c]) => c.windowId === ctx.windowId).map(([job]) => job.cancel()));
    });
    this.router.register('app.openExternal', async (_ctx, params) => {
      const url = (params as { url?: unknown } | undefined)?.url;
      // Nur Web- und Mail-Adressen; alles andere (etwa file:) wäre ein Weg, beliebige Programme zu starten.
      if (typeof url !== 'string' || !/^(https?:\/\/|mailto:)/i.test(url) || url.length > 8000) {
        throw new CommandError('Only web addresses (http, https) and mail addresses can be opened.', ErrorCode.invalidParams);
      }
      await this.ports.shell.openExternal(url);
    });
    this.router.register('app.readme', () => {
      const text = this.options.readmePath ? this.ports.system.readTextFile(this.options.readmePath) : null;
      if (text === null) throw new CommandError('The README that comes with Codium was not found.', ErrorCode.fileNotFound);
      return { text };
    });
    this.router.register('editor.flushed', (_ctx, params) => {
      const requestId = (params as { requestId?: unknown } | undefined)?.requestId;
      if (typeof requestId === 'number') this.flushWaiters.get(requestId)?.();
    });
    this.router.register('app.updateSettings', (_ctx, params) => this.updateSettings(params));
    this.router.register('app.shells', () => {
      const shells = detectShells(this.ports.system);
      return { shells, standard: shellFor(shells, undefined)?.id ?? null };
    });
  }

  /**
   * Ändert Einstellungen: Erst werden alle angegebenen Felder geprüft, dann gespeichert. Die neuen Einstellungen gehen
   * an alle Fenster, auch an das Willkommensfenster.
   */
  private updateSettings(params: unknown): AppSettings {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new CommandError('Settings are expected.', ErrorCode.invalidParams);
    }
    const changes = params as Record<string, unknown>;
    for (const name of Object.keys(changes)) {
      if (name !== 'fontSize' && name !== 'jdk' && name !== 'terminalShell') {
        throw new CommandError(`Unknown setting: ${name}`, ErrorCode.invalidParams);
      }
    }
    if ('jdk' in changes && changes.jdk !== null && !isJdkPath(changes.jdk)) {
      throw new CommandError('The JDK must be a folder (absolute path) or “Newest detected”.', ErrorCode.invalidParams);
    }
    // Wählbar sind nur erkannte JDKs ab 25; gespeichert wird ihr Pfad in der Schreibweise der Erkennung (Review von
    // Ticket 09). Ein früher gewähltes, inzwischen fehlendes bleibt im Zustand stehen, bis der Nutzer etwas anderes wählt.
    if (typeof changes.jdk === 'string') {
      const wanted = changes.jdk;
      const detected = detectJdks(this.ports.system).find((j) => j.major >= JDTLS_MIN_JAVA && sameJdkPath(j.path, wanted));
      if (!detected) {
        throw new CommandError(`The JDK must be one of the detected JDKs ${JDTLS_MIN_JAVA} or newer.`, ErrorCode.invalidParams);
      }
      changes.jdk = detected.path;
    }
    // Wählbar sind nur gefundene Shells; `null` heisst Standard.
    if ('terminalShell' in changes && changes.terminalShell !== null) {
      const wanted = changes.terminalShell;
      if (!detectShells(this.ports.system).some((s) => s.id === wanted)) {
        throw new CommandError('The terminal shell must be one of the detected shells.', ErrorCode.invalidParams);
      }
    }
    if ('fontSize' in changes && !isFontSize(changes.fontSize)) {
      throw new CommandError(
        `The font size must be a whole number from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.`,
        ErrorCode.invalidParams,
      );
    }
    this.updateState((state) => {
      if (isFontSize(changes.fontSize)) state.settings.fontSize = changes.fontSize;
      if (changes.jdk === null) delete state.settings.jdk;
      else if (isJdkPath(changes.jdk)) state.settings.jdk = changes.jdk;
      if (changes.terminalShell === null) delete state.settings.terminalShell;
      else if (isShellId(changes.terminalShell)) state.settings.terminalShell = changes.terminalShell;
    });
    const settings = appSettings(this.appState.settings);
    const windows = [...this.projects.keys(), ...(this.welcomeWindowId === null ? [] : [this.welcomeWindowId])];
    for (const windowId of windows) this.emitToWindow(windowId, 'app.settingsChanged', settings);
    return settings;
  }

  /** `openProject`; mit `remember = false` bleibt die Reihenfolge der zuletzt geöffneten Projekte, wie sie ist. */
  private async openProjectWindow(projectPath: string, remember: boolean): Promise<ProjectInfo> {
    this.assertNotQuitting();
    const normalized = normalizeProjectPath(projectPath);
    const key = await this.keyOf(normalized);
    this.assertNotQuitting();
    const open = this.focusIfOpen(key, remember);
    if (open) return open;
    const status = await this.folders.folderStatus(normalized);
    if (status === 'missing') {
      throw new CommandError(`Folder not found: ${normalized}`, ErrorCode.projectNotFound, { path: normalized });
    }
    if (status === 'unreachable') {
      throw new CommandError(`Folder not reachable: ${normalized}`, ErrorCode.projectUnreachable, { path: normalized });
    }
    return this.openChecked(normalized, key, remember);
  }

  /**
   * Öffnet ein Projekt, dessen Ordner schon geprüft ist: wartet auf einen laufenden Abbau desselben Projekts, dann
   * geht es synchron weiter.
   */
  private async openChecked(normalized: string, key: string, remember: boolean): Promise<ProjectInfo> {
    await this.waitForDisposal(key);
    this.assertNotQuitting();
    // Während des Wartens kann dasselbe Projekt schon geöffnet worden sein, etwa nach einem Doppelklick.
    const openedMeanwhile = this.focusIfOpen(key, remember);
    if (openedMeanwhile) return openedMeanwhile;

    // Ab hier synchron: Zustand lesen, Fenster öffnen und Kern anlegen, damit nie ein Fenster ohne Kern dasteht.
    const { stateFile, state } = this.loadProjectState(normalized, key);
    const windowId = this.ports.windows.open({
      kind: 'project',
      title: projectWindowTitle(projectName(normalized)),
      placement: state.window ? placeWindow(state.window, this.ports.windows.displays()) : this.cascadePlacement(),
    });
    this.markUsed(windowId);
    const core = this.createProjectCore(normalized, windowId, stateFile, state);
    this.rememberOpened(normalized, key, remember);
    this.closeWelcomeWindow();
    return core.info;
  }

  /**
   * „Clone Repository“: klont mit dem installierten Git und öffnet das Projekt danach in einem neuen Fenster (es landet
   * in den zuletzt geöffneten Projekten). Der Elternordner wird für den nächsten Vorschlag gemerkt.
   */
  private async clone(windowId: number, params: unknown): Promise<ProjectInfo> {
    this.assertNotQuitting();
    if (this.gitPath === null) throw new CommandError('Git not found. Install Git to clone repositories.', ErrorCode.gitNotFound);
    const url = (params as { url?: unknown } | undefined)?.url;
    const directory = (params as { directory?: unknown } | undefined)?.directory;
    if (typeof url !== 'string' || url.trim() === '') throw new CommandError('A repository URL is expected.', ErrorCode.invalidParams);
    if (!isAbsoluteCommandPath(directory)) throw new CommandError('An absolute directory is expected.', ErrorCode.invalidParams);
    const target = path.resolve(directory);
    // Zwei Klone ins selbe Ziel liefen sonst beide in denselben (leeren) Ordner.
    const key = target.toLowerCase();
    if ([...this.clones.values()].some((c) => c.target === key)) {
      throw new CommandError(`“${target}” is already being cloned.`, ErrorCode.fileExists, { path: target });
    }
    const job = startClone({
      git: this.gitPath,
      url: url.trim(),
      directory: target,
      env: this.options.processEnv ?? process.env,
      progress: this.progressForWindow(windowId),
    });
    this.clones.set(job, { windowId, target: key });
    try {
      await job.done;
    } finally {
      this.clones.delete(job);
    }
    this.assertNotQuitting();
    this.updateState((state) => {
      state.cloneParent = path.dirname(target);
    });
    return this.openProject(target);
  }

  /** Lage eines neuen Projektfensters ohne gespeicherte Lage: versetzt zum zuletzt benutzten Projektfenster. */
  private cascadePlacement(): WindowPlacement | undefined {
    const reference = this.windowOrder.findLast((id) => this.projects.has(id));
    const placement = reference === undefined ? null : this.ports.windows.placement(reference);
    return placement ? cascadeFrom(placement, this.ports.windows.displays()) : undefined;
  }

  private windowInfo(windowId: number): WindowInfo | null {
    if (windowId === this.welcomeWindowId) return { kind: 'welcome', title: WELCOME_TITLE };
    const core = this.projects.get(windowId);
    return core ? { kind: 'project', title: projectWindowTitle(core.name), project: core.info } : null;
  }

  /** Die zuletzt geöffneten Projekte; ein Ordner, der fehlt oder nicht erreichbar ist, gilt als nicht da. */
  private async recentProjects(): Promise<RecentProject[]> {
    const entries = this.appState.recentProjects;
    const statuses = await Promise.all(entries.map((p) => this.folders.folderStatus(p)));
    return entries.map((p, i) => ({ path: p, name: projectName(p), exists: statuses[i] === 'exists' }));
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
        const key = this.knownKey(project.path);
        this.updateState((state) => {
          state.openProjects = state.openProjects.filter((p) => this.knownKey(p) !== key);
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
  private focusIfOpen(key: string, remember: boolean): ProjectInfo | undefined {
    const core = this.coreWithKey(key);
    if (!core) return undefined;
    this.focusWindow(core.windowId);
    this.rememberOpened(core.path, key, remember);
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
  private rememberOpened(normalized: string, key: string, recent: boolean): void {
    this.updateState((state) => {
      if (recent) {
        const others = state.recentProjects.filter((p) => this.knownKey(p) !== key);
        state.recentProjects = [normalized, ...others].slice(0, RECENT_PROJECTS_LIMIT);
      }
      if (!state.openProjects.some((p) => this.knownKey(p) === key)) state.openProjects.push(normalized);
    });
  }

  /**
   * Der Schlüssel eines Projektpfads zum Vergleichen (siehe `FolderQueries.resolveKey`). Aufgelöste Schlüssel
   * merkt sich der Kern, damit spätere Vergleiche ohne Dateizugriff auskommen (`knownKey`).
   */
  private async keyOf(projectPath: string): Promise<string> {
    const lexical = lexicalProjectKey(projectPath);
    const known = this.realKeys.get(lexical);
    if (known !== undefined) return known;
    const { key, resolved } = await this.folders.resolveKey(projectPath);
    if (resolved) this.realKeys.set(lexical, key);
    return key;
  }

  /** Der Schlüssel ohne Dateizugriff: der schon aufgelöste echte, sonst der aus dem normalisierten Pfad. */
  private knownKey(projectPath: string): string {
    const lexical = lexicalProjectKey(projectPath);
    return this.realKeys.get(lexical) ?? lexical;
  }

  private coreWithKey(key: string): ProjectCore | undefined {
    return [...this.projects.values()].find((core) => this.knownKey(core.path) === key);
  }

  private async waitForDisposal(key: string): Promise<void> {
    const pending = this.disposals.get(key);
    if (pending) await pending;
  }

  private assertNotQuitting(): void {
    if (this.quitting) throw new CommandError('Codium is shutting down.', ErrorCode.shuttingDown);
  }

  private loadProjectState(normalized: string, key: string): { stateFile: StateFile<ProjectState>; state: ProjectState } {
    const stateFile = new StateFile<ProjectState>(
      path.join(this.options.dataDir, PROJECT_STATE_DIR, projectStateFileName(key)),
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
    const core = new ProjectCore({
      path: normalized,
      windowId,
      stateFile,
      events: this.events,
      shell: this.ports.shell,
      log: this.log,
      cleanupTimeoutMs: this.options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
      initialState: state,
      watchDebounceMs: this.options.watchDebounceMs,
      watchMaxDelayMs: this.options.watchMaxDelayMs,
      progressDelayMs: this.options.fileProgressDelayMs,
      ripgrepPath: this.options.ripgrepPath,
      terminal: {
        shell: () => shellFor(detectShells(this.ports.system), this.appState.settings.terminalShell),
        env: this.options.processEnv,
        ...(this.options.windowsConpty ? { bundledConpty: false } : {}),
      },
    });
    this.projects.set(windowId, core);
    this.checkPrerequisites(core);
    return core;
  }

  /**
   * Hinweise zu fehlenden Voraussetzungen im Fenster eines Projekts: ohne Git immer, ohne JDK ab 25 nur bei einem
   * Projekt mit Java-Kennzeichen (Maven- oder Gradle-Baudatei), damit Nutzer ohne Java nicht gestört werden.
   */
  private checkPrerequisites(core: ProjectCore): void {
    const openReadme = [{ label: 'Open README', action: 'readme.open' as const, params: { section: 'prerequisites' as const } }];
    if (this.gitPath === null) {
      core.notify({ level: 'error', text: 'Git not found. Git features are off until Git is installed.', actions: openReadme });
    }
    if (hasJavaMarkers(this.ports.system, core.path)) {
      const jdk = jdkForLanguageServer(detectJdks(this.ports.system), this.appState.settings.jdk ?? null);
      if (jdk === null) {
        core.notify({
          level: 'error',
          text: 'No JDK 25 or newer found. Java language features are off until one is installed.',
          actions: openReadme,
        });
      }
    }
  }
}

/**
 * Der absolute Pfad aus den Parametern eines Befehls. Die Oberfläche ist eigener Code, geprüft wird trotzdem (siehe
 * `isAbsoluteCommandPath`).
 */
function requireAbsolutePath(params: unknown): string {
  const value = (params as { path?: unknown } | undefined)?.path;
  if (!isAbsoluteCommandPath(value)) throw new CommandError('An absolute path is expected.', ErrorCode.invalidParams);
  return value;
}
