// App-Kern: besitzt den App-Zustand, die Projekt-Kerne und den Vertrag mit der Oberfläche. Spätere Tickets
// ergänzen Fenster, Projekte, Einstellungen und Voraussetzungen. Lädt nie Electron.

import * as path from 'node:path';
import type { AppInfo } from '../../shared/types';
import type { EventSink, Ports } from './ports';
import { ProjectCore } from './projectCore';
import { normalizeProjectPath, projectKey, projectStateFileName } from './projectPath';
import { CommandRouter } from './router';
import {
  APP_STATE_FILE,
  PROJECT_STATE_DIR,
  SCHEMA_VERSION,
  emptyAppState,
  emptyProjectState,
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
  log?: (message: string) => void;
}

export class AppCore {
  readonly router = new CommandRouter();
  readonly ports: Ports;
  private readonly appStateFile: StateFile<AppState>;
  private appState: AppState;
  private readonly projects = new Map<number, ProjectCore>();
  private readonly log: (message: string) => void;
  private shuttingDown: Promise<void> | null = null;

  constructor(private readonly options: AppCoreOptions) {
    this.ports = options.ports;
    this.log = options.log ?? ((message) => console.error(message));
    this.appStateFile = new StateFile(path.join(options.dataDir, APP_STATE_FILE), SCHEMA_VERSION, emptyAppState, {
      debounceMs: options.saveDebounceMs,
      onCorrupt: (backup, reason) => this.log(`App-Zustand unlesbar (${reason}), gesichert als ${backup}`),
    });
    this.appState = this.appStateFile.load();
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

  /**
   * Erzeugt den Projekt-Kern für ein Projekt in einem Fenster und lädt seinen Zustand. Ein Projekt kann nur
   * einmal offen sein; ein Fenster hat höchstens ein Projekt.
   */
  openProjectCore(projectPath: string, windowId: number): ProjectCore {
    if (this.shuttingDown) throw new Error('Codium wird beendet.');
    const normalized = normalizeProjectPath(projectPath);
    if (this.findProjectCore(normalized)) throw new Error(`Projekt ist schon offen: ${normalized}`);
    if (this.projects.has(windowId)) throw new Error(`Fenster ${windowId} hat schon ein Projekt.`);
    const stateFile = new StateFile<ProjectState>(
      path.join(this.options.dataDir, PROJECT_STATE_DIR, projectStateFileName(normalized)),
      SCHEMA_VERSION,
      () => emptyProjectState(normalized),
      {
        debounceMs: this.options.saveDebounceMs,
        onCorrupt: (backup, reason) => this.log(`Projekt-Zustand unlesbar (${reason}), gesichert als ${backup}`),
      },
    );
    const core = new ProjectCore(normalized, windowId, stateFile, this.options.events, this.log);
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
  async closeProjectCore(windowId: number): Promise<void> {
    const core = this.projects.get(windowId);
    if (!core) return;
    this.projects.delete(windowId);
    await core.dispose();
  }

  /**
   * Beendet den Kern: baut alle Projekt-Kerne ab und schreibt den App-Zustand sofort. Mehrfacher Aufruf
   * liefert dasselbe Beenden.
   */
  shutdown(): Promise<void> {
    this.shuttingDown ??= (async () => {
      const cores = [...this.projects.values()];
      this.projects.clear();
      await Promise.all(cores.map((core) => core.dispose()));
      this.appStateFile.flush();
    })();
    return this.shuttingDown;
  }

  private registerCommands(): void {
    this.router.register('app.info', () => this.options.appInfo);
    this.router.register('project.info', (ctx) => this.projects.get(ctx.windowId)?.info ?? null);
  }
}
