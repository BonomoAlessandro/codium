// Abfragen auf Projektordnern (gibt es ihn, wie heisst er wirklich), asynchron und so, dass ein nicht erreichbares
// Netzlaufwerk weder den Hauptprozess noch andere Abfragen aufhält. Lädt nie Electron.
//
// Ein Zeitlimit beendet nur das Warten: Die Abfrage selbst läuft im Threadpool von libuv weiter und belegt einen
// Thread, bis Windows aufgibt. Damit hängende Abfragen den Threadpool nicht füllen (und dann auch Abfragen auf
// lokale Ordner warten liessen), gilt:
// - Pro Laufwerk bzw. Freigabe (`\\server\share`) läuft höchstens eine Abfrage gleichzeitig; weitere warten kurz.
//   Gleiche Abfragen auf denselben Pfad, die gleichzeitig kommen, teilen sich eine.
// - Läuft eine Abfrage ins Zeitlimit, wird einmal die Wurzel ihres Laufwerks gefragt:
//   - Antwortet sie, liegt es am Pfad (etwa ein Link auf eine tote Freigabe): Nur dieser Pfad ist eine Weile
//     gesperrt, das übrige Laufwerk bleibt erreichbar.
//   - Hängt auch sie, ist das Laufwerk eine Weile gesperrt.
//   Gesperrt ist auch, solange eine hängende Abfrage noch nicht zurück ist; gesperrte Pfade und Laufwerke bekommen
//   sofort „nicht erreichbar“. Je nicht erreichbarem Laufwerk hängen so höchstens zwei Abfragen.
// - Kommt eine hängende Abfrage doch noch zurück, mit Ergebnis oder mit einem Fehler, der die Datei betrifft (etwa
//   „fehlt“), hat das Laufwerk geantwortet: Die Sperren von Pfad und Laufwerk fallen sofort weg.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lexicalProjectKey } from './projectPath';

/** Zeitlimit einer Abfrage auf einem Projektordner. */
export const FOLDER_QUERY_TIMEOUT_MS = 2000;
/** So lange bleiben ein Pfad oder ein Laufwerk nach einem Zeitlimit gesperrt. */
export const UNREACHABLE_FOR_MS = 30_000;

/** Fehler, mit denen ein Laufwerk über eine Datei Auskunft gibt; andere (etwa Netzwerkfehler) sind keine Antwort. */
const ANSWER_CODES = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'EPERM', 'ELOOP', 'EBUSY']);

/** Zustand eines Projektordners: da, fehlt (der Ordner, nicht das Laufwerk) oder nicht erreichbar. */
export type FolderStatus = 'exists' | 'missing' | 'unreachable';

export interface FolderQueriesOptions {
  timeoutMs?: number;
  unreachableForMs?: number;
  /** Uhr in Millisekunden, für Tests. */
  now?: () => number;
}

type Outcome<T> = { kind: 'ok'; value: T } | { kind: 'error'; code: string } | { kind: 'unreachable' };

/** Sperre eines Pfads oder eines Laufwerks nach einem Zeitlimit. */
interface Block {
  /** Bis zu diesem Zeitpunkt gesperrt. */
  until: number;
  /** Die Abfrage, die ins Zeitlimit lief, ist noch nicht zurück. */
  hanging: boolean;
}

interface Volume extends Block {
  /** Ende der letzten Abfrage auf diesem Laufwerk; die nächste beginnt erst danach. */
  queue: Promise<unknown>;
}

const TIMEOUT = Symbol('timeout');

export class FolderQueries {
  private readonly volumes = new Map<string, Volume>();
  private readonly pathBlocks = new Map<string, Block>();
  private readonly running = new Map<string, Promise<Outcome<unknown>>>();
  private readonly timeoutMs: number;
  private readonly unreachableForMs: number;
  private readonly now: () => number;

