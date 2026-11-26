// Art von Java-Dateien für ihr Symbol im Dateibaum (Ticket 32): Lesen des Dateianfangs, Zwischenspeicher und neues
// Bestimmen nach Änderungen. Gedeutet wird mit der reinen Funktion in javaKind.ts. Lädt nie Electron.
//
// - Gelesen werden höchstens die ersten 64 KB, als nachrangige Arbeit der Warteschlange des Projekts (ioLimiter.ts):
//   Das Bestimmen von Tausenden Dateien hält das Lesen von Ordnern und andere Dateizugriffe nicht auf.
// - Gemerkt wird je Pfad die Art mit Änderungszeit und Grösse. Eine weitere Anfrage braucht dann nur `lstat`; gelesen
//   wird erst wieder, wenn sich einer der Werte geändert hat. Auch die Schreibweise des Pfads gehört dazu, weil die Art
//   vom Dateinamen abhängt und unter Windows ein Umbenennen nur in der Schreibweise denselben Schlüssel behält.
// - Nach einer Änderung (Dateiüberwachung, eigenes Speichern) bestimmt der Dienst gemerkte Dateien neu und meldet
//   geänderte Arten; nur gemerkte, damit etwa ein Build mit vielen erzeugten Dateien nichts liest, was niemand zeigt.
//   Der Aufwand je Meldung wächst mit ihren Pfaden, nicht mit Pfaden × gemerkten Dateien: Dateien werden direkt
//   nachgeschlagen, Ordner mit gemerktem Inhalt erkennt ein Index (folderIndex.ts, Review).
// - Eine Datei, die fehlt oder keine Datei ist, ist `java`, ungemerkt. Eine Datei, die sich nicht lesen lässt (etwa
//   gesperrt), ist `java` und wird mit ihrem Stand gemerkt, damit eine spätere Änderung neu bestimmt und meldet. Links
//   werden nicht gemerkt; ändert sich nur ihr Ziel, meldet der Dienst nichts.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FilesChangedEvent, JavaKind, JavaKindEntry } from '../../shared/types';
import { FolderIndex } from '../../shared/folderIndex';
import { decodeText } from './fileContent';
import { keyOf } from './fileTracking';
import { javaKindOf } from './javaKind';

/** So viel vom Anfang einer Java-Datei wird gelesen. */
export const JAVA_HEAD_BYTES = 64 * 1024;
/** Höchstzahl gemerkter Dateien; die am längsten nicht gebrauchten fallen dann weg. */
const CACHE_LIMIT = 50_000;

/** Was der Dienst von einem Eintrag wissen muss. */
export interface JavaFileStat {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mtimeMs: number;
  size: number;
}

/** Die Dateizugriffe des Dienstes; in Einheitstests durch Dateien im Speicher ersetzbar. */
export interface JavaFileSystem {
  lstat(target: string): Promise<JavaFileStat>;
  stat(target: string): Promise<JavaFileStat>;
  /** Liest höchstens `length` Bytes vom Anfang. */
  readHead(target: string, length: number): Promise<Buffer>;
}

