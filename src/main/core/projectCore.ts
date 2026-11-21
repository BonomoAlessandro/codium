// Projekt-Kern: alles, was zu einem offenen Projekt in einem Fenster gehört. Spätere Tickets hängen hier
// ihre Dienste an (Dateien, Git, Sprache, Terminal, Datenbank). Lädt nie Electron.

import type { EventName, Events, Notice, ProjectInfo } from '../../shared/types';
import type { EventSink } from './ports';
import { ProgressReporter } from './progress';
import { projectName } from './projectPath';
import type { ProjectState } from './schema';
import type { StateFile } from './stateFile';

type Cleanup = () => void | Promise<void>;

/** Höchstdauer einer einzelnen Aufräumarbeit; danach geht der Abbau ohne sie weiter. */
export const DEFAULT_CLEANUP_TIMEOUT_MS = 5000;

export class ProjectCore {
  private projectState: ProjectState;
  private readonly cleanups: Cleanup[] = [];
  /** Aufräumarbeiten, die erst nach Beginn des Abbaus angemeldet wurden und sofort laufen. */
  private readonly lateCleanups: Promise<void>[] = [];
  private disposing: Promise<void> | null = null;
  private disposeFinished = false;
  /** Fortschritt laufender Arbeiten des Projekts, für die Statusleiste seines Fensters. */
  readonly progress = new ProgressReporter((event) => this.emit('app.progress', event));

  constructor(
    /** Normalisierter Pfad des Projektordners. */
    readonly path: string,
    /** Das Fenster, in dem das Projekt offen ist. */
    readonly windowId: number,
    private readonly stateFile: StateFile<ProjectState>,
    private readonly events: EventSink,
    private readonly log: (message: string) => void = () => {},
    private readonly cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
    /** Schon gelesener Zustand (etwa für die Fensterlage vor dem Öffnen); ohne Angabe liest der Kern ihn selbst. */
    initialState?: ProjectState,
  ) {
    this.projectState = initialState ?? stateFile.load();
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

  /** Schickt ein Ereignis an das Fenster dieses Projekts; nach Beginn des Abbaus nichts mehr. */
  emit<K extends EventName>(name: K, payload: Events[K]): void {
    if (this.disposed) return;
    this.events.send(this.windowId, name, payload);
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
