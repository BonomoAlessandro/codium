// Datei-Dienst eines Projekts: Ordnerinhalte für den Dateibaum, Dateioperationen und die Überwachung des
// Projektordners (fileWatcher.ts), Lesen von Dateiinhalten für Tabs (fileContent.ts). Das Schreiben kommt mit
// Ticket 07. Lädt nie Electron.
//
// - Jeder Befehl prüft seine Pfade (pathGuard.ts): absolut, vorhanden und auch nach dem Auflösen von `..`,
//   Junctions und symbolischen Links im Projekt. Was nur den Eintrag selbst betrifft (Löschen, Umbenennen, Pfad
//   kopieren, im Explorer zeigen), folgt einem Link nicht; so lassen sich auch Links nach draussen bedienen.
// - Im Ordner `.git` ändert kein Befehl etwas.
// - Alle Dateizugriffe auf Projektpfade sind asynchron und laufen über eine Warteschlange mit wenigen gleichzeitigen
//   Zugriffen (ioLimiter.ts); ein hängendes Netzlaufwerk hält so weder den Hauptprozess noch andere Projekte auf.
// - Jede Dateioperation meldet `files.operation`, sobald sie fertig ist. Die Überwachung meldet sie nicht noch einmal
//   als Änderung von aussen. Dauert eine Operation länger als etwa eine Sekunde, zeigt die Statusleiste Fortschritt.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { copyName, fileNameProblem, GIT_FOLDER_PROBLEM, isGitFolderName, splitNewName } from '../../shared/fileNames';
import {
  ErrorCode,
  MAX_OPEN_FILE_BYTES,
  MAX_PREVIEW_IMAGE_BYTES,
  type CommandParams,
  type EventName,
  type Events,
  type FileContent,
  type FileEntry,
  type LineEnding,
  type TextEncoding,
} from '../../shared/types';
import {
  countLineEndings,
  decodeFileContent,
  decodeText,
  encodeExact,
  encodeText,
  imageType,
  stampOf,
  UnencodableError,
  withPreservedLineEndings,
} from './fileContent';
import { KnownDirs, OwnChanges, keyOf } from './fileTracking';
import { FileWatcher } from './fileWatcher';
import { IoLimiter } from './ioLimiter';
import { PathGuard, alreadyExists, fileError, isMissingError, isPathWithin } from './pathGuard';
import type { ShellActionsPort } from './ports';
import type { Progress, ProgressReporter } from './progress';
import { isKeyWithin } from './projectPath';
import { CommandError } from './router';

/** Gleichzeitige Dateizugriffe eines Projekts. */
const IO_CONCURRENCY = 4;
/** Höchstzahl Pfade in einem Befehl. */
const MAX_PATHS_PER_COMMAND = 10_000;
/** Ab dieser Dauer zeigt eine Dateioperation Fortschritt in der Statusleiste. */
export const PROGRESS_DELAY_MS = 1000;
const TEXT_ENCODINGS: readonly TextEncoding[] = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252'];
/** Stichprobe für das überwiegende Zeilenende im Projekt: so viele Textdateien, je so viele Bytes vom Anfang. */
const LINE_ENDING_SAMPLE_FILES = 200;
const LINE_ENDING_SAMPLE_BYTES = 16 * 1024;
/** So lange gilt das gezählte Zeilenende des Projekts. */
const LINE_ENDING_CACHE_MS = 60_000;
/** Ordner, die beim Zählen der Zeilenenden übersprungen werden (Fremdes oder Erzeugtes). */
const SKIPPED_FOR_LINE_ENDINGS = new Set(['.git', 'node_modules', 'target', 'build', 'dist', 'out', '.gradle', '.idea']);
/** So oft wird ein anderer Name versucht, wenn ein gleichzeitiger Vorgang den gewählten schon belegt hat. */
const COPY_NAME_ATTEMPTS = 5;

/** Sortierung im Dateibaum: alphabetisch ohne Unterscheidung der Gross-/Kleinschreibung, unabhängig vom Rechner. */
const collator = new Intl.Collator('en', { sensitivity: 'base' });

/** Was der Datei-Dienst vom Projekt-Kern braucht. */
export interface FileServiceHost {
  readonly path: string;
  /** Fortschritt für die Statusleiste des Projektfensters. */
  readonly progress: ProgressReporter;
  emit<K extends EventName>(name: K, payload: Events[K]): void;
  onDispose(cleanup: () => void | Promise<void>): void;
}

