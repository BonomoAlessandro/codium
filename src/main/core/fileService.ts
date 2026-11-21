// Datei-Dienst eines Projekts: Ordnerinhalte für den Dateibaum, Dateioperationen und die Überwachung des
// Projektordners (fileWatcher.ts). Lesen und Schreiben von Dateiinhalten kommen mit den Tickets 05 und 07. Lädt nie
// Electron.
//
// - Jeder Befehl prüft seine Pfade (pathGuard.ts): absolut, vorhanden und auch nach dem Auflösen von `..`,
//   Junctions und symbolischen Links im Projekt.
// - Alle Dateizugriffe auf Projektpfade sind asynchron und laufen über eine Warteschlange mit wenigen gleichzeitigen
//   Zugriffen (ioLimiter.ts); ein hängendes Netzlaufwerk hält so weder den Hauptprozess noch andere Projekte auf.
// - Jede Dateioperation meldet `files.operation`, sobald sie fertig ist. Die Überwachung meldet sie nicht noch einmal
//   als Änderung von aussen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { copyName, fileNameProblem, splitNewName } from '../../shared/fileNames';
import { ErrorCode, type CommandParams, type EventName, type Events, type FileEntry } from '../../shared/types';
import { KnownDirs, OwnChanges, keyOf } from './fileTracking';
import { FileWatcher, isGitName } from './fileWatcher';
import { IoLimiter } from './ioLimiter';
import { PathGuard, alreadyExists, fileError, isMissingError } from './pathGuard';
import type { ShellActionsPort } from './ports';
import { isKeyWithin } from './projectPath';
import { CommandError } from './router';

/** Gleichzeitige Dateizugriffe eines Projekts. */
const IO_CONCURRENCY = 4;
/** Höchstzahl Pfade in einem Befehl. */
const MAX_PATHS_PER_COMMAND = 10_000;

/** Sortierung im Dateibaum: alphabetisch ohne Unterscheidung der Gross-/Kleinschreibung, unabhängig vom Rechner. */
const collator = new Intl.Collator('en', { sensitivity: 'base' });

/** Was der Datei-Dienst vom Projekt-Kern braucht. */
export interface FileServiceHost {
  readonly path: string;
  emit<K extends EventName>(name: K, payload: Events[K]): void;
  onDispose(cleanup: () => void | Promise<void>): void;
}

export interface FileServiceOptions {
  shell: ShellActionsPort;
  log: (message: string) => void;
  /** Wartezeiten der Überwachung (siehe fileWatcher.ts), für Tests. */
  watchDebounceMs?: number;
  watchMaxDelayMs?: number;
}

