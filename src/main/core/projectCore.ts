// Projekt-Kern: alles, was zu einem offenen Projekt in einem Fenster gehört. Spätere Tickets hängen hier
// ihre Dienste an (Dateien, Git, Sprache, Terminal, Datenbank). Lädt nie Electron.

import type { EventName, Events, ProjectInfo } from '../../shared/types';
import type { EventSink } from './ports';
import { projectName } from './projectPath';
import type { ProjectState } from './schema';
import type { StateFile } from './stateFile';

type Cleanup = () => void | Promise<void>;

export class ProjectCore {
  private projectState: ProjectState;
  private readonly cleanups: Cleanup[] = [];
  private disposing: Promise<void> | null = null;

  constructor(
    /** Normalisierter Pfad des Projektordners. */
    readonly path: string,
    /** Das Fenster, in dem das Projekt offen ist. */
    readonly windowId: number,
    private readonly stateFile: StateFile<ProjectState>,
    private readonly events: EventSink,
    private readonly log: (message: string) => void = () => {},
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
   * Abbau wartet auf sie. Aufräumarbeiten laufen in umgekehrter Reihenfolge der Anmeldung.
   */
  onDispose(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  /**
   * Baut den Projekt-Kern geordnet ab: alle Aufräumarbeiten nacheinander (ein Fehler hält die übrigen nicht
   * auf), danach wird der Projekt-Zustand sofort geschrieben. Mehrfacher Aufruf liefert denselben Abbau.
   */
  dispose(): Promise<void> {
    this.disposing ??= this.runDispose();
    return this.disposing;
  }

  private async runDispose(): Promise<void> {
    for (const cleanup of [...this.cleanups].reverse()) {
      try {
        await cleanup();
      } catch (err) {
        this.log(`Aufräumen im Projekt ${this.path} fehlgeschlagen: ${(err as Error).message}`);
      }
    }
    this.stateFile.flush();
  }
}
