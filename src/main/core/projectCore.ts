// Projekt-Kern: alles, was zu einem offenen Projekt in einem Fenster gehört, mit seinen Diensten (ab Ticket 04 der
// Datei-Dienst, ab Ticket 11 der Terminal-Dienst; Git, Sprache und Datenbank folgen). Lädt nie Electron.
//
// Ereignisse an das Fenster des Projekts können auch Dienste im Kern abonnieren (`subscribe`), etwa der Git-Dienst
// die Dateiereignisse des Datei-Dienstes.

import type { EventName, Events, Notice, ProjectInfo } from '../../shared/types';
import { followFileOperation } from './editorCommands';
import { expandedFolderPaths } from './fileCommands';
import { FileService } from './fileService';
import { SearchService } from './searchService';
import { GitService, type GitServiceOptions } from './git/gitService';
import { TerminalService, type TerminalServiceOptions } from './terminalService';
import { LanguageService, type LanguageServiceOptions } from './language/languageService';
import type { EventSink, ShellActionsPort } from './ports';
import { ProgressReporter } from './progress';
import { projectName } from './projectPath';
import type { ProjectState } from './schema';
import type { StateFile } from './stateFile';

type Cleanup = () => void | Promise<void>;

/** Höchstdauer einer einzelnen Aufräumarbeit; danach geht der Abbau ohne sie weiter. */
export const DEFAULT_CLEANUP_TIMEOUT_MS = 5000;

export interface ProjectCoreOptions {
  /** Normalisierter Pfad des Projektordners. */
  path: string;
  /** Das Fenster, in dem das Projekt offen ist. */
  windowId: number;
  stateFile: StateFile<ProjectState>;
  events: EventSink;
  /** Port „Shell-Aktionen“ (Papierkorb, Explorer, Zwischenablage) für den Datei-Dienst. */
  shell: ShellActionsPort;
  log?: (message: string) => void;
  cleanupTimeoutMs?: number;
  /** Schon gelesener Zustand (etwa für die Fensterlage vor dem Öffnen); ohne Angabe liest der Kern ihn selbst. */
  initialState?: ProjectState;
  /** Wartezeiten der Dateiüberwachung, für Tests. */
  watchDebounceMs?: number;
  watchMaxDelayMs?: number;
  /** Ab dieser Dauer zeigt eine Dateioperation Fortschritt, für Tests. */
  progressDelayMs?: number;
  /** Pfad zu ripgrep (mitgeliefert); für Dateiliste, Suche nach Namen und Projektsuche. */
  ripgrepPath: string;
  /** Shell und Umgebung für den Terminal-Dienst. */
  terminal: Omit<TerminalServiceOptions, 'log'>;
  /** Sprachserver für den Sprach-Dienst. */
  language: Omit<LanguageServiceOptions, 'log'>;
  /** Das installierte Git für den Git-Dienst. */
  git: Omit<GitServiceOptions, 'log'>;
}

export class ProjectCore {
  /** Normalisierter Pfad des Projektordners. */
  readonly path: string;
  /** Das Fenster, in dem das Projekt offen ist. */
  readonly windowId: number;
  private projectState: ProjectState;
  private readonly stateFile: StateFile<ProjectState>;
  private readonly events: EventSink;
  private readonly log: (message: string) => void;
  private readonly cleanupTimeoutMs: number;
  private readonly cleanups: Cleanup[] = [];
  /** Aufräumarbeiten, die erst nach Beginn des Abbaus angemeldet wurden und sofort laufen. */
  private readonly lateCleanups: Promise<void>[] = [];
  private readonly subscribers = new Map<string, Set<(payload: never) => void>>();
  private disposing: Promise<void> | null = null;
  private disposeFinished = false;
  /** Fortschritt laufender Arbeiten des Projekts, für die Statusleiste seines Fensters. */
  readonly progress = new ProgressReporter((event) => this.emit('app.progress', event));
  /** Datei-Dienst: Dateibaum, Dateioperationen, Dateiüberwachung. */
  readonly files: FileService;
  /** Such-Dienst: Dateiliste, Suche nach Namen, Projektsuche (über ripgrep). */
  readonly search: SearchService;
  /** Terminal-Dienst: Shells über node-pty. */
  readonly terminals: TerminalService;
  /** Sprach-Dienst: Sprachserver (ab Ticket 12 TypeScript). */
  readonly language: LanguageService;
  /** Git-Dienst (ab Ticket 15). */
  readonly git: GitService;

  constructor(options: ProjectCoreOptions) {
    this.path = options.path;
    this.windowId = options.windowId;
    this.stateFile = options.stateFile;
    this.events = options.events;
    this.log = options.log ?? (() => {});
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
    this.projectState = options.initialState ?? options.stateFile.load();
    this.files = new FileService(this, {
      shell: options.shell,
      log: this.log,
      expandedFolders: expandedFolderPaths(this.path, this.projectState.expandedFolders),
      watchDebounceMs: options.watchDebounceMs,
      watchMaxDelayMs: options.watchMaxDelayMs,
      progressDelayMs: options.progressDelayMs,
    });
    this.search = new SearchService(this, options.ripgrepPath, this.log);
    this.terminals = new TerminalService(this, { ...options.terminal, log: this.log });
    this.language = new LanguageService(this, { ...options.language, log: this.log });
    this.git = new GitService(this, { ...options.git, log: this.log });
    // Tabs und Cursor im Zustand folgen Umbenennungen und Löschungen in Codium.
    this.subscribe('files.operation', (op) => {
      if (op.kind === 'renamed' || op.kind === 'deleted') this.updateState((state) => followFileOperation(this.path, state, op));
    });
  }