const nodeFileSystem: JavaFileSystem = {
  lstat: (target) => fs.promises.lstat(target),
  stat: (target) => fs.promises.stat(target),
  async readHead(target, length) {
    const handle = await fs.promises.open(target, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

export interface JavaKindsOptions {
  /** Führt einen Dateizugriff nachrangig aus (siehe `IoLimiter.runInBackground`). */
  io: <T>(work: () => Promise<T>) => Promise<T>;
  /** Ob der echte Pfad eines Links im Projekt liegt; nur dann folgt das Lesen ihm. */
  isRealInside: (target: string) => Promise<boolean>;
  /** Meldet geänderte Arten gemerkter Dateien. */
  onChanged: (kinds: JavaKindEntry[]) => void;
  log: (message: string) => void;
  /** So viel vom Anfang wird gelesen (für Tests). */
  headBytes?: number;
  /** Dateizugriffe (für Tests); ohne Angabe die von Node. */
  fileSystem?: JavaFileSystem;
}

interface Cached {
  /** Der Pfad in der Schreibweise der letzten Anfrage; sein Name gehört zum Stand. */
  path: string;
  mtimeMs: number;
  size: number;
  kind: JavaKind;
}

/** Elternordner eines Schlüssels (siehe `keyOf`); `null` am Laufwerk. */
const parentKey = (key: string): string | null => {
  const dir = path.dirname(key);
  return dir === key ? null : dir;
};

const isMissing = (err: unknown) => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export class JavaKinds {
  private readonly cache = new Map<string, Cached>();
  /** Je Ordner, wie viele gemerkte Dateien darunter liegen. */
  private readonly folders = new FolderIndex(parentKey);
  /** Laufendes Bestimmen je Schlüssel; eine zweite Anfrage für denselben Pfad wartet darauf. */
  private readonly running = new Map<string, Promise<JavaKind>>();
  private readonly headBytes: number;
  private readonly fs: JavaFileSystem;
  private disposed = false;
  /** Wie viele Dateien gelesen und gedeutet wurden (für Tests und Messungen). */
  reads = 0;

  constructor(private readonly options: JavaKindsOptions) {
    this.headBytes = options.headBytes ?? JAVA_HEAD_BYTES;
    this.fs = options.fileSystem ?? nodeFileSystem;
  }

  /**
   * Nach dem Abbau des Projekts liest und meldet der Dienst nichts mehr; was noch in der Warteschlange steht, endet ohne
   * Dateizugriff. So liest Codium beim Beenden mit grossen Ordnern nicht noch Tausende Dateien.
   */
  dispose(): void {
    this.disposed = true;
  }

  /** Die Art der Dateien (geprüfte, normalisierte Pfade), in ihrer Reihenfolge. */
  async kindsOf(paths: readonly string[]): Promise<JavaKindEntry[]> {
    return Promise.all(paths.map(async (target) => ({ path: target, kind: await this.kindOf(target) })));
  }

  /**
   * Nach Änderungen der Dateiüberwachung: Gelöschtes wird vergessen, gemerkte Dateien an oder unter den geänderten
   * Pfaden werden neu bestimmt; nach einem Neueinlesen alle gemerkten (Inhalte meldet es nicht einzeln).
   */
  filesChanged(event: FilesChangedEvent): void {
    this.forgetAll(event.changes.filter((c) => c.kind === 'deleted').map((c) => c.path));
    if (event.rescanned) {
      void this.recheck([...this.cache.values()].map((entry) => entry.path));
      return;
    }
    const targets = new Map<string, string>();
    const folders = new Set<string>();
    for (const change of event.changes) {
      if (change.kind === 'deleted') continue;
      const key = keyOf(change.path);
      const entry = this.cache.get(key);
      if (entry) targets.set(key, entry.path);
      if (this.folders.hasEntriesBelow(key)) folders.add(key);
    }
    // Ein Ordner, der gelöscht und neu angelegt wurde: alles Gemerkte darin, in einem Durchlauf.
    if (folders.size > 0) for (const [key, entry] of this.cache) if (this.folders.ancestorIn(key, folders) !== null) targets.set(key, entry.path);
    void this.recheck([...targets.values()]);
  }

  /**
   * Eine Datei wurde in Codium gespeichert: Ist sie gemerkt oder wird sie gerade bestimmt (dann womöglich noch mit dem
   * alten Inhalt), wird sie neu bestimmt.
   */
  saved(target: string): void {
    const key = keyOf(target);
    if (this.cache.has(key) || this.running.has(key)) void this.recheck([target]);
  }

  /** Vergisst einen Pfad samt allem darunter, etwa nach dem Löschen in Codium. */
  forget(target: string): void {
    this.forgetAll([target]);
  }

  /**
   * Nach dem Umbenennen in Codium: Gemerktes unter einem umbenannten Ordner wandert mit (Name, Änderungszeit und Grösse
   * der Dateien bleiben). Eine umbenannte Datei selbst wird vergessen, denn ihre Art hängt vom Namen ab.
   */
  moved(from: string, to: string): void {
    const fromKey = keyOf(from);
    this.drop(fromKey);
    if (!this.folders.hasEntriesBelow(fromKey)) return;
    const within = new Set([fromKey]);
    const moving = [...this.cache].filter(([key]) => this.folders.ancestorIn(key, within) !== null);
    for (const [key, entry] of moving) {
      this.drop(key);
      const moved = path.join(to, entry.path.slice(from.length));
      this.remember(keyOf(moved), { ...entry, path: moved });
    }
  }

  /** Vergisst Pfade samt allem darunter: Dateien direkt, Ordner mit gemerktem Inhalt in einem Durchlauf. */
  private forgetAll(targets: readonly string[]): void {
    const folders = new Set<string>();
    for (const target of targets) {
      const key = keyOf(target);
      this.drop(key);
      if (this.folders.hasEntriesBelow(key)) folders.add(key);
    }
    if (folders.size === 0) return;
    for (const key of [...this.cache.keys()]) if (this.folders.ancestorIn(key, folders) !== null) this.drop(key);
  }

  /** Bestimmt Dateien neu und meldet die, deren Art sich gegenüber dem gemerkten Stand geändert hat. */
  private async recheck(targets: string[]): Promise<void> {
    if (targets.length === 0) return;
    const changed: JavaKindEntry[] = [];
    await Promise.all(
      targets.map(async (target) => {
        const key = keyOf(target);
        // Läuft gerade ein Bestimmen, hat es die Änderung womöglich verpasst: danach noch einmal.
        await this.running.get(key)?.catch(() => undefined);
        const before = this.cache.get(key)?.kind;
        const after = await this.kindOf(target);
        if (before !== undefined && before !== after) changed.push({ path: target, kind: after });
      }),
    );
    if (changed.length > 0 && !this.disposed) this.options.onChanged(changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
  }

  private kindOf(target: string): Promise<JavaKind> {
    const key = keyOf(target);
    const running = this.running.get(key);
    if (running) return running;
    const run = this.determine(target, key).finally(() => {
      if (this.running.get(key) === run) this.running.delete(key);
    });
    this.running.set(key, run);
    return run;
  }

  private async determine(target: string, key: string): Promise<JavaKind> {
    if (this.disposed) return 'java';
    try {
      return await this.options.io(async () => {
        if (this.disposed) return 'java';
        let stat = await this.fs.lstat(target);
        if (stat.isSymbolicLink()) {
          // Einem Link folgt das Lesen nur, wenn sein Ziel im Projekt liegt; gemerkt wird er nicht.
          if (!(await this.options.isRealInside(target))) return 'java';
          stat = await this.fs.stat(target);
          return stat.isFile() ? this.read(target, stat.size) : 'java';
        }
        if (!stat.isFile()) {
          this.drop(key);
          return 'java';
        }
        const cached = this.cache.get(key);
        if (cached && cached.path === target && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          // Zuletzt gebraucht: ans Ende, damit sie beim Überlauf zuletzt wegfällt.
          this.cache.delete(key);
          this.cache.set(key, cached);
          return cached.kind;
        }
        let kind: JavaKind;
        try {
          kind = await this.read(target, stat.size);
        } catch (err) {
          if (isMissing(err)) throw err;
          // Gesperrt oder ohne Rechte: `java`, aber mit dem Stand gemerkt, damit eine Änderung neu bestimmt und meldet.
          this.options.log(`Java-Datei ${target} nicht lesbar: ${(err as Error).message}`);
          kind = 'java';
        }
        this.remember(key, { path: target, mtimeMs: stat.mtimeMs, size: stat.size, kind });
        return kind;
      });
    } catch (err) {
      if (isMissing(err)) this.forget(target);
      else this.options.log(`Art der Java-Datei ${target} nicht bestimmt: ${(err as Error).message}`);
      return 'java';
    }
  }

  /** Liest den Anfang einer Datei und deutet ihn. */
  private async read(target: string, size: number): Promise<JavaKind> {
    this.reads++;
    const length = Math.min(size, this.headBytes);
    const head = await this.fs.readHead(target, length);
    const text = decodeHead(head, size > length);
    return text === null ? 'java' : javaKindOf(text, path.basename(target));
  }

  private remember(key: string, entry: Cached): void {
    if (!this.cache.delete(key)) this.folders.add(key);
    this.cache.set(key, entry);
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.drop(oldest);
    }
  }

  private drop(key: string): void {
    if (this.cache.delete(key)) this.folders.remove(key);
  }
}

/**
 * Der Text des Dateianfangs wie beim Öffnen (decodeText: BOM, UTF-16, UTF-8, sonst Windows-1252); `null` bei Binärem.
 * Ist der Anfang abgeschnitten, endet er beim letzten Zeilenumbruch, damit kein halbes UTF-8-Zeichen die Erkennung
 * als UTF-8 verdirbt.
 */
export function decodeHead(head: Buffer, truncated: boolean): string | null {
  if (!truncated) return decodeText(head)?.text ?? null;
  const utf16 = head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff));
  if (utf16) return decodeText(head.subarray(0, head.length - (head.length % 2)))?.text ?? null;
  const lastNewline = head.lastIndexOf(0x0a);
  return decodeText(lastNewline > 0 ? head.subarray(0, lastNewline + 1) : head)?.text ?? null;
}
