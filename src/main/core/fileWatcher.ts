// Überwachung des Projektordners für den Datei-Dienst. Lädt nie Electron.
//
// - Rekursiv mit `fs.watch` (unter Windows über ReadDirectoryChangesW, ohne Threadpool). Rohe Ereignisse werden
//   kurz gesammelt; nach einer Ruhezeit (spätestens nach einer Höchstwartezeit) wird geprüft, was wirklich existiert,
//   und das Ergebnis gebündelt gemeldet.
// - Angelegt oder geändert? Ist der Ordner eines Pfads schon gelesen, sagt das der gemerkte Inhalt. Sonst zählt die
//   Überwachung die Ereignisse „rename“: Jedes heisst unter Windows „angelegt“ oder „entfernt“, eine gerade Zahl
//   lässt den Pfad also, wie er vorher war. So ist „gelöscht und neu angelegt“ eine Änderung, kein Löschen.
// - Ein Ereignis ohne Dateinamen (übergelaufener Puffer) oder sehr viele Ereignisse auf einmal: Die schon gelesenen
//   Ordner werden neu eingelesen und verglichen, und die Meldung trägt `rescanned`.
// - Ereignisse in `.git` (auf jeder Ebene) melden keine Dateiänderung. HEAD, Index und Refs im `.git` des Projekts
//   melden stattdessen „Git-Daten geändert“.
// - Eigene Dateioperationen meldet der Datei-Dienst selbst; die Überwachung lässt sie weg (siehe OwnChanges).
// - Bricht die Überwachung ab (etwa weil ein Netzlaufwerk weg ist), startet sie mit wachsenden Pausen neu und liest
//   danach die gelesenen Ordner neu ein. Beim Abbau des Projekt-Kerns endet sie.
//
// `fs.watch` öffnet den Ordner synchron. Damit ein nicht erreichbares Netzlaufwerk den Hauptprozess dabei nicht
// aufhält, wird der Ordner vorher asynchron mit Zeitlimit geprüft.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileChange, FilesChangedEvent } from '../../shared/types';
import { FOLDER_QUERY_TIMEOUT_MS } from './folderQueries';
import { keyOf, type KnownDirs, type OwnChanges } from './fileTracking';
import { isMissingError, type RunIo } from './pathGuard';

/** Ruhezeit nach dem letzten rohen Ereignis, bis gemeldet wird. */
export const WATCH_DEBOUNCE_MS = 75;
/** Spätestens so lange nach dem ersten rohen Ereignis wird gemeldet, auch wenn weiter Ereignisse kommen. */
export const WATCH_MAX_DELAY_MS = 500;
/** Mehr verschiedene Pfade in einem Bündel lohnen keine Einzelprüfung; dann wird neu eingelesen. */
export const WATCH_MAX_PATHS = 2000;
/** Pausen vor einem neuen Start nach einem Abbruch. */
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

/** Ob ein Name der Ordner `.git` ist (unter Windows ohne Gross-/Kleinschreibung). */
export function isGitName(name: string): boolean {
  return keyOf(name) === '.git';
}

/** Ob ein Pfad unterhalb von `.git` (ohne `.git` selbst) zu HEAD, Index oder Refs gehört. Sperrdateien zählen nicht. */
function isGitData(segments: string[]): boolean {
  const last = keyOf(segments[segments.length - 1]);
  if (last.endsWith('.lock')) return false;
  const first = keyOf(segments[0]);
  if (first === 'refs') return true;
  return segments.length === 1 && (first === 'head' || first === 'index' || first === 'packed-refs');
}

export interface FileWatcherOptions {
  root: string;
  io: RunIo;
  known: KnownDirs;
  own: OwnChanges;
  onChanges: (event: FilesChangedEvent) => void;
  onGitData: () => void;
  log: (message: string) => void;
  debounceMs?: number;
  maxDelayMs?: number;
  /** Zeitlimit der Prüfung des Projektordners vor dem Start. */
  reachTimeoutMs?: number;
}

interface Pending {
  path: string;
  /** Zahl der Ereignisse „rename“ (angelegt oder entfernt) für diesen Pfad im Bündel. */
  renames: number;
}

interface Resolved {
  change: FileChange;
  stat: fs.Stats | null;
}

export class FileWatcher {
  private watcher: fs.FSWatcher | null = null;
  private stopped = false;
  private readonly pending = new Map<string, Pending>();
  /** Neu einlesen beim nächsten Bündel; dabei werden weitere einzelne Pfade nicht mehr gesammelt. */
  private rescanRequested = false;
  private tooMany = false;
  private gitChanged = false;
  private timer: NodeJS.Timeout | null = null;
  private firstEventAt: number | null = null;
  private flushing = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private restarts = 0;
  private everStarted = false;
  private readonly debounceMs: number;
  private readonly maxDelayMs: number;
  private readonly reachTimeoutMs: number;

