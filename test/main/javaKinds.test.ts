// Teststelle 1: Art von Java-Dateien für ihr Symbol im Dateibaum (Ticket 32) am Vertrag, mit echtem Dateisystem:
// Anfrage je Ordner, Lesen des Dateianfangs, Zwischenspeicher je Pfad mit Änderungszeit und Grösse und neues Bestimmen
// nach Änderungen von aussen und nach dem Speichern.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult, FileChange, JavaKindEntry } from '../../src/shared/types';
import { decodeHead, JAVA_HEAD_BYTES } from '../../src/main/core/javaKinds';
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
});
