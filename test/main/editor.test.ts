// Teststelle 1: Lesen von Dateien für Tabs, Einstellungen und der Tab-Zustand eines Projekts, am Vertrag mit echtem
// Dateisystem in Temp-Ordnern und nachgemachten Ports. Ein Neustart ist ein neuer Kern auf demselben Datenordner.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_SIZE,
  ErrorCode,
  LARGE_FILE_BYTES,
  MAX_OPEN_FILE_BYTES,
  type AppSettings,
  type CommandArgs,
  type CommandName,
  type CommandResult,
} from '../../src/shared/types';
import { createTestCore, quitApp, restart, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;

/** Kleinstes gültiges PNG (1 × 1 Pixel). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Editor im Kern', () => {
  const tempDir = useTempDirs();

  /** Projekte mit vorgegebenen Dateien (Pfad → Inhalt), in einem gemeinsamen Temp-Ordner. */
  function makeProject(root: string, name: string, files: Record<string, string | Buffer> = {}): string {
    const project = path.join(root, name);
    fs.mkdirSync(project, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(project, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return project;
  }

  async function openAlpha(files: Record<string, string | Buffer> = {}) {
    const root = tempDir();
    const project = makeProject(root, 'Alpha', files);
    const test = createTestCore(path.join(root, 'data'));
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(title('Alpha'));
    const at = (...parts: string[]) => path.join(project, ...parts);
    return { root, project, test, windowId, at };
  }

  /** Startet neu; das Projekt öffnet wieder, weil es beim Beenden offen war. */
  async function restarted(previous: TestCore, name = 'Alpha') {
    const test = await restart(previous);
    await test.core.start();
    return { test, windowId: test.ports.windows.windowTitled(title(name)) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  function settingsEvents(test: TestCore, windowId: number): AppSettings[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'app.settingsChanged')
      .map((e) => e.payload as AppSettings);
  }

  describe('Lesen', () => {
    it('liefert Text mit Kodierung und überwiegendem Zeilenende', async () => {
      const { test, windowId, at } = await openAlpha({
        'lf.txt': 'eins\nzwei\r\ndrei\n',
        'crlf.txt': 'eins\r\nzwei\r\ndrei\n',
        'none.txt': 'ohne Umbruch',
        'umlaut.txt': 'Grüsse',
        'bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('mit BOM', 'utf8')]),
        'ansi.txt': Buffer.from([0x47, 0x72, 0xfc, 0x73, 0x73, 0x65, 0x20, 0x80]),
        'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
      const read = (name: string) => call(test, windowId, 'files.read', { path: at(name) });

      expect(await read('lf.txt')).toEqual({
        kind: 'text',
        text: 'eins\nzwei\r\ndrei\n',
        encoding: 'utf-8',
        lineEnding: 'LF',
        size: 16,
        large: false,
        stamp: expect.any(String),
      });
      expect(await read('crlf.txt')).toMatchObject({ kind: 'text', lineEnding: 'CRLF' });
      expect(await read('none.txt')).toMatchObject({ kind: 'text', lineEnding: 'LF' });
      expect(await read('umlaut.txt')).toMatchObject({ kind: 'text', text: 'Grüsse', encoding: 'utf-8' });
      // Das BOM gehört nicht zum Text.
      expect(await read('bom.txt')).toMatchObject({ kind: 'text', text: 'mit BOM', encoding: 'utf-8-bom' });
      // Kein gültiges UTF-8: Windows-1252 (0x80 ist das Euro-Zeichen).
      expect(await read('ansi.txt')).toMatchObject({ kind: 'text', text: 'Grüsse €', encoding: 'windows-1252' });
      // SVG öffnet als Text, nicht als Bild.
      expect(await read('icon.svg')).toMatchObject({ kind: 'text', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    });

    it('erkennt UTF-16 mit BOM als Text, obwohl Null-Bytes darin stehen', async () => {
      const text = 'class A {}\r\n// Grüsse\r\n';
      const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
      const be = Buffer.from(le);
      be.swap16();
      const { test, windowId, at } = await openAlpha({ 'le.java': le, 'be.java': be });
      expect(le.includes(0)).toBe(true);

      expect(await call(test, windowId, 'files.read', { path: at('le.java') })).toEqual({
        kind: 'text',
        text,
        encoding: 'utf-16le',
        lineEnding: 'CRLF',
        size: le.length,
        large: false,
        stamp: expect.any(String),
      });
      expect(await call(test, windowId, 'files.read', { path: at('be.java') })).toMatchObject({
        kind: 'text',
        text,
        encoding: 'utf-16be',
      });
    });

    it('liefert Bilder als data-URL und Binärdateien als „binär“', async () => {
      const binary = Buffer.alloc(9000, 0x41);
      binary[8000] = 0;
      const lateZero = Buffer.alloc(9000, 0x41);
      lateZero[8500] = 0;
      const { test, windowId, at } = await openAlpha({
        'logo.PNG': PNG_1X1,
        'photo.jpeg': Buffer.from([0xff, 0xd8, 0xff]),
        'app.exe': binary,
        'late.bin': lateZero,
      });

      expect(await call(test, windowId, 'files.read', { path: at('logo.PNG') })).toEqual({
        kind: 'image',
        dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
        size: PNG_1X1.length,
      });
      expect(await call(test, windowId, 'files.read', { path: at('photo.jpeg') })).toMatchObject({
        kind: 'image',
        dataUrl: 'data:image/jpeg;base64,/9j/',
      });
      expect(await call(test, windowId, 'files.read', { path: at('app.exe') })).toEqual({ kind: 'binary', size: 9000 });
      // Gesucht wird nur in den ersten 8 KB; dahinter ist ein Null-Byte gültiges UTF-8.
      expect(await call(test, windowId, 'files.read', { path: at('late.bin') })).toMatchObject({ kind: 'text', encoding: 'utf-8' });
    });

    it('markiert grosse Dateien und liest zu grosse gar nicht', async () => {
      const { test, windowId, at } = await openAlpha({ 'big.log': 'x'.repeat(LARGE_FILE_BYTES), 'small.log': 'x'.repeat(100) });
      // Ein Datei mit 50 MB ohne Inhalt auf der Festplatte (Windows legt sie ohne Daten an).
      fs.writeFileSync(at('huge.log'), '');
      fs.truncateSync(at('huge.log'), MAX_OPEN_FILE_BYTES);

      expect(await call(test, windowId, 'files.read', { path: at('big.log') })).toMatchObject({ kind: 'text', large: true });
      expect(await call(test, windowId, 'files.read', { path: at('small.log') })).toMatchObject({ kind: 'text', large: false });
      expect(await call(test, windowId, 'files.read', { path: at('huge.log') })).toEqual({
        kind: 'tooLarge',
        size: MAX_OPEN_FILE_BYTES,
      });
    });

    it('lehnt Ordner, fehlende Dateien und Pfade ausserhalb des Projekts ab', async () => {
      const { root, test, windowId, at } = await openAlpha({ 'src/a.txt': 'a' });
      fs.writeFileSync(path.join(root, 'secret.txt'), 'geheim');

      await expect(call(test, windowId, 'files.read', { path: at('src') })).rejects.toMatchObject({ code: ErrorCode.notAFile });
      await expect(call(test, windowId, 'files.read', { path: at('missing.txt') })).rejects.toMatchObject({
        code: ErrorCode.fileNotFound,
      });
      await expect(call(test, windowId, 'files.read', { path: at('..', 'secret.txt') })).rejects.toMatchObject({
        code: ErrorCode.pathOutsideProject,
      });
      // Auch über eine Junction nach draussen nicht.
      fs.mkdirSync(path.join(root, 'outside'));
      fs.writeFileSync(path.join(root, 'outside', 'b.txt'), 'b');
      fs.symlinkSync(path.join(root, 'outside'), at('link'), 'junction');
      await expect(call(test, windowId, 'files.read', { path: at('link', 'b.txt') })).rejects.toMatchObject({
        code: ErrorCode.pathOutsideProject,
      });
    });
  });

  describe('Einstellungen', () => {
    it('ändert die Schriftgrösse für alle Fenster, und sie übersteht einen Neustart', async () => {
      const root = tempDir();
      const alpha = makeProject(root, 'Alpha');
      const beta = makeProject(root, 'Beta');
      const first = createTestCore(path.join(root, 'data'));
      await first.core.start();
      const welcome = first.ports.windows.windowTitled(WELCOME);
      expect(await call(first, welcome, 'app.settings')).toEqual({ fontSize: DEFAULT_FONT_SIZE });

      // Im Willkommensfenster geändert, kommt die Änderung dort an.
      expect(await call(first, welcome, 'app.updateSettings', { fontSize: 15 })).toEqual({ fontSize: 15 });
      expect(settingsEvents(first, welcome)).toEqual([{ fontSize: 15 }]);

      await call(first, welcome, 'app.openProject', { path: alpha });
      const alphaWindow = first.ports.windows.windowTitled(title('Alpha'));
      await call(first, alphaWindow, 'app.openProject', { path: beta });
      const betaWindow = first.ports.windows.windowTitled(title('Beta'));

      // In einem Projektfenster geändert, erreicht die Änderung beide Projektfenster.
      expect(await call(first, betaWindow, 'app.updateSettings', { fontSize: 16 })).toEqual({ fontSize: 16 });
      expect(settingsEvents(first, alphaWindow)).toEqual([{ fontSize: 16 }]);
      expect(settingsEvents(first, betaWindow)).toEqual([{ fontSize: 16 }]);
      expect(await call(first, alphaWindow, 'app.settings')).toEqual({ fontSize: 16 });

      const { test, windowId } = await restarted(first);
      expect(await call(test, windowId, 'app.settings')).toEqual({ fontSize: 16 });
    });

    it('lehnt ungültige Einstellungen ab und ändert dann nichts', async () => {
      const { test, windowId } = await openAlpha();
      for (const params of [{ fontSize: 5 }, { fontSize: 73 }, { fontSize: 13.5 }, { fontSize: '14' }, { other: 1 }, null]) {
        await expect(call(test, windowId, 'app.updateSettings', params as never), JSON.stringify(params)).rejects.toMatchObject({
          code: ErrorCode.invalidParams,
        });
      }
      // Eine ungültige Angabe neben einer gültigen ändert auch die gültige nicht.
      await expect(call(test, windowId, 'app.updateSettings', { fontSize: 14, other: 1 } as never)).rejects.toMatchObject({
        code: ErrorCode.invalidParams,
      });
      expect(await call(test, windowId, 'app.settings')).toEqual({ fontSize: DEFAULT_FONT_SIZE });
      expect(settingsEvents(test, windowId)).toEqual([]);
    });
  });

  describe('Tabs und Cursor', () => {
    it('stellt Tabs, aktiven Tab und Cursor nach einem Neustart wieder her', async () => {
      const { test: first, windowId: firstWindow, at } = await openAlpha({ 'src/A.java': 'a', 'src/B.java': 'b', 'README.md': 'r' });
      // Ohne gespeicherte Tabs keine.
      expect(await call(first, firstWindow, 'project.tabs')).toEqual({ tabs: [], active: null, pinned: [] });
      expect(await call(first, firstWindow, 'project.cursor', { path: at('src', 'A.java') })).toBeNull();

      const tabs = [at('README.md'), at('src', 'B.java'), at('src', 'A.java')];
      await call(first, firstWindow, 'project.setTabs', { tabs, active: at('src', 'B.java') });
      await call(first, firstWindow, 'project.setCursor', { path: at('src', 'B.java'), cursor: { line: 3, column: 5, scrollTop: 40 } });
      // Ein Cursor bleibt auch für eine Datei ohne Tab gemerkt.
      await call(first, firstWindow, 'project.setCursor', { path: at('notes.txt'), cursor: { line: 2, column: 1, scrollTop: 0 } });

      const { test, windowId } = await restarted(first);
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs, active: at('src', 'B.java'), pinned: [] });
      expect(await call(test, windowId, 'project.cursor', { path: at('src', 'B.java') })).toEqual({ line: 3, column: 5, scrollTop: 40 });
      // Die Schreibweise des Pfads spielt keine Rolle.
      expect(await call(test, windowId, 'project.cursor', { path: at('SRC', 'b.java') })).toEqual({ line: 3, column: 5, scrollTop: 40 });
      expect(await call(test, windowId, 'project.cursor', { path: at('notes.txt') })).toEqual({ line: 2, column: 1, scrollTop: 0 });
    });

    it('lässt Tabs fehlender Dateien beim Wiederherstellen still weg; der Nachbar des aktiven wird aktiv', async () => {
      const files = { 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c', 'd.txt': 'd' };
      const { test: first, windowId: firstWindow, at } = await openAlpha(files);
      const all = ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((n) => at(n));
      await call(first, firstWindow, 'project.setTabs', { tabs: all, active: at('b.txt') });

      // Von aussen: b.txt fehlt, c.txt ist jetzt ein Ordner.
      fs.rmSync(at('b.txt'));
      fs.rmSync(at('c.txt'));
      fs.mkdirSync(at('c.txt'));
      const { test, windowId } = await restarted(first);
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs: [at('a.txt'), at('d.txt')], active: at('d.txt'), pinned: [] });

      // Fehlt auch alles dahinter, wird der vorherige aktiv; fehlt alles, gibt es keinen.
      await call(test, windowId, 'project.setTabs', { tabs: [at('a.txt'), at('d.txt')], active: at('d.txt') });
      fs.rmSync(at('d.txt'));
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs: [at('a.txt')], active: at('a.txt'), pinned: [] });
      fs.rmSync(at('a.txt'));
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs: [], active: null, pinned: [] });
    });

    it('lässt Tabs und Cursor Umbenennungen und Löschungen in Codium folgen', async () => {
      const { test, windowId, at } = await openAlpha({ 'src/a/A.java': 'a', 'src/a/B.java': 'b', 'C.java': 'c' });
      await call(test, windowId, 'project.setTabs', { tabs: [at('src', 'a', 'A.java'), at('C.java')], active: at('src', 'a', 'A.java') });
      await call(test, windowId, 'project.setCursor', { path: at('src', 'a', 'A.java'), cursor: { line: 7, column: 2, scrollTop: 0 } });
      await call(test, windowId, 'project.setCursor', { path: at('C.java'), cursor: { line: 1, column: 4, scrollTop: 0 } });

      // Den Ordner umbenennen: Tab und Cursor der Datei darin ziehen mit.
      await call(test, windowId, 'files.rename', { path: at('src', 'a'), newName: 'b' });
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs: [at('src', 'b', 'A.java'), at('C.java')], active: at('src', 'b', 'A.java'), pinned: [] });
      expect(await call(test, windowId, 'project.cursor', { path: at('src', 'b', 'A.java') })).toEqual({ line: 7, column: 2, scrollTop: 0 });
      expect(await call(test, windowId, 'project.cursor', { path: at('src', 'a', 'A.java') })).toBeNull();

      // Löschen entfernt Tab und Cursor.
      await call(test, windowId, 'files.delete', { paths: [at('src')] });
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs: [at('C.java')], active: at('C.java'), pinned: [] });
      expect(await call(test, windowId, 'project.cursor', { path: at('src', 'b', 'A.java') })).toBeNull();
      expect(await call(test, windowId, 'project.cursor', { path: at('C.java') })).toEqual({ line: 1, column: 4, scrollTop: 0 });
    });

    it('lehnt ungültige Tabs und Cursor ab', async () => {
      const { root, test, windowId, at, project } = await openAlpha({ 'a.txt': 'a' });
      const invalid = async (name: 'project.setTabs' | 'project.setCursor', params: unknown) =>
        expect(call(test, windowId, name, params as never), JSON.stringify(params)).rejects.toMatchObject({
          code: expect.stringMatching(new RegExp(`^(${ErrorCode.invalidParams}|${ErrorCode.pathOutsideProject})$`)),
        });

      await invalid('project.setTabs', { tabs: [at('a.txt'), at('A.TXT')], active: null });
      await invalid('project.setTabs', { tabs: [at('a.txt')], active: at('b.txt') });
      await invalid('project.setTabs', { tabs: [path.join(root, 'x.txt')], active: null });
      await invalid('project.setTabs', { tabs: [project], active: null });
      await invalid('project.setTabs', { tabs: ['a.txt'], active: null });
      await invalid('project.setTabs', { tabs: 'a.txt', active: null });
      await invalid('project.setCursor', { path: at('a.txt'), cursor: { line: 0, column: 1, scrollTop: 0 } });
      await invalid('project.setCursor', { path: at('a.txt'), cursor: { line: 1, column: 1.5, scrollTop: 0 } });
      await invalid('project.setCursor', { path: at('a.txt'), cursor: { line: 1, column: 1, scrollTop: -1 } });
      await invalid('project.setCursor', { path: path.join(root, 'x.txt'), cursor: { line: 1, column: 1, scrollTop: 0 } });
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs: [], active: null, pinned: [] });
    });

    it('übergeht doppelte Tabs in einer beschädigten Zustandsdatei, damit sich die Tabs weiter speichern lassen', async () => {
      const { test: first, windowId: firstWindow, at, root } = await openAlpha({ 'a.txt': 'a', 'b.txt': 'b' });
      await call(first, firstWindow, 'project.setTabs', { tabs: [at('a.txt')], active: at('a.txt') });
      await quitApp(first);
      // Von Hand bearbeitet: a.txt doppelt, einmal in anderer Schreibweise.
      const stateDir = path.join(root, 'data', 'projects');
      const [stateFile] = fs.readdirSync(stateDir).map((name) => path.join(stateDir, name));
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
      fs.writeFileSync(stateFile, JSON.stringify({ ...state, tabs: ['a.txt', 'b.txt', 'A.TXT'], activeTab: 'b.txt' }));

      const test = createTestCore(path.join(root, 'data'));
      await test.core.start();
      const windowId = test.ports.windows.windowTitled(title('Alpha'));
      const tabs = await call(test, windowId, 'project.tabs');
      expect(tabs).toEqual({ tabs: [at('a.txt'), at('b.txt')], active: at('b.txt'), pinned: [] });
      await expect(call(test, windowId, 'project.setTabs', tabs)).resolves.toBeUndefined();
    });

    it('sichert angeheftete Tabs über einen Neustart; Löschen und fehlende Dateien verringern sie', async () => {
      const { test: first, windowId: firstWindow, at } = await openAlpha({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c', 'd.txt': 'd' });
      const tabs = ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((n) => at(n));
      // Angeheftete müssen die ersten Tabs sein.
      await expect(
        call(first, firstWindow, 'project.setTabs', { tabs, active: at('c.txt'), pinned: [at('b.txt')] }),
      ).rejects.toMatchObject({ code: ErrorCode.invalidParams });
      await call(first, firstWindow, 'project.setTabs', { tabs, active: at('c.txt'), pinned: [at('a.txt'), at('b.txt')] });

      const { test, windowId } = await restarted(first);
      expect(await call(test, windowId, 'project.tabs')).toEqual({ tabs, active: at('c.txt'), pinned: [at('a.txt'), at('b.txt')] });
      // Ein angehefteter Tab wird in Codium gelöscht, einer fehlt nach dem nächsten Neustart.
      await call(test, windowId, 'files.delete', { paths: [at('a.txt')] });
      expect(await call(test, windowId, 'project.tabs')).toMatchObject({ pinned: [at('b.txt')] });
      fs.rmSync(at('b.txt'));
      const { test: third, windowId: thirdWindow } = await restarted(test);
      expect(await call(third, thirdWindow, 'project.tabs')).toEqual({ tabs: [at('c.txt'), at('d.txt')], active: at('c.txt'), pinned: [] });
      // c.txt ist jetzt der erste Tab, aber nicht angeheftet.
      await call(third, thirdWindow, 'project.setTabs', { tabs: [at('c.txt'), at('d.txt')], active: at('c.txt') });
      expect(await call(third, thirdWindow, 'project.tabs')).toMatchObject({ pinned: [] });
    });

    it('merkt sich die Cursor der zuletzt benutzten 500 Dateien', async () => {
      const { test, windowId, at } = await openAlpha();
      for (let i = 0; i < 501; i++) {
        await call(test, windowId, 'project.setCursor', { path: at(`f${i}.txt`), cursor: { line: i + 1, column: 1, scrollTop: 0 } });
      }
      // f0 ist der älteste und fällt heraus; ein erneutes Setzen macht f1 zum neuesten.
      expect(await call(test, windowId, 'project.cursor', { path: at('f0.txt') })).toBeNull();
      await call(test, windowId, 'project.setCursor', { path: at('f1.txt'), cursor: { line: 9, column: 9, scrollTop: 0 } });
      await call(test, windowId, 'project.setCursor', { path: at('f501.txt'), cursor: { line: 1, column: 1, scrollTop: 0 } });
      expect(await call(test, windowId, 'project.cursor', { path: at('f1.txt') })).toEqual({ line: 9, column: 9, scrollTop: 0 });
      expect(await call(test, windowId, 'project.cursor', { path: at('f2.txt') })).toBeNull();
    });
  });
});
