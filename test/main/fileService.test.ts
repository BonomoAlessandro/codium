// Teststelle 1: Datei-Dienst am Vertrag, mit echtem Dateisystem in Temp-Ordnern und nachgemachten Ports
// (Papierkorb als Ordner, Zwischenablage im Speicher, Explorer aufgezeichnet).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  CommandArgs,
  CommandName,
  CommandResult,
  FileChange,
  FileOperation,
  FilesChangedEvent,
} from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Datei-Dienst', () => {
  const tempDir = useTempDirs();

  /** Ein Projekt „Alpha“ mit vorgegebenen Dateien (Pfad → Inhalt; endet der Pfad auf „/“, ein Ordner), offen in Codium. */
  async function openAlpha(files: Record<string, string> = {}) {
    const root = tempDir();
    const project = path.join(root, 'Alpha');
    fs.mkdirSync(project);
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(project, relative);
      if (relative.endsWith('/')) fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
    }
    const test = createTestCore(path.join(root, 'data'));
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(title('Alpha'));
    const at = (...parts: string[]) => path.join(project, ...parts);
    return { root, project, test, windowId, at };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  function changedEvents(test: TestCore, windowId: number): FilesChangedEvent[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'files.changed')
      .map((e) => e.payload as FilesChangedEvent);
  }

  function changes(test: TestCore, windowId: number): FileChange[] {
    return changedEvents(test, windowId).flatMap((e) => e.changes);
  }

  function operations(test: TestCore, windowId: number): FileOperation[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'files.operation')
      .map((e) => e.payload as FileOperation);
  }

  function gitEvents(test: TestCore, windowId: number): number {
    return test.events.forWindow(windowId).filter((e) => e.name === 'git.dataChanged').length;
  }

  /** Vergisst die bisher aufgezeichneten Ereignisse eines Fensters. */
  function clearEvents(test: TestCore, windowId: number): void {
    for (let i = test.events.sent.length - 1; i >= 0; i--) if (test.events.sent[i].windowId === windowId) test.events.sent.splice(i, 1);
  }

  /**
   * Wartet, bis die Überwachung läuft (sie startet asynchron mit dem Projekt): Eine Probedatei wird so lange neu
   * angelegt, bis ihr Ereignis ankommt. Danach sind die Ereignisse vergessen.
   */
  async function untilWatching(test: TestCore, windowId: number, project: string): Promise<void> {
    const probe = path.join(project, 'watch-probe.tmp');
    for (let attempt = 0; attempt < 50; attempt++) {
      fs.writeFileSync(probe, String(attempt));
      await sleep(150);
      if (changes(test, windowId).some((c) => c.path === probe)) break;
    }
    fs.rmSync(probe);
    await expect.poll(() => changes(test, windowId).some((c) => c.path === probe && c.kind === 'deleted')).toBe(true);
    clearEvents(test, windowId);
  }

  /**
   * Wartet, bis die Überwachung alles bis hierher ausgewertet hat: Eine Markierungsdatei von aussen muss ankommen.
   * Ereignisse davor sind dann schon gemeldet.
   */
  async function settle(test: TestCore, windowId: number, project: string): Promise<void> {
    const marker = path.join(project, `marker-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(marker, '');
    await expect.poll(() => changes(test, windowId).some((c) => c.path === marker)).toBe(true);
  }

  describe('Ordnerinhalt', () => {
    it('zeigt Ordner vor Dateien, alphabetisch ohne Gross-/Kleinschreibung, ohne .git', async () => {
      const { test, windowId, project, at } = await openAlpha({
        'src/': '',
        'Build/': '',
        '.github/': '',
        '.git/HEAD': 'ref: refs/heads/main\n',
        'b.txt': '',
        'A.txt': '',
        'c.TXT': '',
        '.gitignore': '',
        'src/.git/config': '',
        'src/Main.java': '',
      });

      expect(await call(test, windowId, 'files.list', { path: project })).toEqual([
        { name: '.github', path: at('.github'), isDirectory: true },
        { name: 'Build', path: at('Build'), isDirectory: true },
        { name: 'src', path: at('src'), isDirectory: true },
        { name: '.gitignore', path: at('.gitignore'), isDirectory: false },
        { name: 'A.txt', path: at('A.txt'), isDirectory: false },
        { name: 'b.txt', path: at('b.txt'), isDirectory: false },
        { name: 'c.TXT', path: at('c.TXT'), isDirectory: false },
      ]);
      // Auch ein `.git` weiter unten (etwa ein eingebettetes Repository) fehlt.
      expect(await call(test, windowId, 'files.list', { path: at('src') })).toEqual([
        { name: 'Main.java', path: at('src', 'Main.java'), isDirectory: false },
      ]);
    });

    it('zeigt eine Junction auf einen Ordner im Projekt als Ordner und liest sie', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'real/inner.txt': '' });
      fs.symlinkSync(at('real'), at('link'), 'junction');

      expect(await call(test, windowId, 'files.list', { path: project })).toContainEqual({ name: 'link', path: at('link'), isDirectory: true });
      expect(await call(test, windowId, 'files.list', { path: at('link') })).toEqual([
        { name: 'inner.txt', path: at('link', 'inner.txt'), isDirectory: false },
      ]);
    });

    it('meldet einen fehlenden Ordner mit FILE_NOT_FOUND und eine Datei mit INVALID_PARAMS', async () => {
      const { test, windowId, at } = await openAlpha({ 'a.txt': '' });

      await expect(call(test, windowId, 'files.list', { path: at('fehlt') })).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
        data: { path: at('fehlt') },
      });
      await expect(call(test, windowId, 'files.list', { path: at('a.txt') })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    });

    it('braucht ein Projekt', async () => {
      const root = tempDir();
      const test = createTestCore(path.join(root, 'data'));
      await test.core.start();
      const response = await test.core.router.dispatch({ windowId: test.ports.windows.windowTitled(WELCOME) }, 'files.list', { path: root });
      expect(response).toMatchObject({ ok: false, error: { code: 'NO_PROJECT' } });
    });
  });

  describe('Dateioperationen', () => {
    it('legt Dateien und Ordner an, auch mit Unterordnern im Namen, und meldet jede Operation', async () => {
      const { test, windowId, project, at } = await openAlpha();

      expect(await call(test, windowId, 'files.createFile', { parent: project, name: 'Main.java' })).toBe(at('Main.java'));
      expect(fs.readFileSync(at('Main.java'), 'utf8')).toBe('');
      expect(await call(test, windowId, 'files.createDirectory', { parent: project, name: 'docs' })).toBe(at('docs'));
      expect(fs.statSync(at('docs')).isDirectory()).toBe(true);
      // Wie in IntelliJ: „/“ legt die Ordner dazwischen mit an; gemeldet wird der oberste neue Eintrag.
      expect(await call(test, windowId, 'files.createFile', { parent: project, name: 'src/main/App.ts' })).toBe(
        at('src', 'main', 'App.ts'),
      );
      expect(await call(test, windowId, 'files.createDirectory', { parent: at('docs'), name: 'a\\b' })).toBe(at('docs', 'a', 'b'));
      expect(fs.statSync(at('docs', 'a', 'b')).isDirectory()).toBe(true);

      expect(operations(test, windowId)).toEqual([
        { kind: 'created', path: at('Main.java'), isDirectory: false },
        { kind: 'created', path: at('docs'), isDirectory: true },
        { kind: 'created', path: at('src'), isDirectory: true },
        { kind: 'created', path: at('docs', 'a'), isDirectory: true },
      ]);
    });

    it('lehnt vergebene und unter Windows unerlaubte Namen ab', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'Main.java': 'x', 'docs/': '' });

      for (const name of ['Main.java', 'main.JAVA', 'docs']) {
        await expect(call(test, windowId, 'files.createFile', { parent: project, name }), name).rejects.toMatchObject({
          code: 'FILE_EXISTS',
        });
      }
      await expect(call(test, windowId, 'files.createDirectory', { parent: project, name: 'DOCS' })).rejects.toMatchObject({
        code: 'FILE_EXISTS',
      });
      // Eine Datei kann kein Ordner im Namen sein.
      await expect(call(test, windowId, 'files.createFile', { parent: project, name: 'Main.java/x.txt' })).rejects.toMatchObject({
        code: 'FILE_EXISTS',
      });
      for (const name of ['', 'a:b', 'x?.txt', 'con', 'NUL.txt', 'ends.', 'ends ', '..', 'a//b', '/a']) {
        await expect(call(test, windowId, 'files.createFile', { parent: project, name }), JSON.stringify(name)).rejects.toMatchObject({
          code: 'INVALID_FILE_NAME',
        });
      }
      expect(fs.readFileSync(at('Main.java'), 'utf8')).toBe('x');
      expect(operations(test, windowId)).toEqual([]);
    });

    it('benennt um, auch nur in der Gross-/Kleinschreibung, aber nicht auf einen vergebenen Namen', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'a.txt': 'A', 'b.txt': 'B', 'dir/inner.txt': '' });

      expect(await call(test, windowId, 'files.rename', { path: at('a.txt'), newName: 'c.txt' })).toBe(at('c.txt'));
      expect(fs.readFileSync(at('c.txt'), 'utf8')).toBe('A');
      expect(fs.existsSync(at('a.txt'))).toBe(false);
      expect(await call(test, windowId, 'files.rename', { path: at('c.txt'), newName: 'C.txt' })).toBe(at('C.txt'));
      expect(fs.readdirSync(project)).toContain('C.txt');
      expect(await call(test, windowId, 'files.rename', { path: at('dir'), newName: 'folder' })).toBe(at('folder'));
      expect(fs.existsSync(at('folder', 'inner.txt'))).toBe(true);

      await expect(call(test, windowId, 'files.rename', { path: at('C.txt'), newName: 'B.TXT' })).rejects.toMatchObject({
        code: 'FILE_EXISTS',
      });
      await expect(call(test, windowId, 'files.rename', { path: at('C.txt'), newName: 'sub/x.txt' })).rejects.toMatchObject({
        code: 'INVALID_FILE_NAME',
      });
      await expect(call(test, windowId, 'files.rename', { path: project, newName: 'Beta' })).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
      });
      expect(operations(test, windowId)).toEqual([
        { kind: 'renamed', from: at('a.txt'), to: at('c.txt'), isDirectory: false },
        { kind: 'renamed', from: at('c.txt'), to: at('C.txt'), isDirectory: false },
        { kind: 'renamed', from: at('dir'), to: at('folder'), isDirectory: true },
      ]);
    });

    it('löscht in den Papierkorb über den Port; ein Eintrag in einem gelöschten Ordner zählt nicht doppelt', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'a.txt': 'A', 'dir/inner.txt': 'I', 'keep.txt': '' });

      await call(test, windowId, 'files.delete', { paths: [at('dir', 'inner.txt'), at('a.txt'), at('dir')] });

      expect(fs.readdirSync(project)).toEqual(['keep.txt']);
      expect(test.ports.shell.trashed.map((t) => t.path)).toEqual([at('a.txt'), at('dir')]);
      for (const { movedTo } of test.ports.shell.trashed) expect(fs.existsSync(movedTo)).toBe(true);
      expect(fs.readFileSync(path.join(test.ports.shell.trashed[1].movedTo, 'inner.txt'), 'utf8')).toBe('I');
      expect(operations(test, windowId)).toEqual([
        { kind: 'deleted', path: at('a.txt'), isDirectory: false },
        { kind: 'deleted', path: at('dir'), isDirectory: true },
      ]);

      await expect(call(test, windowId, 'files.delete', { paths: [project] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      await expect(call(test, windowId, 'files.delete', { paths: [at('a.txt')] })).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
      await expect(call(test, windowId, 'files.delete', { paths: [] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      expect(fs.existsSync(project)).toBe(true);
    });

    it('kopiert und schlägt bei einem Namenskonflikt einen Namen mit Zusatz vor', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'Main.java': 'class Main {}', 'dir/inner.txt': 'I', 'target/': '' });

      expect(await call(test, windowId, 'files.suggestCopyName', { source: at('Main.java'), target: at('target') })).toBe('Main.java');
      expect(await call(test, windowId, 'files.suggestCopyName', { source: at('Main.java'), target: project })).toBe('Main (2).java');
      expect(await call(test, windowId, 'files.copy', { sources: [at('Main.java')], target: project })).toEqual([at('Main (2).java')]);
      expect(await call(test, windowId, 'files.copy', { sources: [at('Main.java')], target: project })).toEqual([at('Main (3).java')]);
      // Ein vorhandener Zusatz zählt weiter.
      expect(await call(test, windowId, 'files.copy', { sources: [at('Main (2).java')], target: project })).toEqual([at('Main (4).java')]);
      expect(fs.readFileSync(at('Main (4).java'), 'utf8')).toBe('class Main {}');

      // Ordner samt Inhalt, mehrere auf einmal; ohne Konflikt unter dem eigenen Namen.
      expect(await call(test, windowId, 'files.copy', { sources: [at('dir'), at('Main.java')], target: at('target') })).toEqual([
        at('target', 'dir'),
        at('target', 'Main.java'),
      ]);
      expect(fs.readFileSync(at('target', 'dir', 'inner.txt'), 'utf8')).toBe('I');
      expect(await call(test, windowId, 'files.copy', { sources: [at('dir')], target: project })).toEqual([at('dir (2)')]);

      // Ein vorgegebener Name gilt genau so; ist er vergeben, scheitert die Kopie.
      expect(await call(test, windowId, 'files.copy', { sources: [at('Main.java')], target: project, newName: 'Copy.java' })).toEqual([
        at('Copy.java'),
      ]);
      await expect(
        call(test, windowId, 'files.copy', { sources: [at('Main.java')], target: project, newName: 'copy.JAVA' }),
      ).rejects.toMatchObject({ code: 'FILE_EXISTS' });
      await expect(
        call(test, windowId, 'files.copy', { sources: [at('Main.java'), at('dir')], target: project, newName: 'x' }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

      // Nicht in sich selbst und nicht den Projektordner.
      await expect(call(test, windowId, 'files.copy', { sources: [at('dir')], target: at('dir') })).rejects.toMatchObject({
        code: 'FILE_OPERATION_FAILED',
      });
      await expect(call(test, windowId, 'files.copy', { sources: [project], target: at('target') })).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
      });
      expect(operations(test, windowId).filter((o) => o.kind === 'copied')).toHaveLength(7);
      expect(operations(test, windowId)[0]).toEqual({ kind: 'copied', from: at('Main.java'), to: at('Main (2).java'), isDirectory: false });
    });

    it('kopiert Pfade in die Zwischenablage und zeigt im Explorer, beides über den Port', async () => {
      const { test, windowId, at } = await openAlpha({ 'a.txt': '', 'dir/': '' });

      await call(test, windowId, 'files.copyPaths', { paths: [at('a.txt'), at('dir')] });
      expect(test.ports.shell.clipboard).toBe(`${at('a.txt')}\n${at('dir')}`);
      await call(test, windowId, 'files.showInExplorer', { path: at('a.txt') });
      expect(test.ports.shell.shownInExplorer).toEqual([at('a.txt')]);
    });
  });

  describe('Pfade nur innerhalb des Projekts', () => {
    /** Ein Projekt mit einem Ordner daneben und einer Junction im Projekt, die auf ihn zeigt. */
    async function withOutside() {
      const alpha = await openAlpha({ 'inside.txt': 'drin', 'dir/': '' });
      const outside = path.join(alpha.root, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'geheim');
      fs.symlinkSync(outside, alpha.at('link'), 'junction');
      return { ...alpha, outside };
    }

    it('lehnt bei jedem Befehl Pfade mit „..“, absolute Pfade daneben und Junctions nach draussen ab', async () => {
      const { test, windowId, project, at, outside } = await withOutside();
      const candidates = {
        // Nicht normalisiert: „..“ führt aus dem Projekt.
        dotdot: `${project}\\..\\outside`,
        dotdotFile: `${project}\\dir\\..\\..\\outside\\secret.txt`,
        absolute: outside,
        absoluteFile: path.join(outside, 'secret.txt'),
        junction: at('link'),
        throughJunction: at('link', 'secret.txt'),
      };
      const inside = at('inside.txt');
      const dir = at('dir');
      const attempts = (p: string): Array<[CommandName, unknown]> => [
        ['files.list', { path: p }],
        ['files.createFile', { parent: p, name: 'neu.txt' }],
        ['files.createDirectory', { parent: p, name: 'neu' }],
        ['files.rename', { path: p, newName: 'umbenannt' }],
        ['files.delete', { paths: [inside, p] }],
        ['files.copy', { sources: [p], target: dir }],
        ['files.copy', { sources: [inside], target: p }],
        ['files.suggestCopyName', { source: p, target: dir }],
        ['files.suggestCopyName', { source: inside, target: p }],
        ['files.copyPaths', { paths: [inside, p] }],
        ['files.showInExplorer', { path: p }],
      ];
      for (const [label, candidate] of Object.entries(candidates)) {
        for (const [name, params] of attempts(candidate)) {
          const response = await test.core.router.dispatch({ windowId }, name, params);
          expect(response, `${name} mit ${label}`).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_PROJECT' } });
        }
      }

      // Auch über einen Namen mit Unterordnern geht es nicht durch die Junction hinaus.
      await expect(call(test, windowId, 'files.createFile', { parent: project, name: 'link/neu.txt' })).rejects.toMatchObject({
        code: 'PATH_OUTSIDE_PROJECT',
      });
      await expect(call(test, windowId, 'files.createDirectory', { parent: project, name: 'link/neu' })).rejects.toMatchObject({
        code: 'PATH_OUTSIDE_PROJECT',
      });

      // Draussen und drinnen ist nichts passiert.
      expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('geheim');
      expect(fs.readFileSync(inside, 'utf8')).toBe('drin');
      expect(fs.readdirSync(dir)).toEqual([]);
      expect(test.ports.shell.trashed).toEqual([]);
      expect(test.ports.shell.clipboard).toBe('');
      expect(test.ports.shell.shownInExplorer).toEqual([]);
      expect(operations(test, windowId)).toEqual([]);
    });

    it('lehnt relative und kaputte Pfade mit INVALID_PARAMS ab', async () => {
      const { test, windowId, project } = await withOutside();
      for (const p of ['inside.txt', '.\\inside.txt', '\\inside.txt', 42, null, `${project}\\inside.txt:stream`, `${project}\\.. \\outside`, `\\\\?\\${project}`]) {
        const response = await test.core.router.dispatch({ windowId }, 'files.list', { path: p });
        expect(response, JSON.stringify(p)).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
      }
    });
  });

  describe('Dateiüberwachung', () => {
    it('meldet von aussen angelegte, geänderte, umbenannte und gelöschte Dateien gebündelt', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'old.txt': 'alt', 'edit.txt': 'alt', 'gone.txt': '', 'sub/': '' });
      await untilWatching(test, windowId, project);

      fs.writeFileSync(at('new.txt'), 'neu');
      fs.writeFileSync(at('sub', 'deep.txt'), 'tief');
      fs.appendFileSync(at('edit.txt'), ' und neu');
      fs.renameSync(at('old.txt'), at('renamed.txt'));
      fs.rmSync(at('gone.txt'));

      const expected: FileChange[] = [
        { path: at('edit.txt'), kind: 'changed' },
        { path: at('gone.txt'), kind: 'deleted' },
        { path: at('new.txt'), kind: 'created' },
        { path: at('old.txt'), kind: 'deleted' },
        { path: at('renamed.txt'), kind: 'created' },
        { path: at('sub', 'deep.txt'), kind: 'created' },
      ];
      await expect.poll(() => changes(test, windowId).length).toBeGreaterThanOrEqual(expected.length);
      // Alles in einem Bündel, sortiert nach Pfad.
      expect(changedEvents(test, windowId)).toEqual([{ changes: expected }]);
    });

    it('meldet Löschen und sofortiges Neuanlegen als Änderung, nicht als Löschen', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'a.txt': 'alt', 'listed/b.txt': 'alt' });
      // Einmal in einem schon gelesenen Ordner, einmal in einem ungelesenen.
      await call(test, windowId, 'files.list', { path: at('listed') });
      await untilWatching(test, windowId, project);

      fs.rmSync(at('a.txt'));
      fs.writeFileSync(at('a.txt'), 'neu');
      fs.rmSync(at('listed', 'b.txt'));
      fs.writeFileSync(at('listed', 'b.txt'), 'neu');
      await settle(test, windowId, project);

      const relevant = changes(test, windowId).filter((c) => !c.path.includes('marker-'));
      expect(relevant).toEqual([
        { path: at('a.txt'), kind: 'changed' },
        { path: at('listed', 'b.txt'), kind: 'changed' },
      ]);
    });

    it('meldet nichts aus .git, aber „Git-Daten geändert“ bei HEAD, Index und Refs', async () => {
      const { test, windowId, project, at } = await openAlpha({ '.git/config': '', '.git/objects/': '', 'src/': '' });
      await untilWatching(test, windowId, project);

      fs.writeFileSync(at('.git', 'config'), '[core]\n');
      fs.mkdirSync(at('.git', 'objects', 'ab'));
      fs.writeFileSync(at('.git', 'objects', 'ab', 'cdef'), 'blob');
      fs.writeFileSync(at('.git', 'index.lock'), '');
      fs.mkdirSync(at('src', '.git'));
      fs.writeFileSync(at('src', '.git', 'HEAD'), 'eingebettet');
      await settle(test, windowId, project);
      expect(gitEvents(test, windowId)).toBe(0);

      for (const [i, target] of [at('.git', 'HEAD'), at('.git', 'index'), at('.git', 'refs', 'heads', 'main'), at('.git', 'packed-refs')].entries()) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'neu');
        await expect.poll(() => gitEvents(test, windowId), { message: path.basename(target) }).toBe(i + 1);
        // Gebündelt: erst nach einer Pause kommt das nächste Ereignis.
        await sleep(100);
      }
      await settle(test, windowId, project);
      expect(changes(test, windowId).filter((c) => /[\\/]\.git([\\/]|$)/i.test(c.path))).toEqual([]);
      expect(changes(test, windowId).filter((c) => !c.path.includes('marker-'))).toEqual([]);
    });

    it('meldet eigene Dateioperationen nicht als Änderung von aussen', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'a.txt': 'A', 'dir/inner.txt': '' });
      await untilWatching(test, windowId, project);

      await call(test, windowId, 'files.createFile', { parent: project, name: 'neu/new.txt' });
      await call(test, windowId, 'files.rename', { path: at('a.txt'), newName: 'b.txt' });
      await call(test, windowId, 'files.copy', { sources: [at('dir')], target: project });
      await call(test, windowId, 'files.delete', { paths: [at('dir')] });
      await sleep(300);
      await settle(test, windowId, project);

      expect(changes(test, windowId).filter((c) => !c.path.includes('marker-'))).toEqual([]);
      expect(operations(test, windowId).map((o) => o.kind)).toEqual(['created', 'renamed', 'copied', 'deleted']);
    });

    it('meldet eine fremde Änderung kurz nach einer eigenen Operation trotzdem', async () => {
      const { test, windowId, project, at } = await openAlpha();
      await untilWatching(test, windowId, project);

      await call(test, windowId, 'files.createFile', { parent: project, name: 'a.txt' });
      await sleep(300);
      fs.writeFileSync(at('a.txt'), 'von aussen');

      await expect.poll(() => changes(test, windowId)).toEqual([{ path: at('a.txt'), kind: 'changed' }]);
    });

    it('liest nach einem Ereignis ohne Dateinamen (übergelaufener Puffer) die gelesenen Ordner neu ein', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'old.txt': '' });
      await call(test, windowId, 'files.list', { path: project });
      await untilWatching(test, windowId, project);

      // Viele Dateien in einem Zug, ohne dass die Ereignisschleife dazwischen läuft: Der Puffer von Windows läuft über.
      const names = Array.from({ length: 3000 }, (_, i) => `a-rather-long-file-name-to-fill-the-buffer-${String(i).padStart(4, '0')}.txt`);
      for (const name of names) fs.writeFileSync(at(name), '');
      fs.rmSync(at('old.txt'));

      await expect.poll(() => changedEvents(test, windowId).some((e) => e.rescanned), { timeout: 10_000 }).toBe(true);
      await settle(test, windowId, project);
      const created = new Set(changes(test, windowId).filter((c) => c.kind === 'created').map((c) => c.path));
      for (const name of names) expect(created.has(at(name)), name).toBe(true);
      expect(changes(test, windowId)).toContainEqual({ path: at('old.txt'), kind: 'deleted' });
    });

    it('endet beim Abbau des Projekt-Kerns: keine Ereignisse mehr, der Ordner ist freigegeben', async () => {
      // Ein geschlossener Handle zählt noch, bis libuv ihn in der nächsten Runde wegräumt.
      const watchers = () => process.getActiveResourcesInfo().filter((r) => r === 'FSEventWrap').length;
      await sleep(50);
      const before = watchers();
      const { test, windowId, project, at } = await openAlpha();
      await untilWatching(test, windowId, project);
      expect(watchers()).toBe(before + 1);

      // Das Fenster bleibt offen, nur der Projekt-Kern geht: So käme ein Ereignis noch an, wenn es eines gäbe.
      fs.writeFileSync(at('pending.txt'), '');
      const disposal = test.core.closeProjectCore(windowId);
      // Der Ordner ist sofort freigegeben, noch bevor der Abbau fertig ist. Ein überwachter Ordner bliebe unter
      // Windows stehen, bis die Überwachung ihn loslässt.
      fs.rmSync(project, { recursive: true });
      expect(fs.existsSync(project)).toBe(false);
      await disposal;
      await sleep(400);

      expect(changedEvents(test, windowId)).toEqual([]);
      await expect.poll(() => watchers()).toBe(before);
    });
  });

  describe('Aufgeklappte Ordner', () => {
    it('sind ohne gespeicherte nur der Projektordner und überstehen einen Neustart', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'src/main/': '', 'docs/': '' });
      expect(await call(test, windowId, 'project.expandedFolders')).toEqual([project]);

      await call(test, windowId, 'project.setExpandedFolders', { paths: [project, at('src'), at('src', 'main'), at('SRC')] });
      await call(test, windowId, 'app.exit');

      const after = await restart(test);
      await after.core.start();
      const reopened = after.ports.windows.windowTitled(title('Alpha'));
      expect(await call(after, reopened, 'project.expandedFolders')).toEqual([project, at('src'), at('src', 'main')]);
    });

    it('nehmen nur Pfade im Projekt an', async () => {
      const { test, windowId, project, root } = await openAlpha();
      await call(test, windowId, 'project.setExpandedFolders', { paths: [project] });

      for (const paths of [[root], [`${project}\\..\\other`], ['relative'], 'kein Array']) {
        const response = await test.core.router.dispatch({ windowId }, 'project.setExpandedFolders', { paths });
        expect(response, JSON.stringify(paths)).toMatchObject({ ok: false });
      }
      expect(await call(test, windowId, 'project.expandedFolders')).toEqual([project]);
    });
  });
});