  constructor(private readonly options: FileWatcherOptions) {
    this.debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
    this.maxDelayMs = options.maxDelayMs ?? WATCH_MAX_DELAY_MS;
    this.reachTimeoutMs = options.reachTimeoutMs ?? FOLDER_QUERY_TIMEOUT_MS;
  }

  /** Startet die Überwachung; ist der Ordner gerade nicht erreichbar, später erneut. */
  async start(): Promise<void> {
    if (this.stopped || this.watcher) return;
    const reachable = await this.isReachableFolder();
    if (this.stopped) return;
    if (!reachable) {
      this.scheduleRestart();
      return;
    }
    try {
      const watcher = fs.watch(this.options.root, { recursive: true }, (eventType, filename) => this.onRawEvent(eventType, filename));
      watcher.on('error', (err) => this.onWatchError(watcher, err));
      this.watcher = watcher;
    } catch (err) {
      this.options.log(`Überwachung von ${this.options.root} nicht gestartet: ${(err as Error).message}`);
      this.scheduleRestart();
      return;
    }
    // Nach einem Abbruch können Änderungen verpasst worden sein.
    if (this.everStarted) {
      this.rescanRequested = true;
      this.schedule();
    }
    this.everStarted = true;
    this.restarts = 0;
  }

  /** Beendet die Überwachung endgültig; danach kommen keine Meldungen mehr. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.timer = null;
    this.restartTimer = null;
    this.watcher?.close();
    this.watcher = null;
    this.pending.clear();
  }

  /**
   * Ob der Projektordner da ist und rechtzeitig antwortet. Eine Abfrage, die ins Zeitlimit läuft, belegt weiter
   * höchstens einen Platz der Warteschlange des Projekts.
   */
  private async isReachableFolder(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.reachTimeoutMs);
    });
    const check = this.options
      .io(() => fs.promises.stat(this.options.root))
      .then(
        (stat) => stat.isDirectory(),
        () => false,
      );
    try {
      return await Promise.race([check, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private onWatchError(watcher: fs.FSWatcher, err: Error): void {
    if (this.watcher !== watcher) return;
    this.options.log(`Überwachung von ${this.options.root} abgebrochen: ${err.message}`);
    watcher.close();
    this.watcher = null;
    this.scheduleRestart();
  }

  private onRootLost(): void {
    if (!this.watcher) return;
    this.options.log(`Projektordner ${this.options.root} ist weg oder umbenannt; die Überwachung startet später neu.`);
    this.watcher.close();
    this.watcher = null;
    this.rescanRequested = true;
    this.schedule();
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    const delay = RESTART_DELAYS_MS[Math.min(this.restarts, RESTART_DELAYS_MS.length - 1)];
    this.restarts++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delay);
  }

  private onRawEvent(eventType: string, filename: string | Buffer | null): void {
    if (this.stopped) return;
    if (typeof filename !== 'string' || filename === '') {
      this.rescanRequested = true;
      this.schedule();
      return;
    }
    if (path.isAbsolute(filename)) {
      // Der überwachte Ordner selbst ist gelöscht oder umbenannt. libuv meldet das unter Windows mit seinem vollen
      // Pfad, und zwar ohne Ende; die Überwachung lässt den Ordner deshalb sofort los und versucht es später neu.
      this.onRootLost();
      return;
    }
    const segments = filename.split(/[\\/]/);
    const gitAt = segments.findIndex(isGitName);
    if (gitAt !== -1) {
      // `.git` selbst zählt nur, wenn es entsteht oder verschwindet („rename“), nicht wenn sich sein Inhalt ändert.
      const gitData = segments.length === 1 ? eventType === 'rename' : isGitData(segments.slice(1));
      if (gitAt === 0 && gitData) {
        this.gitChanged = true;
        this.schedule();
      }
      return;
    }
    if (!this.tooMany) {
      const full = path.join(this.options.root, filename);
      const key = keyOf(full);
      let entry = this.pending.get(key);
      if (!entry) {
        entry = { path: full, renames: 0 };
        this.pending.set(key, entry);
      }
      if (eventType === 'rename') entry.renames++;
      if (this.pending.size > WATCH_MAX_PATHS) {
        this.tooMany = true;
        this.rescanRequested = true;
        this.pending.clear();
      }
    }
    this.schedule();
  }

  /** Plant das Melden: nach der Ruhezeit, spätestens nach der Höchstwartezeit seit dem ersten Ereignis. */
  private schedule(): void {
    if (this.stopped || this.flushing) return;
    const now = Date.now();
    this.firstEventAt ??= now;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(0, Math.min(this.debounceMs, this.firstEventAt + this.maxDelayMs - now));
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    this.firstEventAt = null;
    if (this.stopped) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    const rescan = this.rescanRequested;
    const git = this.gitChanged;
    this.rescanRequested = false;
    this.tooMany = false;
    this.gitChanged = false;
    this.flushing = true;
    try {
      const resolved = new Map<string, Resolved>();
      for (const r of await Promise.all(batch.map((p) => this.resolve(p)))) if (r) resolved.set(keyOf(r.change.path), r);
      if (rescan) {
        for (const change of await this.rescanKnownDirs()) {
          if (!resolved.has(keyOf(change.path))) resolved.set(keyOf(change.path), { change, stat: null });
        }
      }
      if (this.stopped) return;
      const changes = [...resolved.values()]
        .filter((r) => !this.options.own.isOwn(r.change, r.stat))
        .map((r) => r.change)
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      if (changes.length > 0 || rescan) this.options.onChanges({ changes, ...(rescan ? { rescanned: true as const } : {}) });
      if (git) this.options.onGitData();
    } catch (err) {
      this.options.log(`Dateiereignisse in ${this.options.root} nicht ausgewertet: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
      if (!this.stopped && (this.pending.size > 0 || this.rescanRequested || this.gitChanged)) this.schedule();
    }
  }

  /** Was nach dem Bündeln für einen Pfad feststeht; `null`, wenn es nichts zu melden gibt. */
  private async resolve(p: Pending): Promise<Resolved | null> {
    let stat: fs.Stats | null = null;
    let existsNow = true;
    try {
      stat = await this.options.io(() => fs.promises.lstat(p.path));
    } catch (err) {
      // Andere Fehler (etwa eine gesperrte Datei) heissen: Es gibt sie, Genaueres ist unbekannt.
      if (isMissingError(err)) existsNow = false;
    }
    const known = this.options.known.existed(p.path);
    const existedBefore = known ?? (existsNow !== (p.renames % 2 === 1));
    const isDirectory = stat?.isDirectory() ?? false;
    this.options.known.update(p.path, existsNow, isDirectory);
    if (!existsNow) return existedBefore ? { change: { path: p.path, kind: 'deleted' }, stat } : null;
    if (!existedBefore) return { change: { path: p.path, kind: 'created' }, stat };
    if (isDirectory) {
      // Ohne „rename“ hat sich nur der Inhalt des Ordners geändert; das melden die Einträge darin selbst.
      if (p.renames === 0) return null;
      // Gelöscht und neu angelegt: Der gemerkte Inhalt gilt nicht mehr.
      this.options.known.forget(p.path);
    }
    return { change: { path: p.path, kind: 'changed' }, stat };
  }

  /** Liest die schon gelesenen Ordner neu ein und meldet, was dazugekommen oder verschwunden ist. */
  private async rescanKnownDirs(): Promise<FileChange[]> {
    const dirs = this.options.known.all();
    const results = await Promise.all(
      dirs.map(async (dir): Promise<FileChange[]> => {
        let current: fs.Dirent[];
        try {
          current = await this.options.io(() => fs.promises.readdir(dir.path, { withFileTypes: true }));
        } catch (err) {
          if (!isMissingError(err)) return [];
          this.options.known.forget(dir.path);
          return [{ path: dir.path, kind: 'deleted' }];
        }
        const before = new Set(dir.entries.map((e) => keyOf(e.name)));
        const after = new Set(current.map((d) => keyOf(d.name)));
        const changes: FileChange[] = [];
        for (const d of current) {
          if (!before.has(keyOf(d.name)) && !isGitName(d.name)) changes.push({ path: path.join(dir.path, d.name), kind: 'created' });
        }
        for (const e of dir.entries) {
          if (after.has(keyOf(e.name)) || isGitName(e.name)) continue;
          const gone = path.join(dir.path, e.name);
          if (e.isDirectory) this.options.known.forget(gone);
          changes.push({ path: gone, kind: 'deleted' });
        }
        this.options.known.remember(
          dir.path,
          current.map((d) => ({ name: d.name, isDirectory: d.isDirectory() })),
        );
        return changes;
      }),
    );
    return results.flat();
  }
}
