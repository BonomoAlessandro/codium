// Abfragen auf Projektordnern (gibt es ihn, wie heisst er wirklich), asynchron und so, dass ein nicht erreichbares
// Netzlaufwerk weder den Hauptprozess noch andere Abfragen aufhält. Lädt nie Electron.
//
// Ein Zeitlimit beendet nur das Warten: Die Abfrage selbst läuft im Threadpool von libuv weiter und belegt einen
// Thread, bis Windows aufgibt. Damit hängende Abfragen den Threadpool nicht füllen (und dann auch Abfragen auf
// lokale Ordner warten liessen), gilt:
// - Pro Laufwerk bzw. Freigabe (`\\server\share`) läuft höchstens eine Abfrage gleichzeitig; weitere warten kurz.
// - Läuft eine Abfrage ins Zeitlimit, gilt ihr Laufwerk eine Weile als nicht erreichbar. Solange das so ist oder
//   die hängende Abfrage noch läuft, bekommen weitere Abfragen auf dasselbe Laufwerk sofort „nicht erreichbar“.
// - Gleiche Abfragen auf denselben Pfad, die gleichzeitig kommen, teilen sich eine.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lexicalProjectKey } from './projectPath';

/** Zeitlimit einer Abfrage auf einem Projektordner. */
export const FOLDER_QUERY_TIMEOUT_MS = 2000;
/** So lange gilt ein Laufwerk nach einem Zeitlimit als nicht erreichbar. */
export const UNREACHABLE_FOR_MS = 30_000;

/** Zustand eines Projektordners: da, fehlt (der Ordner, nicht das Laufwerk) oder nicht erreichbar. */
export type FolderStatus = 'exists' | 'missing' | 'unreachable';

export interface FolderQueriesOptions {
  timeoutMs?: number;
  unreachableForMs?: number;
  /** Uhr in Millisekunden, für Tests. */
  now?: () => number;
}

type Outcome<T> = { kind: 'ok'; value: T } | { kind: 'error'; code: string } | { kind: 'unreachable' };

interface Volume {
  /** Ende der letzten Abfrage auf diesem Laufwerk; die nächste beginnt erst danach. */
  queue: Promise<unknown>;
  /** Bis zu diesem Zeitpunkt gilt das Laufwerk als nicht erreichbar. */
  unreachableUntil: number;
  /** Eine Abfrage lief ins Zeitlimit und ist noch nicht zurück. */
  hanging: boolean;
}

const TIMEOUT = Symbol('timeout');

export class FolderQueries {
  private readonly volumes = new Map<string, Volume>();
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
    const result = volume.queue.then(() => this.attempt(volume, run));
    volume.queue = result;
    this.running.set(id, result);
    void result.then(() => {
      if (this.running.get(id) === result) this.running.delete(id);
    });
    return result;
  }

  /** Eine Abfrage auf einem Laufwerk; wartet höchstens das Zeitlimit und wirft nie. */
  private async attempt<T>(volume: Volume, run: () => Promise<T>): Promise<Outcome<T>> {
    if (volume.hanging || this.now() < volume.unreachableUntil) return { kind: 'unreachable' };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), this.timeoutMs);
    });
    const work = Promise.resolve().then(run);
    try {
      const value = await Promise.race([work, timeout]);
      if (value !== TIMEOUT) return { kind: 'ok', value };
      volume.unreachableUntil = this.now() + this.unreachableForMs;
      volume.hanging = true;
      void work.then(
        () => (volume.hanging = false),
        () => (volume.hanging = false),
      );
      return { kind: 'unreachable' };
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
      volume = { queue: Promise.resolve(), unreachableUntil: 0, hanging: false };
      this.volumes.set(id, volume);
    }
    return volume;
  }
}