export class FileService {
  private readonly limiter = new IoLimiter(IO_CONCURRENCY);
  private readonly io = <T>(work: () => Promise<T>): Promise<T> => this.limiter.run(work);
  private readonly guard: PathGuard;
  private readonly known = new KnownDirs();
  private readonly own = new OwnChanges();
  private readonly watcher: FileWatcher;
  /** Laufende Dateioperationen, auf die der Abbau wartet. */
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly host: FileServiceHost,
    private readonly options: FileServiceOptions,
  ) {
    this.guard = new PathGuard(host.path, this.io);
    this.watcher = new FileWatcher({
      root: host.path,
      io: this.io,
      known: this.known,
      own: this.own,
      onChanges: (event) => host.emit('files.changed', event),
      onGitData: () => host.emit('git.dataChanged', {}),
      log: options.log,
      debounceMs: options.watchDebounceMs,
      maxDelayMs: options.watchMaxDelayMs,
    });
    // Eine laufende Operation (etwa das Kopieren eines grossen Ordners) darf noch fertig werden, höchstens bis zum
    // Zeitlimit der Aufräumarbeiten; sonst bliebe beim Beenden eine halbe Kopie zurück.
    host.onDispose(async () => {
      await Promise.allSettled([...this.running]);
    });
    void this.watcher.start();
  }

  /**
   * Beendet die Überwachung, sofort und synchron beim Beginn des Abbaus: Danach kommen keine Ereignisse mehr, und der
   * Projektordner ist freigegeben (Windows löscht einen überwachten Ordner erst, wenn die Überwachung ihn loslässt).
   */
  dispose(): void {
    this.watcher.stop();
  }

  /** Prüft einen Pfad nur lexikalisch: absolut und im Projekt (siehe `PathGuard.lexical`). */
  lexicalPath(value: unknown): string {
    return this.guard.lexical(value);
  }

  /** Inhalt eines Ordners: Ordner vor Dateien, alphabetisch, ohne `.git`. */
  async list(params: CommandParams<'files.list'>): Promise<FileEntry[]> {
    const dir = await this.existingDirectory(field(params, 'path'));
    const dirents = await this.fileOp(() => fs.promises.readdir(dir, { withFileTypes: true }), dir, 'read');
    const entries = await Promise.all(dirents.map((d) => this.entryOf(dir, d)));
    this.known.remember(dir, entries);
    return entries.filter((e) => !isGitName(e.name)).sort(compareEntries);
  }

  createFile(params: CommandParams<'files.createFile'>): Promise<string> {
    return this.track(() => this.create(params, false));
  }

  createDirectory(params: CommandParams<'files.createDirectory'>): Promise<string> {
    return this.track(() => this.create(params, true));
  }

  rename(params: CommandParams<'files.rename'>): Promise<string> {
    return this.track(() => this.renameNow(params));
  }

  /** Verschiebt in den Papierkorb (über den Port); liegt ein Eintrag in einem anderen, genügt der äussere. */
  delete(params: CommandParams<'files.delete'>): Promise<void> {
    return this.track(() => this.deleteNow(params));
  }

  /** Kopiert in einen Ordner; bei einem Namenskonflikt mit Zusatz („Name (2).ext“), mit `newName` unter diesem Namen. */
  copy(params: CommandParams<'files.copy'>): Promise<string[]> {
    return this.track(() => this.copyNow(params));
  }

  /** Führt eine Dateioperation aus und merkt sie sich, bis sie fertig ist. */
  private track<T>(work: () => Promise<T>): Promise<T> {
    const run = work();
    this.running.add(run);
    const done = () => this.running.delete(run);
    run.then(done, done);
    return run;
  }

  private async renameNow(params: CommandParams<'files.rename'>): Promise<string> {
    const source = await this.guard.existing(field(params, 'path'));
    if (this.guard.isRoot(source)) throw invalidParams('The project folder cannot be renamed.');
    const newName = requireName(field(params, 'newName'));
    const target = path.join(path.dirname(source), newName);
    if (target === source) return source;
    // Nur die Gross-/Kleinschreibung ändern ist unter Windows dieselbe Datei, kein Konflikt.
    if (keyOf(target) !== keyOf(source) && (await this.lstatOrNull(target))) throw alreadyExists(target);
    const isDirectory = (await this.fileOp(() => fs.promises.stat(source), source, 'rename')).isDirectory();
    const gone = this.own.expect(source, false, true);
    const added = this.own.expect(target, true, true);
    try {
      await this.fileOp(() => fs.promises.rename(source, target), source, 'rename');
    } finally {
      gone.settle();
      added.settle(await this.lstatOrNull(target));
    }
    this.known.update(source, false, isDirectory);
    this.known.update(target, true, isDirectory);
    this.host.emit('files.operation', { kind: 'renamed', from: source, to: target, isDirectory });
    return target;
  }

  private async deleteNow(params: CommandParams<'files.delete'>): Promise<void> {
    const targets = await this.existingList(field(params, 'paths'));
    if (targets.some((t) => this.guard.isRoot(t))) throw invalidParams('The project folder cannot be deleted.');
    for (const target of outermost(targets)) {
      const isDirectory = (await this.fileOp(() => fs.promises.lstat(target), target, 'delete')).isDirectory();
      const own = this.own.expect(target, false, true);
      try {
        await this.options.shell.trash(target);
      } catch (err) {
        this.options.log(`Papierkorb für ${target} fehlgeschlagen: ${(err as Error).message}`);
        throw new CommandError(
          `Could not move “${path.basename(target)}” to the Recycle Bin.`,
          ErrorCode.fileOperationFailed,
          { path: target },
        );
      } finally {
        own.settle();
      }
      this.known.update(target, false, isDirectory);
      this.host.emit('files.operation', { kind: 'deleted', path: target, isDirectory });
    }
  }

  private async copyNow(params: CommandParams<'files.copy'>): Promise<string[]> {
    const target = await this.existingDirectory(field(params, 'target'));
    const sources = await this.existingList(field(params, 'sources'));
    const rawName = field(params, 'newName');
    const newName = rawName === undefined ? undefined : requireName(rawName);
    if (newName !== undefined && sources.length !== 1) throw invalidParams('A new name is only possible for a single item.');
    if (sources.some((s) => this.guard.isRoot(s))) throw invalidParams('The project folder cannot be copied.');
    const copies: string[] = [];
    for (const source of outermost(sources)) {
      const isDirectory = (await this.fileOp(() => fs.promises.stat(source), source, 'copy')).isDirectory();
      if (isDirectory && isKeyWithin(keyOf(target), keyOf(source))) {
        throw new CommandError(`Cannot copy “${path.basename(source)}” into itself.`, ErrorCode.fileOperationFailed, {
          path: source,
        });
      }
      const taken = await this.namesIn(target);
      if (newName !== undefined && taken.has(keyOf(newName))) throw alreadyExists(path.join(target, newName));
      const name = newName ?? copyName(path.basename(source), isDirectory, (candidate) => taken.has(keyOf(candidate)));
      const destination = path.join(target, name);
      const own = this.own.expect(destination, true, true);
      try {
        await this.fileOp(
          () => fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false }),
          source,
          'copy',
        );
      } finally {
        own.settle(isDirectory ? null : await this.lstatOrNull(destination));
      }
      this.known.update(destination, true, isDirectory);
      this.host.emit('files.operation', { kind: 'copied', from: source, to: destination, isDirectory });
      copies.push(destination);
    }
    return copies;
  }

  /** Der Name, den `copy` für eine Kopie von `source` in `target` wählen würde. */
  async suggestCopyName(params: CommandParams<'files.suggestCopyName'>): Promise<string> {
    const target = await this.existingDirectory(field(params, 'target'));
    const source = await this.guard.existing(field(params, 'source'));
    const isDirectory = (await this.fileOp(() => fs.promises.stat(source), source, 'copy')).isDirectory();
    const taken = await this.namesIn(target);
    return copyName(path.basename(source), isDirectory, (candidate) => taken.has(keyOf(candidate)));
  }

  /** „Copy Path“: die absoluten Pfade, je Zeile einer, in die Zwischenablage (über den Port). */
  async copyPaths(params: CommandParams<'files.copyPaths'>): Promise<void> {
    const targets = await this.existingList(field(params, 'paths'));
    await this.options.shell.writeClipboard(targets.join('\n'));
  }

  /** „Open in Explorer“ (über den Port). */
  async showInExplorer(params: CommandParams<'files.showInExplorer'>): Promise<void> {
    this.options.shell.showInExplorer(await this.guard.existing(field(params, 'path')));
  }

  /** Neue Datei oder neuer Ordner, auch mit Unterordnern im Namen (`a/b/c.txt`). */
  private async create(params: { parent: string; name: string }, directory: boolean): Promise<string> {
    const parent = await this.existingDirectory(field(params, 'parent'));
    const name = field(params, 'name');
    if (typeof name !== 'string') throw invalidParams('A name is expected.');
    const split = splitNewName(name);
    if ('problem' in split) throw new CommandError(split.problem, ErrorCode.invalidFileName);
    const target = path.join(parent, ...split.segments);
    const firstNew = await this.firstMissing(parent, split.segments);
    if (firstNew === null) throw alreadyExists(target);
    const own = this.own.expect(firstNew, true, true);
    try {
      if (firstNew !== target) {
        await this.fileOp(() => fs.promises.mkdir(path.dirname(target), { recursive: true }), target, 'create');
      }
      if (directory) await this.fileOp(() => fs.promises.mkdir(target), target, 'create');
      else await this.fileOp(() => fs.promises.writeFile(target, '', { flag: 'wx' }), target, 'create');
    } finally {
      own.settle(firstNew === target ? await this.lstatOrNull(target) : null);
    }
    const firstIsDirectory = directory || firstNew !== target;
    this.known.update(firstNew, true, firstIsDirectory);
    // Ein Ereignis für den obersten neuen Eintrag; es gilt für alles darunter.
    this.host.emit('files.operation', { kind: 'created', path: firstNew, isDirectory: firstIsDirectory });
    return target;
  }

  /**
   * Der oberste Pfad unter `parent`, den es für die Teile eines neuen Namens noch nicht gibt; `null`, wenn es schon
   * alle gibt. Was es schon gibt, muss ein Ordner sein, der auch aufgelöst im Projekt liegt (keine Junction nach
   * draussen).
   */
  private async firstMissing(parent: string, segments: string[]): Promise<string | null> {
    let current = parent;
    for (const [i, segment] of segments.entries()) {
      const next = path.join(current, segment);
      const stat = await this.io(() => fs.promises.stat(next)).catch((err: unknown) => {
        if (isMissingError(err)) return null;
        throw fileError(err, next, 'create');
      });
      if (!stat) return next;
      if (i === segments.length - 1) return null;
      if (!stat.isDirectory()) throw alreadyExists(next);
      await this.guard.existing(next);
      current = next;
    }
    return null;
  }

  private async existingDirectory(value: unknown): Promise<string> {
    const dir = await this.guard.existing(value);
    const stat = await this.fileOp(() => fs.promises.stat(dir), dir, 'read');
    if (!stat.isDirectory()) throw invalidParams(`Not a folder: ${dir}`);
    return dir;
  }

  private async existingList(value: unknown): Promise<string[]> {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS_PER_COMMAND) {
      throw invalidParams('A list of paths is expected.');
    }
    return Promise.all(value.map((v: unknown) => this.guard.existing(v)));
  }

  private async entryOf(dir: string, dirent: fs.Dirent): Promise<FileEntry> {
    const full = path.join(dir, dirent.name);
    let isDirectory = dirent.isDirectory();
    // Ein Link (auch eine Junction) zeigt einen Ordner, wenn sein Ziel einer ist; ein toter Link gilt als Datei.
    if (dirent.isSymbolicLink()) {
      isDirectory = await this.io(() => fs.promises.stat(full)).then(
        (s) => s.isDirectory(),
        () => false,
      );
    }
    return { name: dirent.name, path: full, isDirectory };
  }

  /** Die Namen in einem Ordner, als Schlüssel ohne Gross-/Kleinschreibung. */
  private async namesIn(dir: string): Promise<Set<string>> {
    const names = await this.fileOp(() => fs.promises.readdir(dir), dir, 'read');
    return new Set(names.map(keyOf));
  }

  private lstatOrNull(target: string): Promise<fs.Stats | null> {
    return this.io(() => fs.promises.lstat(target)).catch(() => null);
  }

  /** Ein Dateizugriff über die Warteschlange; Fehler kommen als Fehler des Befehls mit englischer Meldung. */
  private async fileOp<T>(work: () => Promise<T>, target: string, action: string): Promise<T> {
    try {
      return await this.io(work);
    } catch (err) {
      throw fileError(err, target, action);
    }
  }
}

/** Ein Feld aus den Parametern eines Befehls; die Parameter kommen von der Oberfläche und sind ungeprüft. */
function field(params: unknown, name: string): unknown {
  return typeof params === 'object' && params !== null ? (params as Record<string, unknown>)[name] : undefined;
}

function invalidParams(message: string): CommandError {
  return new CommandError(message, ErrorCode.invalidParams);
}

/** Ein einzelner, unter Windows erlaubter Name. */
function requireName(value: unknown): string {
  if (typeof value !== 'string') throw invalidParams('A name is expected.');
  const problem = fileNameProblem(value);
  if (problem) throw new CommandError(problem, ErrorCode.invalidFileName);
  return value;
}

/** Ordner vor Dateien, dann alphabetisch; bei gleichem Namen ohne Gross-/Kleinschreibung entscheidet die Schreibweise. */
function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** Ohne Doppelte und ohne Pfade, die in einem anderen der Liste liegen. */
function outermost(targets: string[]): string[] {
  const sorted = [...targets].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const target of sorted) {
    if (!kept.some((k) => isKeyWithin(keyOf(target), keyOf(k)))) kept.push(target);
  }
  return targets.filter((t, i) => kept.includes(t) && targets.indexOf(t) === i);
}
