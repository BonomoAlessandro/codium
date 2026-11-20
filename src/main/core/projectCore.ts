// Projekt-Kern: alles, was zu einem offenen Projekt in einem Fenster gehört. Spätere Tickets hängen hier
// ihre Dienste an (Dateien, Git, Sprache, Terminal, Datenbank). Lädt nie Electron.

import type { EventName, Events, ProjectInfo } from '../../shared/types';
import type { EventSink } from './ports';
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

  constructor(
    /** Normalisierter Pfad des Projektordners. */
    readonly path: string,
    /** Das Fenster, in dem das Projekt offen ist. */
    readonly windowId: number,
    private readonly stateFile: StateFile<ProjectState>,
    private readonly events: EventSink,
    private readonly log: (message: string) => void = () => {},
    private readonly cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  ) {
    this.projectState = stateFile.load();
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

  /** Schickt ein Ereignis an das Fenster dieses Projekts. */
  emit<K extends EventName>(name: K, payload: Events[K]): void {
    if (this.disposed) return;
    this.events.send(this.windowId, name, payload);
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
    // Spät angemeldete Arbeiten können ihrerseits weitere anmelden; solange es neue gibt, weiter warten.
    for (let done = 0; done < this.lateCleanups.length; done = this.lateCleanups.length) {
      await Promise.all(this.lateCleanups.slice(done));
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