  get name(): string {
    return projectName(this.path);
  }

  get info(): ProjectInfo {
    return { path: this.path, name: this.name };
  }

  /** Ob der Abbau begonnen hat; danach nimmt der Kern keine neue Arbeit mehr an. */
  get disposed(): boolean {
    return this.disposing !== null;
  }

  /** Eine Kopie des Projekt-Zustands. */
  get state(): ProjectState {
    return structuredClone(this.projectState);
  }

  /** Ändert den Projekt-Zustand und speichert ihn entprellt. */
  updateState(mutate: (state: ProjectState) => void): void {
    const next = structuredClone(this.projectState);
    mutate(next);
    this.projectState = next;
    this.stateFile.save(next);
  }

  /**
   * Schickt ein Ereignis an das Fenster dieses Projekts und an die Abonnenten im Kern. Nach Beginn des Abbaus geht
   * nichts mehr ans Fenster; die Abonnenten im Kern hören bis zum Ende des Abbaus mit, damit etwa eine Dateioperation,
   * die währenddessen fertig wird, noch bei ihnen ankommt.
   */
  emit<K extends EventName>(name: K, payload: Events[K]): void {
    if (this.disposeFinished) return;
    for (const listener of [...(this.subscribers.get(name) ?? [])]) {
      try {
        (listener as (payload: Events[K]) => void)(payload);
      } catch (err) {
        this.log(`Abonnent von ${name} im Projekt ${this.path} fehlgeschlagen: ${(err as Error).message}`);
      }
    }
    if (!this.disposed) this.events.send(this.windowId, name, payload);
  }

  /** Abonniert ein Ereignis dieses Projekts im Kern (für andere Dienste); liefert eine Funktion zum Abmelden. */
  subscribe<K extends EventName>(name: K, listener: (payload: Events[K]) => void): () => void {
    const listeners = this.subscribers.get(name) ?? new Set();
    listeners.add(listener as (payload: never) => void);
    this.subscribers.set(name, listeners);
    return () => listeners.delete(listener as (payload: never) => void);
  }

  /** Zeigt eine Meldung unten rechts im Fenster dieses Projekts. */
  notify(notice: Notice): void {
    this.emit('app.notice', notice);
  }

  /**
   * Meldet eine Aufräumarbeit für den Abbau an, etwa „Sprachserver beenden“. Sie darf asynchron sein; der
   * Abbau wartet auf sie, höchstens bis zum Zeitlimit. Aufräumarbeiten laufen in umgekehrter Reihenfolge der
   * Anmeldung. Wer sich erst während oder nach dem Abbau anmeldet (etwa ein Dienst, der asynchron gestartet ist),
   * wird sofort aufgeräumt.
   */
  onDispose(cleanup: Cleanup): void {
    if (this.disposing === null) {
      this.cleanups.push(cleanup);
      return;
    }
    const run = this.runCleanup(cleanup);
    if (!this.disposeFinished) this.lateCleanups.push(run);
  }

  /**
   * Baut den Projekt-Kern geordnet ab: Der Zustand wird sofort geschrieben, dann laufen alle Aufräumarbeiten
   * nacheinander (ein Fehler oder eine hängende Arbeit hält die übrigen nicht auf), am Ende wird der Zustand noch
   * einmal geschrieben. Mehrfacher Aufruf liefert denselben Abbau.
   */
  dispose(): Promise<void> {
    this.disposing ??= this.runDispose();
    return this.disposing;
  }

  private async runDispose(): Promise<void> {
    // Noch im selben Aufruf: Die Dateiüberwachung endet und lässt den Projektordner los.
    this.files.dispose();
    // Sofort sichern: Wer das Projekt gleich wieder öffnet oder die App beendet, soll den letzten Stand sehen.
    this.stateFile.flush();
    for (const cleanup of [...this.cleanups].reverse()) await this.runCleanup(cleanup);
    // Spät angemeldete Arbeiten können ihrerseits weitere anmelden, auch während auf sie gewartet wird; solange es
    // neue gibt, weiter warten.
    let done = 0;
    while (done < this.lateCleanups.length) {
      const end = this.lateCleanups.length;
      await Promise.all(this.lateCleanups.slice(done, end));
      done = end;
    }
    this.disposeFinished = true;
    this.subscribers.clear();
    this.stateFile.flush();
  }

  private async runCleanup(cleanup: Cleanup): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.cleanupTimeoutMs);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(cleanup), timeout]);
      if (result === 'timeout') {
        this.log(`Aufräumen im Projekt ${this.path} nach ${this.cleanupTimeoutMs} ms abgebrochen.`);
      }
    } catch (err) {
      this.log(`Aufräumen im Projekt ${this.path} fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
