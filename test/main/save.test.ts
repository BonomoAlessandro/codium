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