export interface FileServiceOptions {
  shell: ShellActionsPort;
  log: (message: string) => void;
  /** Die aufgeklappten Ordner beim Start (absolute Pfade). */
  expandedFolders?: string[];
  /** Wartezeiten der Überwachung (siehe fileWatcher.ts) und bis Fortschritt erscheint, für Tests. */
  watchDebounceMs?: number;
  watchMaxDelayMs?: number;
  progressDelayMs?: number;
}

/** Bis wohin eine Kopie gekommen ist: Erst wenn ihr oberster Eintrag angelegt ist, gehört er der Kopie. */
interface CopyProgress {
  createdTop: boolean;
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
  /** Kopien je Zielordner, nacheinander (Schlüssel des Zielordners → Ende der letzten). */
  private readonly copyQueues = new Map<string, Promise<unknown>>();
  /** Die aufgeklappten Ordner; nur ihren Inhalt merkt sich der Dienst für die Überwachung. */
  private expandedKeys: Set<string>;
  private readonly progressDelayMs: number;

  constructor(
    private readonly host: FileServiceHost,
    private readonly options: FileServiceOptions,
  ) {
    this.guard = new PathGuard(host.path, this.io);
    this.expandedKeys = new Set((options.expandedFolders ?? [host.path]).map(keyOf));
    this.progressDelayMs = options.progressDelayMs ?? PROGRESS_DELAY_MS;
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

  /**
   * Die aufgeklappten Ordner (geprüfte absolute Pfade). Nur deren Inhalt merkt sich der Dienst; so liest die
   * Überwachung nach verpassten Ereignissen nur sie neu ein, nicht auch längst zugeklappte.
   */
  setExpandedFolders(paths: string[]): void {
    this.expandedKeys = new Set(paths.map(keyOf));
    this.known.retain(this.expandedKeys);
  }

  /** Inhalt eines Ordners: Ordner vor Dateien, alphabetisch, ohne `.git`. */
  async list(params: CommandParams<'files.list'>): Promise<FileEntry[]> {
    const dir = await this.existingDirectory(field(params, 'path'));
    const dirents = await this.fileOp(() => fs.promises.readdir(dir, { withFileTypes: true }), dir, 'read');
    const entries = await Promise.all(dirents.map((d) => this.entryOf(dir, d)));
    if (this.expandedKeys.has(keyOf(dir))) this.known.remember(dir, entries);
    return entries.filter((e) => !isGitFolderName(e.name)).sort(compareEntries);
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

  /**
   * Kopiert in einen Ordner; bei einem Namenskonflikt mit Zusatz („Name (2).ext“), mit `newName` unter diesem Namen.
   * Kopien in denselben Zielordner laufen nacheinander, damit zwei gleichzeitige nicht denselben Namen wählen.
   */
  copy(params: CommandParams<'files.copy'>): Promise<string[]> {
    return this.track(() => this.copyNow(params));
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
    const targets = await this.entryList(field(params, 'paths'));
    await this.options.shell.writeClipboard(targets.join('\n'));
  }

  /** „Open in Explorer“ (über den Port). */
  async showInExplorer(params: CommandParams<'files.showInExplorer'>): Promise<void> {
    this.options.shell.showInExplorer(await this.guard.entry(field(params, 'path')));
  }

  /**
   * Liest eine Datei für einen Tab (siehe `FileContent` und fileContent.ts). Ab `MAX_OPEN_FILE_BYTES` wird nichts
   * gelesen; wächst die Datei zwischen Prüfung und Lesen über die Grenze, gilt sie ebenfalls als zu gross.
   */
  async read(params: CommandParams<'files.read'>): Promise<FileContent> {
    const file = await this.guard.existing(field(params, 'path'));
    const stats = await this.fileOp(() => fs.promises.stat(file), file, 'read');
    if (stats.isDirectory()) throw new CommandError(`Not a file: ${file}`, ErrorCode.notAFile, { path: file });
    if (stats.size >= MAX_OPEN_FILE_BYTES) return { kind: 'tooLarge', size: stats.size };
    const data = await this.fileOp(() => fs.promises.readFile(file), file, 'read');
    if (data.length >= MAX_OPEN_FILE_BYTES) return { kind: 'tooLarge', size: data.length };
    const content = decodeFileContent(file, data);
    // Ohne Zeilenumbruch (etwa eine neue, leere Datei) gilt das Zeilenende, das im Projekt überwiegt.
    if (content.kind === 'text' && !content.text.includes('\n')) return { ...content, lineEnding: await this.projectLineEnding() };
    return content;
  }

  /**
   * Schreibt eine Datei in der angegebenen Kodierung (mit BOM) und mit dem angegebenen Zeilenende; sonst wird nichts
   * verändert. Die Datei muss es geben. Die Überwachung meldet den eigenen Schreibvorgang nicht als Änderung von aussen;
   * eine fremde Änderung kurz danach schon.
   */
  write(params: CommandParams<'files.write'>): Promise<{ stamp: string }> {
    return this.track(async () => {
      const file = await this.guard.existing(field(params, 'path'));
      await this.guard.assertOutsideGit(file, 'follow');
      const text = field(params, 'text');
      const encoding = field(params, 'encoding') as TextEncoding;
      const lineEnding = field(params, 'lineEnding');
      const expectedStamp = field(params, 'expectedStamp');
      if (typeof text !== 'string') throw invalidParams('A text is expected.');
      if (!TEXT_ENCODINGS.includes(encoding)) throw invalidParams('An encoding is expected.');
      if (lineEnding !== 'LF' && lineEnding !== 'CRLF') throw invalidParams('A line ending is expected.');
      if (expectedStamp !== undefined && typeof expectedStamp !== 'string') throw invalidParams('A stamp is expected.');
      const stats = await this.fileOp(() => fs.promises.stat(file), file, 'save');
      if (stats.isDirectory()) throw new CommandError(`Not a file: ${file}`, ErrorCode.notAFile, { path: file });
      // Der bisherige Inhalt: für die Prüfung des Stands und für die Zeilenenden unveränderter Zeilen.
      const current = stats.size < MAX_OPEN_FILE_BYTES ? await this.fileOp(() => fs.promises.readFile(file), file, 'save') : null;
      if (expectedStamp !== undefined && (current === null || stampOf(current) !== expectedStamp)) {
        throw new CommandError(`“${path.basename(file)}” changed on disk.`, ErrorCode.fileChanged, { path: file });
      }
      const previous = current === null ? null : decodeText(current);
      let bytes: Buffer;
      try {
        bytes =
          previous !== null && previous.encoding === encoding
            ? encodeExact(withPreservedLineEndings(previous.text, text, lineEnding), encoding)
            : encodeText(text, encoding, lineEnding);
      } catch (err) {
        if (err instanceof UnencodableError) {
          throw new CommandError(err.message, ErrorCode.cannotEncode, { path: file, character: err.character });
        }
        throw err;
      }
      if (bytes.length >= MAX_OPEN_FILE_BYTES) throw invalidParams('The text is too large to save.');
      // Bekannte Grenze: Zwischen der Prüfung des Stands und dem Schreiben vergeht wenig Zeit; was ein anderes Programm
      // genau dann schreibt, geht verloren. Die Oberfläche erfährt es nicht.
      const own = this.own.expect(file, true, false);
      try {
        await this.fileOp(() => fs.promises.writeFile(file, bytes), file, 'save');
      } catch (err) {
        own.discard();
        throw err;
      }
      own.settle(await this.stamp(file));
      return { stamp: stampOf(bytes) };
    });
  }

  /**
   * Das im Projekt überwiegende Zeilenende, für neue Dateien (Rückfall LF). Gezählt wird in einer Stichprobe von
   * Textdateien, ohne `.git` und ohne grosse Ordner mit Fremdem (node_modules, Build-Ausgaben); das Ergebnis gilt eine
   * Weile.
   */
  private projectLineEnding(): Promise<LineEnding> {
    const now = Date.now();
    if (this.lineEndingCache && now - this.lineEndingCache.at < LINE_ENDING_CACHE_MS) return this.lineEndingCache.value;
    const value = this.sampleLineEndings().catch(() => 'LF' as const);
    this.lineEndingCache = { value, at: now };
    return value;
  }

  private lineEndingCache: { value: Promise<LineEnding>; at: number } | null = null;

  private async sampleLineEndings(): Promise<LineEnding> {
    let crlf = 0;
    let lf = 0;
    let files = 0;
    const queue = [this.host.path];
    while (queue.length > 0 && files < LINE_ENDING_SAMPLE_FILES) {
      const dir = queue.shift()!;
      const dirents = await this.io(() => fs.promises.readdir(dir, { withFileTypes: true })).catch(() => []);
      for (const dirent of dirents) {
        if (files >= LINE_ENDING_SAMPLE_FILES) break;
        const target = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (!SKIPPED_FOR_LINE_ENDINGS.has(dirent.name.toLowerCase())) queue.push(target);
          continue;
        }
        if (!dirent.isFile()) continue;
        const head = await this.io(async () => {
          const handle = await fs.promises.open(target, 'r');
          try {
            const buffer = Buffer.alloc(LINE_ENDING_SAMPLE_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return buffer.subarray(0, bytesRead);
          } finally {
            await handle.close();
          }
        }).catch(() => null);
        if (!head || head.includes(0)) continue;
        const counts = countLineEndings(head.toString('latin1'));
        if (counts.crlf + counts.lf === 0) continue;
        files++;
        crlf += counts.crlf;
        lf += counts.lf;
      }
    }
    return crlf > lf ? 'CRLF' : 'LF';
  }

  /**
   * Ein Bild für die Markdown-Vorschau als data-URL: nur Bilder (nach der Endung, dazu SVG), höchstens
   * `MAX_PREVIEW_IMAGE_BYTES`. SVG kommt als Bild, nicht als Text: In einem `<img>` laufen keine Skripte.
   */
  async readImage(params: CommandParams<'files.readImage'>): Promise<{ dataUrl: string; size: number }> {
    const file = await this.guard.existing(field(params, 'path'));
    const mime = imageType(file) ?? (path.extname(file).toLowerCase() === '.svg' ? 'image/svg+xml' : undefined);
    if (!mime) throw invalidParams(`Not an image: ${file}`);
    const stats = await this.fileOp(() => fs.promises.stat(file), file, 'read');
    if (stats.isDirectory()) throw new CommandError(`Not a file: ${file}`, ErrorCode.notAFile, { path: file });
    const tooLarge = () =>
      new CommandError(`“${path.basename(file)}” is larger than 10 MB.`, ErrorCode.fileTooLarge, { path: file });
    if (stats.size > MAX_PREVIEW_IMAGE_BYTES) throw tooLarge();
    const data = await this.fileOp(() => fs.promises.readFile(file), file, 'read');
    if (data.length > MAX_PREVIEW_IMAGE_BYTES) throw tooLarge();
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}`, size: data.length };
  }

  /**
   * Welche der Pfade Dateien im Projekt sind, die es gibt (geprüft wie bei `read`). Für das Wiederherstellen der Tabs;
   * ein Pfad, der sich nicht prüfen lässt, gilt als fehlend.
   */
  async existingFiles(paths: readonly string[]): Promise<boolean[]> {
    return Promise.all(
      paths.map(async (target) => {
        try {
          const file = await this.guard.existing(target);
          return (await this.io(() => fs.promises.stat(file))).isFile();
        } catch {
          return false;
        }
      }),
    );
  }

  /** Führt eine Dateioperation aus und merkt sie sich, bis sie fertig ist. */
  private track<T>(work: () => Promise<T>): Promise<T> {
    const run = work();
    this.running.add(run);
    const done = () => this.running.delete(run);
    run.then(done, done);
    return run;
  }

  /** Ändert nur den Namen; einem Link folgt das Umbenennen nicht, es benennt den Link selbst um. */
  private async renameNow(params: CommandParams<'files.rename'>): Promise<string> {
    const source = await this.guard.entry(field(params, 'path'));
    if (this.guard.isRoot(source)) throw invalidParams('The project folder cannot be renamed.');
    await this.guard.assertOutsideGit(source, 'entry');
    const newName = requireName(field(params, 'newName'));
    if (isGitFolderName(newName)) throw new CommandError(GIT_FOLDER_PROBLEM, ErrorCode.invalidFileName);
    const target = path.join(path.dirname(source), newName);
    if (target === source) return source;
    // Unter Windows ersetzt `fs.rename` ein vorhandenes Ziel. Ein vorhandenes Ziel ist deshalb nur erlaubt, wenn es
    // dieselbe Datei ist, also nur die Schreibweise wechselt (gleiche Datei-Nummer auf demselben Laufwerk). Ein
    // Vergleich der Namen genügt nicht: JavaScript faltet etwa das Kelvin-Zeichen zu „k“, NTFS nicht.
    // Bekannte Grenze: Zwischen dieser Prüfung und dem Umbenennen bleibt ein kurzes Zeitfenster, in dem ein anderer
    // Prozess das Ziel anlegen und dann verlieren könnte; Node bietet unter Windows kein Umbenennen ohne Ersetzen.
    const sourceStat = await this.fileOp(() => fs.promises.lstat(source, { bigint: true }), source, 'rename');
    const targetStat = await this.lstatOrNull(target, 'rename');
    if (targetStat && !sameFile(sourceStat, targetStat, path.basename(source), newName)) throw alreadyExists(target);
    const isDirectory = await this.entryIsDirectory(source, sourceStat.isDirectory(), sourceStat.isSymbolicLink());
    const gone = this.own.expect(source, false, true);
    const added = this.own.expect(target, true, true);
    try {
      await this.fileOp(() => fs.promises.rename(source, target), source, 'rename');
    } catch (err) {
      gone.discard();
      added.discard();
      throw err;
    }
    gone.settle();
    added.settle(await this.stamp(target));
    this.known.update(source, false, isDirectory);
    this.known.update(target, true, isDirectory);
    this.host.emit('files.operation', { kind: 'renamed', from: source, to: target, isDirectory });
    return target;
  }

  private async deleteNow(params: CommandParams<'files.delete'>): Promise<void> {
    const targets = await this.entryList(field(params, 'paths'));
    if (targets.some((t) => this.guard.isRoot(t))) throw invalidParams('The project folder cannot be deleted.');
    for (const target of targets) await this.guard.assertOutsideGit(target, 'entry');
    const list = outermost(targets);
    const title = list.length === 1 ? `Deleting “${path.basename(list[0])}”…` : `Deleting ${list.length} items…`;
    await this.withProgress(title, async (report) => {
      for (const [i, target] of list.entries()) {
        report(i / list.length);
        const stat = await this.fileOp(() => fs.promises.lstat(target), target, 'delete');
        const isDirectory = await this.entryIsDirectory(target, stat.isDirectory(), stat.isSymbolicLink());
        const own = this.own.expect(target, false, true);
        try {
          // Der Papierkorb nimmt einen Link selbst, nicht sein Ziel.
          await this.options.shell.trash(target);
        } catch (err) {
          own.discard();
          this.options.log(`Papierkorb für ${target} fehlgeschlagen: ${(err as Error).message}`);
          throw new CommandError(`Could not move “${path.basename(target)}” to the Recycle Bin.`, ErrorCode.fileOperationFailed, {
            path: target,
          });
        }
        own.settle();
        this.known.update(target, false, isDirectory);
        this.host.emit('files.operation', { kind: 'deleted', path: target, isDirectory });
      }
    });
  }

  private async copyNow(params: CommandParams<'files.copy'>): Promise<string[]> {
    const target = await this.existingDirectory(field(params, 'target'));
    await this.guard.assertOutsideGit(target, 'follow');
    const sources = await this.existingList(field(params, 'sources'));
    const rawName = field(params, 'newName');
    const newName = rawName === undefined ? undefined : requireName(rawName);
    if (newName !== undefined && sources.length !== 1) throw invalidParams('A new name is only possible for a single item.');
    if (newName !== undefined && isGitFolderName(newName)) throw new CommandError(GIT_FOLDER_PROBLEM, ErrorCode.invalidFileName);
    if (sources.some((s) => this.guard.isRoot(s))) throw invalidParams('The project folder cannot be copied.');
    return this.serialized(keyOf(target), async () => {
      const copies: string[] = [];
      for (const source of outermost(sources)) copies.push(await this.copyOne(source, target, newName));
      return copies;
    });
  }

  /** Eine Kopie in den Zielordner; bei einem Fehler bleibt nichts Halbes zurück, oder der Baum erfährt davon. */
  private async copyOne(source: string, target: string, newName: string | undefined): Promise<string> {
    const isDirectory = (await this.fileOp(() => fs.promises.stat(source), source, 'copy')).isDirectory();
    if (isDirectory) {
      // Auf den echten Pfaden geprüft: auch über eine Junction in einen Unterordner der Quelle nicht in sich selbst.
      const [realSource, realTarget] = await Promise.all([
        this.fileOp(() => fs.promises.realpath(source), source, 'copy'),
        this.fileOp(() => fs.promises.realpath(target), target, 'copy'),
      ]);
      if (isPathWithin(realTarget, realSource)) {
        throw new CommandError(`Cannot copy “${path.basename(source)}” into itself.`, ErrorCode.fileOperationFailed, {
          path: source,
        });
      }
    }
    for (let attempt = 1; ; attempt++) {
      const taken = await this.namesIn(target);
      if (newName !== undefined && taken.has(keyOf(newName))) throw alreadyExists(path.join(target, newName));
      const name = newName ?? copyName(path.basename(source), isDirectory, (candidate) => taken.has(keyOf(candidate)));
      if (isGitFolderName(name)) throw invalidParams(GIT_FOLDER_PROBLEM);
      const destination = path.join(target, name);
      const own = this.own.expect(destination, true, true);
      const progress: CopyProgress = { createdTop: false };
      try {
        await this.withProgress(`Copying “${path.basename(source)}”…`, () => this.copyEntry(source, destination, progress));
      } catch (err) {
        own.discard();
        // Ein anderer Vorgang war schneller und hat den Namen belegt: Dann gehört das Ziel nicht dieser Kopie.
        if (!progress.createdTop && isExistsError(err) && newName === undefined && attempt < COPY_NAME_ATTEMPTS) continue;
        throw await this.failedCopy(err, source, destination, progress, isDirectory);
      }
      own.settle(isDirectory ? null : await this.stamp(destination));
      await this.guard.assertRealInside(destination);
      await this.guard.assertOutsideGit(destination, 'entry');
      this.known.update(destination, true, isDirectory);
      this.host.emit('files.operation', { kind: 'copied', from: source, to: destination, isDirectory });
      return destination;
    }
  }

  /**
   * Kopiert einen Eintrag samt Inhalt. Links werden nicht verfolgt: Ein Link auf einen Ordner wird als Junction auf
   * dasselbe Ziel neu angelegt (geht ohne besondere Rechte), ein Link auf eine Datei im Projekt als Kopie ihres
   * Inhalts. Ein Link auf eine Datei ausserhalb wird als Link angelegt; den Inhalt von draussen holt die Kopie nicht.
   */
  private async copyEntry(source: string, destination: string, progress: CopyProgress | null): Promise<void> {
    const stat = await this.io(() => fs.promises.lstat(source));
    if (stat.isSymbolicLink()) {
      const real = await this.io(() => fs.promises.realpath(source)).catch(() => null);
      const targetIsDirectory = real ? await this.io(() => fs.promises.stat(real)).then((s) => s.isDirectory(), () => false) : false;
      if (real === null) {
        // Ein toter Link bleibt ein toter Link auf dasselbe Ziel.
        const linkTarget = path.resolve(path.dirname(source), await this.io(() => fs.promises.readlink(source)));
        await this.io(() => fs.promises.symlink(linkTarget, destination, 'junction'));
      } else if (targetIsDirectory) {
        await this.io(() => fs.promises.symlink(real, destination, 'junction'));
      } else if (await this.guard.isRealInside(real)) {
        await this.io(() => fs.promises.copyFile(real, destination, fs.constants.COPYFILE_EXCL));
      } else {
        await this.io(() => fs.promises.symlink(real, destination, 'file')).catch((err: unknown) => {
          if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
          throw new CommandError(
            `Could not copy the link “${path.basename(source)}”: links to files outside the project can only be copied with Windows Developer Mode.`,
            ErrorCode.fileOperationFailed,
            { path: source },
          );
        });
      }
      if (progress) progress.createdTop = true;
      return;
    }
    if (stat.isDirectory()) {
      await this.io(() => fs.promises.mkdir(destination));
      if (progress) progress.createdTop = true;
      const names = await this.io(() => fs.promises.readdir(source));
      for (const name of names) await this.copyEntry(path.join(source, name), path.join(destination, name), null);
      return;
    }
    await this.io(() => fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL));
    if (progress) progress.createdTop = true;
  }

  /**
   * Nach einer gescheiterten Kopie: Was sie angelegt hat, wird wieder entfernt. Geht das nicht, meldet der Dienst den
   * Rest als angelegt, damit der Baum ihn zeigt. Liefert den Fehler für den Befehl.
   */
  private async failedCopy(
    err: unknown,
    source: string,
    destination: string,
    progress: CopyProgress,
    isDirectory: boolean,
  ): Promise<CommandError> {
    const failedAt = typeof (err as NodeJS.ErrnoException).path === 'string' ? (err as NodeJS.ErrnoException).path! : source;
    const reason = fileError(err, failedAt, 'copy');
    if (!progress.createdTop) return reason;
    try {
      await this.removeTree(destination);
      return reason;
    } catch (removeErr) {
      this.options.log(`Halbe Kopie ${destination} nicht entfernt: ${(removeErr as Error).message}`);
      this.host.emit('files.operation', { kind: 'created', path: destination, isDirectory });
      return new CommandError(
        `${reason.message} The incomplete copy “${path.basename(destination)}” could not be removed.`,
        ErrorCode.fileOperationFailed,
        { path: destination },
      );
    }
  }

  /** Entfernt, was eine Kopie angelegt hat; Links nur als Link, nie ihr Ziel. */
  private async removeTree(target: string): Promise<void> {
    const stat = await this.io(() => fs.promises.lstat(target)).catch((err: unknown) => {
      if (isMissingError(err)) return null;
      throw err;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      // Eine Junction auf einen Ordner geht mit rmdir, ein Link auf eine Datei mit unlink.
      await this.io(() => fs.promises.rmdir(target)).catch(() => this.io(() => fs.promises.unlink(target)));
      return;
    }
    if (stat.isDirectory()) {
      for (const name of await this.io(() => fs.promises.readdir(target))) await this.removeTree(path.join(target, name));
      await this.io(() => fs.promises.rmdir(target));
      return;
    }
    await this.io(() => fs.promises.unlink(target));
  }

  /** Arbeiten mit demselben Schlüssel laufen nacheinander. */
  private serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.copyQueues.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.copyQueues.set(key, tail);
    void tail.then(() => {
      if (this.copyQueues.get(key) === tail) this.copyQueues.delete(key);
    });
    return run;
  }

  /**
   * Führt eine Arbeit aus; dauert sie länger als `progressDelayMs`, zeigt die Statusleiste Fortschritt. `report`
   * meldet den Stand (0 bis 1).
   */
  private async withProgress<T>(title: string, work: (report: (fraction?: number) => void) => Promise<T>): Promise<T> {
    const state: { fraction?: number; shown: Progress | null } = { shown: null };
    const timer = setTimeout(() => {
      state.shown = this.host.progress.begin(title, state.fraction);
    }, this.progressDelayMs);
    try {
      return await work((fraction) => {
        state.fraction = fraction;
        state.shown?.report({ fraction });
      });
    } finally {
      clearTimeout(timer);
      state.shown?.end();
    }
  }

  /** Neue Datei oder neuer Ordner, auch mit Unterordnern im Namen (`a/b/c.txt`). */
  private async create(params: { parent: string; name: string }, directory: boolean): Promise<string> {
    const parent = await this.existingDirectory(field(params, 'parent'));
    await this.guard.assertOutsideGit(parent, 'follow');
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
    } catch (err) {
      own.discard();
      throw err;
    }
    own.settle(firstNew === target ? await this.stamp(target) : null);
    await this.guard.assertRealInside(target);
    await this.guard.assertOutsideGit(target, 'entry');
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
      // lstat: Auch ein toter Link gilt als vorhanden; durch ihn hindurch wird nichts angelegt.
      const own = await this.io(() => fs.promises.lstat(next)).catch((err: unknown) => {
        if (isMissingError(err)) return null;
        throw fileError(err, next, 'create');
      });
      if (!own) return next;
      if (i === segments.length - 1) return null;
      if (own.isSymbolicLink()) {
        // Ein Link als Zwischenordner muss aufgelöst im Projekt liegen, und nicht in `.git`.
        await this.guard.existing(next);
        await this.guard.assertOutsideGit(next, 'follow');
      }
      const stat = own.isSymbolicLink() ? await this.fileOp(() => fs.promises.stat(next), next, 'create') : own;
      if (!stat.isDirectory()) throw alreadyExists(next);
      current = next;
    }
    return null;
  }

  /** Ob ein Eintrag ein Ordner ist; bei einem Link zählt das Ziel (fehlt es, gilt er als Datei). */
  private async entryIsDirectory(target: string, isDirectory: boolean, isLink: boolean): Promise<boolean> {
    if (!isLink) return isDirectory;
    return this.io(() => fs.promises.stat(target)).then(
      (s) => s.isDirectory(),
      () => false,
    );
  }

  private async existingDirectory(value: unknown): Promise<string> {
    const dir = await this.guard.existing(value);
    const stat = await this.fileOp(() => fs.promises.stat(dir), dir, 'read');
    if (!stat.isDirectory()) throw invalidParams(`Not a folder: ${dir}`);
    return dir;
  }

  private async existingList(value: unknown): Promise<string[]> {
    return Promise.all(requireList(value).map((v) => this.guard.existing(v)));
  }

  /** Wie `existingList`, aber für Operationen auf dem Eintrag selbst (siehe `PathGuard.entry`). */
  private async entryList(value: unknown): Promise<string[]> {
    return Promise.all(requireList(value).map((v) => this.guard.entry(v)));
  }

  /**
   * Ein Eintrag für den Baum. Ein Link (auch eine Junction) zeigt einen Ordner, wenn sein Ziel einer im Projekt ist;
   * einer nach draussen oder ein toter Link wird markiert, damit der Baum ihn nicht aufklappt.
   */
  private async entryOf(dir: string, dirent: fs.Dirent): Promise<FileEntry> {
    const full = path.join(dir, dirent.name);
    if (!dirent.isSymbolicLink()) return { name: dirent.name, path: full, isDirectory: dirent.isDirectory() };
    const real = await this.io(() => fs.promises.realpath(full)).catch(() => null);
    if (real === null) return { name: dirent.name, path: full, isDirectory: false, blockedLink: 'missing' };
    const isDirectory = await this.io(() => fs.promises.stat(full)).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!(await this.guard.isRealInside(real))) return { name: dirent.name, path: full, isDirectory, blockedLink: 'outside' };
    return { name: dirent.name, path: full, isDirectory };
  }

  /** Die Namen in einem Ordner, als Schlüssel ohne Gross-/Kleinschreibung. */
  private async namesIn(dir: string): Promise<Set<string>> {
    const names = await this.fileOp(() => fs.promises.readdir(dir), dir, 'read');
    return new Set(names.map(keyOf));
  }

  /** `lstat` mit grossen Zahlen (Datei-Nummer); `null` nur, wenn es den Pfad nicht gibt, sonst ein Fehler des Befehls. */
  private lstatOrNull(target: string, action: string): Promise<fs.BigIntStats | null> {
    return this.io(() => fs.promises.lstat(target, { bigint: true })).catch((err: unknown) => {
      if (isMissingError(err)) return null;
      throw fileError(err, target, action);
    });
  }

  /** Der Stand einer Datei nach einer eigenen Operation (für `OwnChanges`); `null`, wenn er sich nicht lesen lässt. */
  private stamp(target: string): Promise<fs.Stats | null> {
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

function requireList(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS_PER_COMMAND) {
    throw invalidParams('A list of paths is expected.');
  }
  return value;
}

/** Ein einzelner, unter Windows erlaubter Name. */
function requireName(value: unknown): string {
  if (typeof value !== 'string') throw invalidParams('A name is expected.');
  const problem = fileNameProblem(value);
  if (problem) throw new CommandError(problem, ErrorCode.invalidFileName);
  return value;
}

/** Ob ein Fehler heisst: Am Ziel gibt es schon etwas. */
function isExistsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EEXIST' || (err instanceof CommandError && err.code === ErrorCode.fileExists);
}

/**
 * Ob zwei Einträge dieselbe Datei sind: gleiche Datei-Nummer auf demselben Laufwerk. Manche Laufwerke (etwa Freigaben)
 * melden keine Datei-Nummer (0); dann gilt nur ein Unterschied in der Gross-/Kleinschreibung von A bis Z als dieselbe
 * Datei, im Zweifel also nicht.
 */
function sameFile(a: fs.BigIntStats, b: fs.BigIntStats, nameA: string, nameB: string): boolean {
  if (a.ino !== 0n && b.ino !== 0n) return a.dev === b.dev && a.ino === b.ino;
  const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return asciiLower(nameA) === asciiLower(nameB);
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
