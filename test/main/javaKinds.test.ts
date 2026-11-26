// Teststelle 1: Art von Java-Dateien für ihr Symbol im Dateibaum (Ticket 32) am Vertrag, mit echtem Dateisystem:
// Anfrage je Ordner, Lesen des Dateianfangs, Zwischenspeicher je Pfad mit Änderungszeit und Grösse und neues Bestimmen
// nach Änderungen von aussen und nach dem Speichern. Dazu der Dienst allein mit Dateien im Speicher, für grosse Zahlen
// und Abläufe, die sich auf der Platte nicht verlässlich herbeiführen lassen (Review).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult, FileChange, FilesChangedEvent, JavaKindEntry } from '../../src/shared/types';
import { decodeHead, JAVA_HEAD_BYTES, JavaKinds, type JavaFileSystem } from '../../src/main/core/javaKinds';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Art von Java-Dateien im Kern', () => {
  const tempDir = useTempDirs();

  async function openShop(files: Record<string, string>) {
    const root = tempDir();
    const project = path.join(root, 'Shop');
    fs.mkdirSync(project);
    // Die Änderungszeit liegt auf einer ganzen Sekunde, damit `replaceKeepingStamp` sie genau wiederherstellen kann
    // (`utimes` mit einem Datum kennt keine Bruchteile von Millisekunden).
    const stamp = new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000);
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(project, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      fs.utimesSync(target, stamp, stamp);
    }
    const test = createTestCore(path.join(root, 'data'));
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shop – Codium');
    const at = (...parts: string[]) => path.join(project, ...parts);
    return { project, test, windowId, at };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** Die gemeldeten Änderungen der Arten, in der Reihenfolge der Meldungen. */
  function kindChanges(test: TestCore, windowId: number): JavaKindEntry[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'files.javaKindsChanged')
      .flatMap((e) => (e.payload as { kinds: JavaKindEntry[] }).kinds);
  }

  function fileChanges(test: TestCore, windowId: number): FileChange[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'files.changed')
      .flatMap((e) => (e.payload as { changes: FileChange[] }).changes);
  }

  /** Wartet, bis die Überwachung läuft: Eine Probedatei wird so lange neu angelegt, bis ihr Ereignis ankommt. */
  async function untilWatching(test: TestCore, windowId: number, project: string): Promise<void> {
    const probe = path.join(project, 'watch-probe.tmp');
    for (let attempt = 0; attempt < 50; attempt++) {
      fs.writeFileSync(probe, String(attempt));
      await sleep(150);
      if (fileChanges(test, windowId).some((c) => c.path === probe)) break;
    }
    fs.rmSync(probe);
    await expect.poll(() => fileChanges(test, windowId).some((c) => c.path === probe && c.kind === 'deleted')).toBe(true);
  }

  /** Schreibt einen Inhalt gleicher Länge und setzt die Änderungszeit zurück: Für den Zwischenspeicher bleibt alles gleich. */
  function replaceKeepingStamp(file: string, content: string): void {
    const before = fs.statSync(file);
    expect(Buffer.byteLength(content)).toBe(before.size);
    fs.writeFileSync(file, content);
    fs.utimesSync(file, before.atime, before.mtime);
    expect(fs.statSync(file).mtimeMs).toBe(before.mtimeMs);
  }

  it('liefert die Art je Pfad in der Reihenfolge der Anfrage, gebündelt für einen Ordner', async () => {
    const { test, windowId, at } = await openShop({
      'src/OrderService.java': 'package shop;\n\npublic class OrderService {}\n',
      'src/Repository.java': 'public interface Repository<T> {}\n',
      'src/Status.java': 'public enum Status { NEW }\n',
      'src/Money.java': 'public record Money(long cents) {}\n',
      'src/Audited.java': 'public @interface Audited {}\n',
      'src/OrderFailed.java': 'public class OrderFailed extends RuntimeException {}\n',
      'src/Base.java': 'public abstract class Base {}\n',
      'src/Helpers.java': 'class A {}\nclass B {}\n',
      'src/package-info.java': '/** Shop. */\npackage shop;\n',
      'src/Empty.java': '',
    });
    const names = ['OrderService', 'Repository', 'Status', 'Money', 'Audited', 'OrderFailed', 'Base', 'Helpers', 'package-info', 'Empty', 'Missing'];
    const paths = names.map((n) => at('src', `${n}.java`));
    expect(await call(test, windowId, 'files.javaKinds', { paths })).toEqual(
      ['class', 'interface', 'enum', 'record', 'annotation', 'exception', 'abstractClass', 'java', 'java', 'java', 'java'].map(
        (kind, i) => ({ path: paths[i], kind }),
      ),
    );
  });

  it('prüft die Pfade: nur Java-Dateien im Projekt; ein fehlender Ordner ergibt „Java-Datei“', async () => {
    const { test, windowId, project, at } = await openShop({ 'A.java': 'class A {}', 'notes.txt': '' });
    await expect(call(test, windowId, 'files.javaKinds', { paths: [at('notes.txt')] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(call(test, windowId, 'files.javaKinds', { paths: [] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(call(test, windowId, 'files.javaKinds', { paths: ['A.java'] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(call(test, windowId, 'files.javaKinds', { paths: [path.join(project, '..', 'Other.java')] })).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_PROJECT',
    });
    expect(await call(test, windowId, 'files.javaKinds', { paths: [at('gone', 'X.java'), at('A.java')] })).toEqual([
      { path: at('gone', 'X.java'), kind: 'java' },
      { path: at('A.java'), kind: 'class' },
    ]);
  });

  it('liest nur den Anfang: Eine grosse Datei bekommt die Art ihres ersten Typs, auch mit Umlaut an der Grenze', async () => {
    // Zeilen mit „ä“ (zwei Bytes), so dass die Grenze von 64 KB mitten in einem Zeichen liegt.
    const line = `// ${'ä'.repeat(40)}\n`;
    let body = '';
    while (Buffer.byteLength(body) < JAVA_HEAD_BYTES * 2) body += line;
    let text = `public class Grösse {\n${body}}\nclass Hidden {}\n`;
    // Ein Leerzeichen mehr verschiebt die Grenze um ein Byte: so lange, bis dort ein Folgebyte eines Zeichens liegt.
    while ((Buffer.from(text, 'utf8')[JAVA_HEAD_BYTES] & 0xc0) !== 0x80) text = ` ${text}`;
    const { test, windowId, at } = await openShop({ 'Grösse.java': text });
    expect(await call(test, windowId, 'files.javaKinds', { paths: [at('Grösse.java')] })).toEqual([{ path: at('Grösse.java'), kind: 'class' }]);
  });

  it('merkt sich die Art je Pfad mit Änderungszeit und Grösse und liest erst nach einer Änderung neu', async () => {
    const { test, windowId, at } = await openShop({ 'A.java': 'class     A {}\n' });
    const file = at('A.java');
    expect(await call(test, windowId, 'files.javaKinds', { paths: [file] })).toEqual([{ path: file, kind: 'class' }]);

    // Gleiche Grösse, gleiche Änderungszeit: Die Antwort kommt aus dem Zwischenspeicher, die Datei wird nicht gelesen.
    replaceKeepingStamp(file, 'interface A {}\n');
    expect(await call(test, windowId, 'files.javaKinds', { paths: [file] })).toEqual([{ path: file, kind: 'class' }]);

    // Eine andere Änderungszeit: neu gelesen.
    const later = new Date(fs.statSync(file).mtimeMs + 5000);
    fs.utimesSync(file, later, later);
    expect(await call(test, windowId, 'files.javaKinds', { paths: [file] })).toEqual([{ path: file, kind: 'interface' }]);

    // Eine andere Grösse bei gleicher Änderungszeit: ebenso.
    const stamp = fs.statSync(file);
    fs.writeFileSync(file, 'enum A { X }\n');
    fs.utimesSync(file, stamp.atime, stamp.mtime);
    expect(await call(test, windowId, 'files.javaKinds', { paths: [file] })).toEqual([{ path: file, kind: 'enum' }]);
  });

  it('bestimmt eine gemerkte Datei nach einer Änderung von aussen neu und meldet die neue Art', async () => {
    const { test, windowId, project, at } = await openShop({ 'A.java': 'public class A {}\n', 'B.java': 'public class B {}\n' });
    await untilWatching(test, windowId, project);
    await call(test, windowId, 'files.javaKinds', { paths: [at('A.java')] });

    fs.writeFileSync(at('A.java'), 'public interface A {}\n');
    await expect.poll(() => kindChanges(test, windowId)).toEqual([{ path: at('A.java'), kind: 'interface' }]);

    // Eine Änderung, die die Art nicht ändert, meldet nichts; eine nicht gemerkte Datei wird nicht gelesen.
    fs.writeFileSync(at('A.java'), '/** Doku. */\npublic interface A {}\n');
    fs.writeFileSync(at('B.java'), 'public enum B { X }\n');
    fs.writeFileSync(at('marker.txt'), '');
    await expect.poll(() => fileChanges(test, windowId).some((c) => c.path === at('marker.txt'))).toBe(true);
    await sleep(200);
    expect(kindChanges(test, windowId)).toEqual([{ path: at('A.java'), kind: 'interface' }]);
    expect(await call(test, windowId, 'files.javaKinds', { paths: [at('B.java')] })).toEqual([{ path: at('B.java'), kind: 'enum' }]);
  });

  it('bestimmt eine gemerkte Datei nach dem Speichern in Codium neu: von class zu interface', async () => {
    const { test, windowId, at } = await openShop({ 'OrderService.java': 'public class OrderService {\n}\n' });
    const file = at('OrderService.java');
    await call(test, windowId, 'files.javaKinds', { paths: [file] });
    await call(test, windowId, 'files.write', { path: file, text: 'public interface OrderService {\n}\n', encoding: 'utf-8', lineEnding: 'LF' });
    await expect.poll(() => kindChanges(test, windowId)).toEqual([{ path: file, kind: 'interface' }]);
  });

  it('vergisst Gelöschtes und folgt Umbenennungen in Codium', async () => {
    const { test, windowId, at } = await openShop({ 'A.java': 'class A {}\n', 'pkg/C.java': 'class C {}\n' });
    await call(test, windowId, 'files.javaKinds', { paths: [at('A.java'), at('pkg', 'C.java')] });

    // Eine umbenannte Datei wird neu bestimmt: Ihr Name passt nicht mehr.
    const renamed = await call(test, windowId, 'files.rename', { path: at('A.java'), newName: 'B.java' });
    expect(await call(test, windowId, 'files.javaKinds', { paths: [renamed] })).toEqual([{ path: renamed, kind: 'java' }]);

    // Unter einem umbenannten Ordner wandert das Gemerkte mit (Beleg: ein Inhalt mit gleichem Stand bleibt unbemerkt).
    replaceKeepingStamp(at('pkg', 'C.java'), 'enum C {X}\n');
    const folder = await call(test, windowId, 'files.rename', { path: at('pkg'), newName: 'moved' });
    expect(await call(test, windowId, 'files.javaKinds', { paths: [path.join(folder, 'C.java')] })).toEqual([
      { path: path.join(folder, 'C.java'), kind: 'class' },
    ]);

    // Gelöscht und mit gleichem Stand neu angelegt: nicht aus dem Zwischenspeicher.
    const file = path.join(folder, 'C.java');
    const stamp = fs.statSync(file);
    await call(test, windowId, 'files.delete', { paths: [file] });
    fs.writeFileSync(file, 'enum C {X}\n');
    fs.utimesSync(file, stamp.atime, stamp.mtime);
    expect(await call(test, windowId, 'files.javaKinds', { paths: [file] })).toEqual([{ path: file, kind: 'enum' }]);
  });

  it('decodeHead schneidet einen abgeschnittenen Anfang beim letzten Zeilenumbruch', () => {
    const bytes = Buffer.from('class Grösse {\n// ä', 'utf8');
    const cut = bytes.subarray(0, bytes.length - 1);
    expect(decodeHead(cut, true)).toBe('class Grösse {\n');
    expect(decodeHead(Buffer.from('a\u0000b'), false)).toBeNull();
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('class A {}', 'utf16le')]);
    expect(decodeHead(utf16.subarray(0, utf16.length - 1), true)).toBe('class A {');
  });

  it('nur die Schreibweise umbenannt (etwa git mv): Die Art wird mit dem neuen Namen neu bestimmt', async () => {
    const { test, windowId, at } = await openShop({ 'orderService.java': 'public class OrderService {}\n' });
    expect(await call(test, windowId, 'files.javaKinds', { paths: [at('orderService.java')] })).toEqual([
      { path: at('orderService.java'), kind: 'java' },
    ]);
    fs.renameSync(at('orderService.java'), at('OrderService.java'));
    expect(await call(test, windowId, 'files.javaKinds', { paths: [at('OrderService.java')] })).toEqual([
      { path: at('OrderService.java'), kind: 'class' },
    ]);
  });

  it('ein Ordner über eine Junction nach draussen ergibt nur für seine Dateien „Java-Datei“', async () => {
    const { test, windowId, at } = await openShop({ 'A.java': 'class A {}\n' });
    const outside = path.join(path.dirname(path.dirname(at('A.java'))), 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'B.java'), 'class B {}\n');
    fs.symlinkSync(outside, at('ext'), 'junction');
    expect(await call(test, windowId, 'files.javaKinds', { paths: [at('ext', 'B.java'), at('A.java')] })).toEqual([
      { path: at('ext', 'B.java'), kind: 'java' },
      { path: at('A.java'), kind: 'class' },
    ]);
  });
});

/** Dateien im Speicher für den Dienst allein (ohne Platte), mit Zählern und einer Sperre vor dem Lesen. */
function memoryFiles() {
  const files = new Map<string, { text: string; mtimeMs: number; locked?: boolean }>();
  const counts = { lstat: 0, read: 0 };
  let gate: Promise<void> | null = null;
  const missing = () => Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  const fileSystem: JavaFileSystem = {
    async lstat(target) {
      counts.lstat++;
      const file = files.get(target.toLowerCase());
      if (!file) throw missing();
      return { isFile: () => true, isSymbolicLink: () => false, mtimeMs: file.mtimeMs, size: Buffer.byteLength(file.text) };
    },
    stat: (target) => fileSystem.lstat(target),
    async readHead(target, length) {
      counts.read++;
      const file = files.get(target.toLowerCase());
      if (!file) throw missing();
      // Der Inhalt zum Zeitpunkt des Lesens; die Sperre hält erst danach an (wie ein Lesen, das noch unterwegs ist).
      const text = file.text;
      if (gate) await gate;
      if (file.locked) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return Buffer.from(text).subarray(0, length);
    },
  };
  const write = (target: string, text: string, mtimeMs: number) => files.set(target.toLowerCase(), { text, mtimeMs });
  return {
    files,
    counts,
    write,
    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
    service() {
      const changes: JavaKindEntry[] = [];
      const kinds = new JavaKinds({
        io: (work) => work(),
        isRealInside: async () => true,
        onChanged: (entries) => changes.push(...entries),
        log: () => {},
        fileSystem,
      });
      return { kinds, changes };
    },
  };
}

describe('Art von Java-Dateien im Kern, mit Dateien im Speicher', () => {
  const root = 'C:\\shop\\src';

  it('eine Meldung mit 2’000 Pfaden bei 20’000 gemerkten Dateien: Aufwand nach Pfaden, nicht Pfade × gemerkte Dateien', async () => {
    const mem = memoryFiles();
    const all: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const target = `${root}\\pkg${i % 200}\\sub\\F${i}.java`;
      mem.write(target, `class F${i} {}`, 1);
      all.push(target);
    }
    const { kinds, changes } = mem.service();
    await kinds.kindsOf(all);
    expect(mem.counts.read).toBe(20_000);

    // 1'000 gemerkte Dateien (100 davon werden zum Interface), 990 nicht gemerkte, 10 neu angelegte Ordner mit Inhalt.
    for (let i = 0; i < 100; i++) mem.write(all[i], `interface F${i} {}`, 2);
    const changedFiles = all.slice(0, 1000);
    const event: FilesChangedEvent = {
      changes: [
        ...changedFiles.map((p): FileChange => ({ path: p, kind: 'changed' })),
        ...Array.from({ length: 990 }, (_, i): FileChange => ({ path: `${root}\\build\\X${i}.class`, kind: 'created' })),
        ...Array.from({ length: 10 }, (_, i): FileChange => ({ path: `${root}\\pkg${199 - i}`, kind: 'changed' })),
      ],
    };
    const lstatsBefore = mem.counts.lstat;
    const start = performance.now();
    kinds.filesChanged(event);
    const elapsed = performance.now() - start;
    // Vorher lief je Pfad ein Durchlauf über alle gemerkten Dateien (vom Prüfer nachgebaut: etwa 21 s Blockade).
    expect(elapsed).toBeLessThan(1000);
    await expect.poll(() => changes.length).toBe(100);
    expect(new Set(changes.map((c) => c.kind))).toEqual(new Set(['interface']));
    // Neu bestimmt wurden genau die gemerkten Dateien unter den Pfaden: 1'000 direkt und je 100 in den 10 Ordnern,
    // ohne die doppelten (Dateien mit Nummer < 1'000 in diesen Ordnern).
    const inFolders = all.filter((p) => Array.from({ length: 10 }, (_, i) => `${root}\\pkg${199 - i}\\`).some((f) => p.startsWith(f)));
    const expected = new Set([...changedFiles, ...inFolders]).size;
    await expect.poll(() => mem.counts.lstat - lstatsBefore).toBe(expected);
  });

  it('vergisst gelöschte Dateien und Ordner in einem Durchlauf', async () => {
    const mem = memoryFiles();
    const all = Array.from({ length: 2000 }, (_, i) => `${root}\\pkg${i % 20}\\F${i}.java`);
    for (const target of all) mem.write(target, 'class X {}', 1);
    const { kinds } = mem.service();
    await kinds.kindsOf(all);
    kinds.filesChanged({ changes: [{ path: all[0], kind: 'deleted' }, { path: `${root}\\pkg5`, kind: 'deleted' }, { path: `${root}\\none.java`, kind: 'deleted' }] });
    // Vergessen heisst: Eine weitere Anfrage liest neu.
    const readsBefore = mem.counts.read;
    await kinds.kindsOf([all[0], all[5], all[1]]);
    expect(mem.counts.read - readsBefore).toBe(2);
  });

  it('nach einem Neueinlesen der Überwachung werden alle gemerkten Dateien geprüft und geänderte gemeldet', async () => {
    const mem = memoryFiles();
    const [a, b, c] = ['A', 'B', 'C'].map((n) => `${root}\\${n}.java`);
    mem.write(a, 'class A {}', 1);
    mem.write(b, 'class B {}', 1);
    mem.write(c, 'class C {}', 1);
    const { kinds, changes } = mem.service();
    await kinds.kindsOf([a, b, c]);
    // Verpasste Ereignisse: B wurde zum Enum, C ist gelöscht und gemeldet, A unverändert.
    mem.write(b, 'enum B { X }', 2);
    mem.files.delete(c.toLowerCase());
    kinds.filesChanged({ changes: [{ path: c, kind: 'deleted' }], rescanned: true });
    await expect.poll(() => changes).toEqual([{ path: b, kind: 'enum' }]);
    expect(mem.counts.lstat).toBe(3 + 2);
  });

  it('speichert Codium eine Datei, während sie noch mit dem alten Inhalt bestimmt wird, folgt die neue Art', async () => {
    const mem = memoryFiles();
    const a = `${root}\\OrderService.java`;
    mem.write(a, 'class OrderService {}', 1);
    const { kinds, changes } = mem.service();
    const release = mem.hold();
    const first = kinds.kindsOf([a]);
    await expect.poll(() => mem.counts.read).toBe(1);
    // Gespeichert, während das Lesen des alten Inhalts noch unterwegs ist.
    mem.write(a, 'interface OrderService {}', 2);
    kinds.saved(a);
    release();
    expect(await first).toEqual([{ path: a, kind: 'class' }]);
    await expect.poll(() => changes).toEqual([{ path: a, kind: 'interface' }]);
  });

  it('eine gesperrte Datei ist „Java-Datei“ und wird mit ihrem Stand gemerkt, damit eine Änderung neu bestimmt', async () => {
    const mem = memoryFiles();
    const a = `${root}\\Locked.java`;
    mem.write(a, 'class Locked {}', 1);
    mem.files.get(a.toLowerCase())!.locked = true;
    const { kinds, changes } = mem.service();
    expect(await kinds.kindsOf([a])).toEqual([{ path: a, kind: 'java' }]);
    // Ohne Änderung bleibt es dabei, ohne erneutes Lesen.
    expect(await kinds.kindsOf([a])).toEqual([{ path: a, kind: 'java' }]);
    expect(mem.counts.read).toBe(1);
    // Freigegeben und geändert: Die Überwachung meldet die Änderung, der Kern meldet die neue Art.
    mem.write(a, 'class Locked { }', 2);
    kinds.filesChanged({ changes: [{ path: a, kind: 'changed' }] });
    await expect.poll(() => changes).toEqual([{ path: a, kind: 'class' }]);
  });
});
