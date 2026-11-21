// Teststelle 1: Schreiben im Datei-Dienst am Vertrag, mit echtem Dateisystem in Temp-Ordnern: Erhalt von Kodierung,
// BOM und Zeilenende, Zeilenende neuer Dateien und Ereignisse für eigene und fremde Schreibvorgänge.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type FileChange,
  type FilesChangedEvent,
} from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Speichern im Kern', () => {
  const tempDir = useTempDirs();

  async function openAlpha(files: Record<string, string | Buffer> = {}) {
    const root = tempDir();
    const project = path.join(root, 'Alpha');
    fs.mkdirSync(project);
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
      fs.writeFileSync(path.join(project, relative), content);
    }
    const test = createTestCore(path.join(root, 'data'));
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(title('Alpha'));
    const at = (...parts: string[]) => path.join(project, ...parts);
    return { project, test, windowId, at };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  function changes(test: TestCore, windowId: number): FileChange[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'files.changed')
      .flatMap((e) => (e.payload as FilesChangedEvent).changes);
  }

  /** Liest eine Datei wie ein Tab und schreibt ihren Text unverändert zurück. */
  async function roundTrip(test: TestCore, windowId: number, file: string): Promise<void> {
    const content = await call(test, windowId, 'files.read', { path: file });
    if (content.kind !== 'text') throw new Error(`kein Text: ${content.kind}`);
    await call(test, windowId, 'files.write', { path: file, text: content.text, encoding: content.encoding, lineEnding: content.lineEnding });
  }

  it('erhält beim Zurückschreiben die Bytes für alle Kodierungen und Zeilenenden', async () => {
    const utf16 = (text: string, bigEndian: boolean) => {
      const body = Buffer.from(text, 'utf16le');
      if (bigEndian) body.swap16();
      return Buffer.concat([Buffer.from(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]), body]);
    };
    const files: Record<string, Buffer> = {
      'utf8-lf.txt': Buffer.from('Grüsse\nzweite Zeile\n', 'utf8'),
      'utf8-crlf.txt': Buffer.from('Grüsse\r\nzweite Zeile\r\n', 'utf8'),
      'utf8-bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('mit BOM\r\nÄÖÜ\r\n', 'utf8')]),
      'utf16le.txt': utf16('UTF-16 LE\r\nGrüsse €\r\n', false),
      'utf16be.txt': utf16('UTF-16 BE\nGrüsse €\n', true),
      // Windows-1252 mit Umlauten und dem Euro-Zeichen (0x80), das in Latin-1 fehlt.
      'ansi.txt': Buffer.from([0x47, 0x72, 0xfc, 0x73, 0x73, 0x65, 0x20, 0x80, 0x0d, 0x0a, 0xc4, 0xd6, 0xdc, 0x0d, 0x0a]),
      'no-newline-at-end.txt': Buffer.from('ende ohne Umbruch\nletzte', 'utf8'),
    };
    const { test, windowId, at } = await openAlpha(files);
    for (const [name, bytes] of Object.entries(files)) {
      await roundTrip(test, windowId, at(name));
      expect(fs.readFileSync(at(name)).equals(bytes), name).toBe(true);
    }
  });

  it('schreibt geänderten Text in der Kodierung und mit dem Zeilenende der Datei', async () => {
    const { test, windowId, at } = await openAlpha({ 'a.txt': Buffer.from([0x41, 0xe4, 0x0d, 0x0a]) });
    const content = await call(test, windowId, 'files.read', { path: at('a.txt') });
    expect(content).toMatchObject({ kind: 'text', encoding: 'windows-1252', lineEnding: 'CRLF', text: 'Aä\r\n' });
    // Der Editor liefert Zeilen mit seinem Zeilenende; geschrieben wird mit dem der Datei.
    await call(test, windowId, 'files.write', { path: at('a.txt'), text: 'Aä\nÖ€\n', encoding: 'windows-1252', lineEnding: 'CRLF' });
    expect([...fs.readFileSync(at('a.txt'))]).toEqual([0x41, 0xe4, 0x0d, 0x0a, 0xd6, 0x80, 0x0d, 0x0a]);
    // Ein Zeichen, das Windows-1252 nicht kennt, wird nicht still verfälscht.
    await expect(
      call(test, windowId, 'files.write', { path: at('a.txt'), text: 'Pfeil →', encoding: 'windows-1252', lineEnding: 'CRLF' }),
    ).rejects.toMatchObject({ code: ErrorCode.cannotEncode, data: { character: '→' } });
    expect([...fs.readFileSync(at('a.txt'))]).toEqual([0x41, 0xe4, 0x0d, 0x0a, 0xd6, 0x80, 0x0d, 0x0a]);
  });

  it('gibt neuen Dateien das im Projekt überwiegende Zeilenende, im leeren Projekt LF', async () => {
    const crlfProject = await openAlpha({ 'a.java': 'a\r\nb\r\nc\r\n', 'b.java': 'x\r\ny\r\n', 'c.txt': 'nur\neine\n' });
    const created = await call(crlfProject.test, crlfProject.windowId, 'files.createFile', { parent: crlfProject.project, name: 'New.java' });
    const content = await call(crlfProject.test, crlfProject.windowId, 'files.read', { path: created });
    expect(content).toMatchObject({ kind: 'text', text: '', encoding: 'utf-8', lineEnding: 'CRLF' });
    await call(crlfProject.test, crlfProject.windowId, 'files.write', { path: created, text: 'class New {\n}\n', encoding: 'utf-8', lineEnding: 'CRLF' });
    expect(fs.readFileSync(created, 'utf8')).toBe('class New {\r\n}\r\n');

    const empty = await openAlpha();
    const fresh = await call(empty.test, empty.windowId, 'files.createFile', { parent: empty.project, name: 'New.txt' });
    expect(await call(empty.test, empty.windowId, 'files.read', { path: fresh })).toMatchObject({ kind: 'text', encoding: 'utf-8', lineEnding: 'LF' });
  });

  it('meldet einen eigenen Schreibvorgang nicht als Änderung von aussen, einen fremden schon', async () => {
    const { test, windowId, at, project } = await openAlpha({ 'a.txt': 'eins\n' });
    // Warten, bis die Überwachung läuft.
    const probe = path.join(project, 'probe.tmp');
    for (let i = 0; i < 50 && !changes(test, windowId).some((c) => c.path === probe); i++) {
      fs.writeFileSync(probe, String(i));
      await sleep(150);
    }
    await call(test, windowId, 'files.write', { path: at('a.txt'), text: 'zwei\n', encoding: 'utf-8', lineEnding: 'LF' });
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('zwei\n');
    // Eine Markierung von aussen danach: Kommt sie an, sind alle Ereignisse davor gemeldet.
    const marker = path.join(project, 'marker.tmp');
    fs.writeFileSync(marker, '');
    await expect.poll(() => changes(test, windowId).some((c) => c.path === marker)).toBe(true);
    expect(changes(test, windowId).filter((c) => c.path === at('a.txt'))).toEqual([]);

    // Fremd geändert, auch gleich nach dem eigenen Schreiben: kommt an.
    await call(test, windowId, 'files.write', { path: at('a.txt'), text: 'drei\n', encoding: 'utf-8', lineEnding: 'LF' });
    fs.writeFileSync(at('a.txt'), 'von aussen, länger\n');
    await expect.poll(() => changes(test, windowId).some((c) => c.path === at('a.txt') && c.kind === 'changed')).toBe(true);
  });

  it('schreibt mit erwartetem Stand nur, wenn die Datei ihn noch hat (Review von Ticket 07)', async () => {
    const { test, windowId, at } = await openAlpha({ 'a.txt': 'original\n' });
    const read = await call(test, windowId, 'files.read', { path: at('a.txt') });
    if (read.kind !== 'text') throw new Error('kein Text');
    const first = await call(test, windowId, 'files.write', {
      path: at('a.txt'),
      text: 'mine\n',
      encoding: 'utf-8',
      lineEnding: 'LF',
      expectedStamp: read.stamp,
    });
    // Der gelieferte Stand ist der, den ein neues Lesen zeigt.
    expect(await call(test, windowId, 'files.read', { path: at('a.txt') })).toMatchObject({ stamp: first.stamp });

    // Von aussen geändert: Mit dem alten Stand wird nichts geschrieben.
    fs.writeFileSync(at('a.txt'), 'foreign\n');
    await expect(
      call(test, windowId, 'files.write', { path: at('a.txt'), text: 'mine again\n', encoding: 'utf-8', lineEnding: 'LF', expectedStamp: first.stamp }),
    ).rejects.toMatchObject({ code: ErrorCode.fileChanged });
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('foreign\n');
    // Ohne erwarteten Stand („Keep Mine“) wird geschrieben.
    await call(test, windowId, 'files.write', { path: at('a.txt'), text: 'mine again\n', encoding: 'utf-8', lineEnding: 'LF' });
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('mine again\n');
  });

  it('behält das Zeilenende unveränderter Zeilen, auch gemischt und mit einzelnem CR (Review von Ticket 07)', async () => {
    const { test, windowId, at } = await openAlpha({ 'mixed.txt': 'a\r\nb\nc\n', 'cr.txt': 'a\rb\n', 'crlf.txt': 'x\r\ny\r\n' });
    const write = (name: string, text: string, lineEnding: 'LF' | 'CRLF') =>
      call(test, windowId, 'files.write', { path: at(name), text, encoding: 'utf-8', lineEnding });

    // Unverändert zurückgeschrieben (der Editor liefert ein einheitliches Zeilenende): Die Bytes bleiben.
    await write('mixed.txt', 'a\nb\nc\n', 'LF');
    expect(fs.readFileSync(at('mixed.txt'), 'utf8')).toBe('a\r\nb\nc\n');
    await write('cr.txt', 'a\nb\n', 'LF');
    expect(fs.readFileSync(at('cr.txt'), 'utf8')).toBe('a\rb\n');
    // Eine Zeile geändert, eine eingefügt: Nur diese bekommen das überwiegende Zeilenende.
    await write('mixed.txt', 'Xa\nb\nnew\nc\n', 'LF');
    expect(fs.readFileSync(at('mixed.txt'), 'utf8')).toBe('Xa\r\nb\nnew\nc\n');
    await write('crlf.txt', 'x\ninserted\ny\n', 'CRLF');
    expect(fs.readFileSync(at('crlf.txt'), 'utf8')).toBe('x\r\ninserted\r\ny\r\n');
  });

  it('lässt vor dem Beenden und vor dem Schliessen eines Fensters die Tabs speichern (Review von Ticket 07)', async () => {
    const root = tempDir();
    const project = path.join(root, 'Alpha');
    fs.mkdirSync(project);
    const test = createTestCore(path.join(root, 'data'), { flushTimeoutMs: 5000 });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(title('Alpha'));
    const requests = () =>
      test.events
        .forWindow(windowId)
        .filter((e) => e.name === 'editor.flushRequest')
        .map((e) => (e.payload as { requestId: number }).requestId);

    // „Exit“: Erst nach der Antwort des Fensters endet Codium.
    const exiting = call(test, windowId, 'app.exit');
    await expect.poll(() => requests().length).toBe(1);
    await sleep(50);
    expect(test.ports.windows.quitRequests).toBe(0);
    await call(test, windowId, 'editor.flushed', { requestId: requests()[0] });
    await exiting;
    expect(test.ports.windows.quitRequests).toBe(1);
  });

  it('schliesst ein Fenster erst nach dem Speichern, auch ohne Antwort höchstens nach dem Zeitlimit', async () => {
    const root = tempDir();
    const alpha = path.join(root, 'Alpha');
    const beta = path.join(root, 'Beta');
    fs.mkdirSync(alpha);
    fs.mkdirSync(beta);
    const test = createTestCore(path.join(root, 'data'), { flushTimeoutMs: 300 });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: alpha });
    const alphaWindow = test.ports.windows.windowTitled(title('Alpha'));
    await call(test, alphaWindow, 'app.openProject', { path: beta });
    const betaWindow = test.ports.windows.windowTitled(title('Beta'));

    const started = Date.now();
    const closing = test.ports.windows.requestClose(betaWindow);
    await expect.poll(() => test.events.forWindow(betaWindow).some((e) => e.name === 'editor.flushRequest')).toBe(true);
    expect(test.ports.windows.isOpen(betaWindow)).toBe(true);
    // Keine Antwort (etwa eine hängende Seite): Nach dem Zeitlimit schliesst es trotzdem.
    await closing;
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(test.ports.windows.isOpen(betaWindow)).toBe(false);
    expect(test.ports.windows.isOpen(alphaWindow)).toBe(true);
  });

  it('lehnt Ordner, fehlende Dateien, Pfade ausserhalb und .git ab', async () => {
    const { test, windowId, at } = await openAlpha({ 'src/a.txt': 'a', '.git/HEAD': 'ref: refs/heads/main\n' });
    const write = (file: string) => call(test, windowId, 'files.write', { path: file, text: 'x', encoding: 'utf-8', lineEnding: 'LF' });
    await expect(write(at('src'))).rejects.toMatchObject({ code: ErrorCode.notAFile });
    await expect(write(at('missing.txt'))).rejects.toMatchObject({ code: ErrorCode.fileNotFound });
    await expect(write(at('..', 'outside.txt'))).rejects.toMatchObject({ code: ErrorCode.pathOutsideProject });
    await expect(write(at('.git', 'HEAD'))).rejects.toMatchObject({ code: ErrorCode.invalidParams });
    expect(fs.readFileSync(at('.git', 'HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    await expect(
      call(test, windowId, 'files.write', { path: at('src', 'a.txt'), text: 'x', encoding: 'latin-1' as never, lineEnding: 'LF' }),
    ).rejects.toMatchObject({ code: ErrorCode.invalidParams });
  });
});