  constructor(options: FolderQueriesOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? FOLDER_QUERY_TIMEOUT_MS;
    this.unreachableForMs = options.unreachableForMs ?? UNREACHABLE_FOR_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Ob der Projektordner da ist. Fehlt er, wird geprüft, ob wenigstens sein Laufwerk da ist: Fehlt auch das (etwa
   * ein Netzlaufwerk, das noch nicht verbunden ist), gilt der Ordner als nicht erreichbar statt als fehlend.
   * Andere Fehler (etwa fehlende Rechte) gelten ebenfalls als nicht erreichbar.
   */
  async folderStatus(projectPath: string): Promise<FolderStatus> {
    const target = path.resolve(projectPath);
    const outcome = await this.query('stat', target, () => fs.promises.stat(target));
    if (outcome.kind === 'ok') return outcome.value.isDirectory() ? 'exists' : 'missing';
    if (outcome.kind === 'unreachable' || (outcome.code !== 'ENOENT' && outcome.code !== 'ENOTDIR')) return 'unreachable';
    const root = path.parse(target).root;
    if (root === target) return 'unreachable';
    const rootOutcome = await this.query('stat', root, () => fs.promises.stat(root));
    return rootOutcome.kind === 'ok' ? 'missing' : 'unreachable';
  }

  /**
   * Schlüssel eines Projekts zum Vergleichen: für einen erreichbaren Ordner sein echter Pfad (Kurznamen wie
   * `ALESSA~1`, Junctions und symbolische Links aufgelöst), sonst der Schlüssel ohne Dateizugriff
   * (`resolved: false`). Beide sind unter Windows klein geschrieben.
   */
  async resolveKey(projectPath: string): Promise<{ key: string; resolved: boolean }> {
    const target = path.resolve(projectPath);
    const outcome = await this.query('realpath', target, () => fs.promises.realpath(target));
    if (outcome.kind !== 'ok') return { key: lexicalProjectKey(projectPath), resolved: false };
    return { key: lexicalProjectKey(outcome.value), resolved: true };
  }

  private query<T>(kind: string, target: string, run: () => Promise<T>): Promise<Outcome<T>> {
    const id = `${kind}:${lexicalProjectKey(target)}`;
    const existing = this.running.get(id);
    if (existing) return existing as Promise<Outcome<T>>;
    const volume = this.volume(target);
    const result = volume.queue.then(() => this.attempt(volume, target, run));
    volume.queue = result;
    this.running.set(id, result);
    void result.then(() => {
      if (this.running.get(id) === result) this.running.delete(id);
    });
    return result;
  }

  /** Eine Abfrage auf einem Laufwerk samt Rückfrage an dessen Wurzel; wartet höchstens zweimal das Zeitlimit. */
  private async attempt<T>(volume: Volume, target: string, run: () => Promise<T>): Promise<Outcome<T>> {
    const pathId = lexicalProjectKey(target);
    const pathBlock = this.pathBlocks.get(pathId);
    if (this.isBlocked(volume) || (pathBlock && this.isBlocked(pathBlock))) return { kind: 'unreachable' };

    const first = await this.withTimeout(run);
    if (first.kind !== 'timeout') return first;
    const block: Block = { until: this.now() + this.unreachableForMs, hanging: true };
    this.pathBlocks.set(pathId, block);
    this.watchLate(first.work, block, volume);

    // Liegt es am Pfad oder am ganzen Laufwerk? Die Wurzel gibt Auskunft.
    const root = path.parse(target).root;
    if (root !== target) {
      const rootCheck = await this.withTimeout(() => fs.promises.stat(root));
      if (rootCheck.kind !== 'timeout') return { kind: 'unreachable' };
      this.watchLate(rootCheck.work, volume, volume);
    }
    volume.until = this.now() + this.unreachableForMs;
    volume.hanging = true;
    return { kind: 'unreachable' };
  }

  /**
   * Beobachtet eine Abfrage, die ins Zeitlimit lief. Kommt sie mit einer Antwort zurück, fallen die Sperren von
   * Pfad und Laufwerk weg; sonst endet nur das „hängt noch“, die Sperre läuft bis zu ihrem Ende weiter.
   */
  private watchLate(work: Promise<unknown>, block: Block, volume: Volume): void {
    const answered = () => {
      for (const b of [block, volume]) {
        b.until = 0;
        b.hanging = false;
      }
    };
    void work.then(answered, (err: unknown) => {
      if (ANSWER_CODES.has((err as NodeJS.ErrnoException).code ?? '')) answered();
      else block.hanging = false;
    });
  }

  private isBlocked(block: Block): boolean {
    return block.hanging || this.now() < block.until;
  }

  /** Wartet höchstens das Zeitlimit auf eine Abfrage; wirft nie. */
  private async withTimeout<T>(
    run: () => Promise<T>,
  ): Promise<Outcome<T> | { kind: 'timeout'; work: Promise<T> }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), this.timeoutMs);
    });
    const work = Promise.resolve().then(run);
    try {
      const value = await Promise.race([work, timeout]);
      return value === TIMEOUT ? { kind: 'timeout', work } : { kind: 'ok', value };
    } catch (err) {
      return { kind: 'error', code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Das Laufwerk eines Pfads: `c:\` bzw. `\\server\share\`, unter Windows klein geschrieben. */
  private volume(target: string): Volume {
    const root = path.parse(target).root;
    const id = process.platform === 'win32' ? root.toLowerCase() : root;
    let volume = this.volumes.get(id);
    if (!volume) {
      volume = { queue: Promise.resolve(), until: 0, hanging: false };
      this.volumes.set(id, volume);
    }
    return volume;
  }
}
