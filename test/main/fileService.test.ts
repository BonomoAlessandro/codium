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
import { createTestCore, restart, type TestCore, type TestCoreOptions } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Datei-Dienst', () => {
  const tempDir = useTempDirs();

  /** Ein Projekt „Alpha“ mit vorgegebenen Dateien (Pfad → Inhalt; endet der Pfad auf „/“, ein Ordner), offen in Codium. */
  async function openAlpha(files: Record<string, string> = {}, options: TestCoreOptions = {}) {
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
    const test = createTestCore(path.join(root, 'data'), options);
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

    it('kopiert Ordner mit Junctions, ohne ihnen zu folgen: Die Kopie bekommt eine Junction auf dasselbe Ziel', async () => {
      const { test, windowId, project, at, root } = await openAlpha({ 'src/a.txt': 'a', 'shared/s.txt': 's', 'src/sub/b.txt': 'b' });
      const outside = path.join(root, 'outside');
      fs.mkdirSync(outside);
      fs.symlinkSync(at('shared'), at('src', 'inner'), 'junction');
      fs.symlinkSync(outside, at('src', 'external'), 'junction');
      fs.symlinkSync(path.join(root, 'gone'), at('src', 'dead'), 'junction');

      expect(await call(test, windowId, 'files.copy', { sources: [at('src')], target: project })).toEqual([at('src (2)')]);
      expect(fs.readdirSync(at('src (2)')).sort()).toEqual(['a.txt', 'dead', 'external', 'inner', 'sub']);
      expect(fs.readFileSync(at('src (2)', 'sub', 'b.txt'), 'utf8')).toBe('b');
      for (const [link, target] of [
        ['inner', at('shared')],
        ['external', outside],
      ]) {
        expect(fs.lstatSync(at('src (2)', link)).isSymbolicLink(), link).toBe(true);
        expect(fs.realpathSync.native(at('src (2)', link)), link).toBe(target);
      }
      expect(fs.readlinkSync(at('src (2)', 'dead'))).toBe(path.join(root, 'gone'));
      // Die Junctions wurden nicht verfolgt: Draussen und im gemeinsamen Ordner ist nichts dazugekommen.
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.readdirSync(at('shared'))).toEqual(['s.txt']);
    });

    it('kopiert nicht in sich selbst, auch nicht über eine Junction in einen Unterordner der Quelle', async () => {
      const { test, windowId, at } = await openAlpha({ 'src/sub/b.txt': 'b' });
      fs.symlinkSync(at('src', 'sub'), at('into-sub'), 'junction');

      await expect(call(test, windowId, 'files.copy', { sources: [at('src')], target: at('into-sub') })).rejects.toMatchObject({
        code: 'FILE_OPERATION_FAILED',
        message: 'Cannot copy “src” into itself.',
      });
      expect(fs.readdirSync(at('src', 'sub'))).toEqual(['b.txt']);
    });

    it('räumt eine gescheiterte Kopie weg und meldet sie nicht als eigene Änderung', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 20; i++) files[`dir/file-${String(i).padStart(2, '0')}.txt`] = 'x';
      const { test, windowId, project, at } = await openAlpha(files);
      await untilWatching(test, windowId, project);
      // Eine Datei mitten in der Quelle ist gesperrt (ohne Freigabe für andere geöffnet, UV_FS_O_EXLOCK).
      const locked = await fs.promises.open(at('dir', 'file-10.txt'), fs.constants.O_RDONLY | 0x10000000);
      try {
        await expect(call(test, windowId, 'files.copy', { sources: [at('dir')], target: project })).rejects.toMatchObject({
          code: 'FILE_OPERATION_FAILED',
          message: 'Could not copy “file-10.txt”: the file is in use.',
        });
      } finally {
        await locked.close();
      }
      expect(fs.existsSync(at('dir (2)'))).toBe(false);
      expect(operations(test, windowId)).toEqual([]);
      await settle(test, windowId, project);
      // Was die gescheiterte Kopie kurz angelegt hatte, ist wieder weg; als eigene Änderung gilt nichts mehr.
      expect(changes(test, windowId).filter((c) => c.path.startsWith(at('dir (2)')) && c.kind !== 'deleted')).toEqual([]);

      // Danach geht dieselbe Kopie unter demselben Namen.
      expect(await call(test, windowId, 'files.copy', { sources: [at('dir')], target: project })).toEqual([at('dir (2)')]);
      expect(fs.readdirSync(at('dir (2)'))).toHaveLength(20);
    });

    it('wählt für gleichzeitige Kopien in denselben Ordner verschiedene Namen', async () => {
      const files: Record<string, string> = { 'target/': '' };
      for (let i = 0; i < 30; i++) files[`dir/f${i}.txt`] = 'x'.repeat(5000);
      const { test, windowId, at } = await openAlpha(files);
      const params = { sources: [at('dir')], target: at('target') };

      const results = await Promise.all([call(test, windowId, 'files.copy', params), call(test, windowId, 'files.copy', params)]);
      expect(results.flat().sort()).toEqual([at('target', 'dir'), at('target', 'dir (2)')]);
      for (const copy of results.flat()) expect(fs.readdirSync(copy)).toHaveLength(30);
    });

    it('überschreibt beim Umbenennen keine andere Datei, auch wenn nur JavaScript die Namen gleich schreibt', async () => {
      const { test, windowId, at, project } = await openAlpha({ 'k.txt': 'A', 'K.txt': 'B wichtig' });

      await expect(call(test, windowId, 'files.rename', { path: at('k.txt'), newName: 'K.txt' })).rejects.toMatchObject({
        code: 'FILE_EXISTS',
      });
      expect(fs.readFileSync(at('K.txt'), 'utf8')).toBe('B wichtig');
      expect(fs.readFileSync(at('k.txt'), 'utf8')).toBe('A');
      // Nur die Schreibweise wechseln geht weiterhin.
      expect(await call(test, windowId, 'files.rename', { path: at('k.txt'), newName: 'K.txt' })).toBe(at('K.txt'));
      expect(fs.readdirSync(project).sort()).toEqual(['K.txt', 'K.txt'].sort());
    });

    it('ändert nichts im Ordner .git', async () => {
      const { test, windowId, project, at } = await openAlpha({ '.git/HEAD': 'ref', '.Git/config': '', 'a.txt': '', 'sub/.git/x': '' });
      const attempts: Array<[CommandName, unknown, string]> = [
        ['files.createFile', { parent: at('.git'), name: 'x.txt' }, 'INVALID_PARAMS'],
        ['files.createFile', { parent: project, name: '.git/x.txt' }, 'INVALID_FILE_NAME'],
        ['files.createDirectory', { parent: project, name: 'sub/.GIT' }, 'INVALID_FILE_NAME'],
        ['files.rename', { path: at('.git', 'HEAD'), newName: 'HEAD2' }, 'INVALID_PARAMS'],
        ['files.rename', { path: at('.git'), newName: 'nogit' }, 'INVALID_PARAMS'],
        ['files.rename', { path: at('a.txt'), newName: '.git' }, 'INVALID_FILE_NAME'],
        ['files.copy', { sources: [at('a.txt')], target: at('.git') }, 'INVALID_PARAMS'],
        ['files.copy', { sources: [at('a.txt')], target: project, newName: '.git' }, 'INVALID_FILE_NAME'],
        ['files.copy', { sources: [at('a.txt')], target: at('sub', '.git') }, 'INVALID_PARAMS'],
        ['files.delete', { paths: [at('.git')] }, 'INVALID_PARAMS'],
        ['files.delete', { paths: [at('a.txt'), at('.Git', 'config')] }, 'INVALID_PARAMS'],
      ];
      for (const [name, params, code] of attempts) {
        const response = await test.core.router.dispatch({ windowId }, name, params);
        expect(response, `${name} ${JSON.stringify(params)}`).toMatchObject({ ok: false, error: { code } });
      }
      expect(fs.readdirSync(at('.git')).sort()).toEqual(['HEAD', 'config']);
      expect(fs.existsSync(at('a.txt'))).toBe(true);
      expect(test.ports.shell.trashed).toEqual([]);
      expect(operations(test, windowId)).toEqual([]);
    });

    it('ändert auch über eine Junction nichts im Ordner .git', async () => {
      const { test, windowId, project, at } = await openAlpha({ '.git/hooks/sample': 'x', 'a.txt': '' });
      fs.symlinkSync(at('.git', 'hooks'), at('hooks-link'), 'junction');
      const attempts: Array<[CommandName, unknown]> = [
        ['files.createFile', { parent: at('hooks-link'), name: 'pre-commit' }],
        ['files.createFile', { parent: project, name: 'hooks-link/pre-commit' }],
        ['files.createDirectory', { parent: at('hooks-link'), name: 'neu' }],
        ['files.copy', { sources: [at('a.txt')], target: at('hooks-link') }],
        ['files.rename', { path: at('hooks-link', 'sample'), newName: 'pre-commit' }],
        ['files.delete', { paths: [at('hooks-link', 'sample')] }],
      ];
      for (const [name, params] of attempts) {
        const response = await test.core.router.dispatch({ windowId }, name, params);
        expect(response, `${name} ${JSON.stringify(params)}`).toMatchObject({
          ok: false,
          error: { code: 'INVALID_PARAMS', message: 'Codium does not change the Git folder (.git).' },
        });
      }
      expect(fs.readdirSync(at('.git', 'hooks'))).toEqual(['sample']);
      expect(test.ports.shell.trashed).toEqual([]);

      // Den Link selbst darf man umbenennen und löschen; das Ziel in .git bleibt.
      expect(await call(test, windowId, 'files.rename', { path: at('hooks-link'), newName: 'hooks' })).toBe(at('hooks'));
      await call(test, windowId, 'files.delete', { paths: [at('hooks')] });
      expect(fs.readdirSync(at('.git', 'hooks'))).toEqual(['sample']);
    });

    it('lässt eine laufende Kopie beim Abbau des Projekt-Kerns noch fertig werden', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 300; i++) files[`big/file-${i}.txt`] = 'x'.repeat(1000);
      // Das Zeitlimit der Aufräumarbeiten reicht hier für die ganze Kopie (im Betrieb 5 s).
      const { test, windowId, project, at } = await openAlpha(files, { cleanupTimeoutMs: 30_000 });

      const copying = call(test, windowId, 'files.copy', { sources: [at('big')], target: project });
      await test.core.closeProjectCore(windowId);

      // Schon wenn der Abbau fertig ist, ist die Kopie vollständig.
      expect(fs.existsSync(at('big (2)')) && fs.readdirSync(at('big (2)')).length).toBe(300);
      expect(await copying).toEqual([at('big (2)')]);
    });

    it('meldet eine Operation, die während des Abbaus fertig wird, noch den Diensten im Kern, aber nicht dem Fenster', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 100; i++) files[`big/file-${i}.txt`] = 'x'.repeat(1000);
      const { test, windowId, project, at } = await openAlpha(files, { cleanupTimeoutMs: 30_000 });
      const seen: string[] = [];
      test.core.projectCoreForWindow(windowId)!.subscribe('files.operation', (op) => seen.push(op.kind));

      const copying = call(test, windowId, 'files.copy', { sources: [at('big')], target: project });
      await test.core.closeProjectCore(windowId);

      expect(seen).toEqual(['copied']);
      expect(operations(test, windowId)).toEqual([]);
      await copying;
    });

    it('zeigt bei langen Operationen Fortschritt in der Statusleiste, bei kurzen nicht', async () => {
      const progressOf = (test: TestCore, windowId: number) =>
        test.events.forWindow(windowId).filter((e) => e.name === 'app.progress').map((e) => e.payload as { kind: string; title?: string });
      // Mit der Standardschwelle (1 s) bleibt eine kurze Operation ohne Fortschritt.
      const quick = await openAlpha({ 'a.txt': '' });
      await call(quick.test, quick.windowId, 'files.delete', { paths: [quick.at('a.txt')] });
      expect(progressOf(quick.test, quick.windowId)).toEqual([]);

      // Mit Schwelle 0 gilt jede Operation als lang.
      const slow = await openAlpha({ 'a.txt': '', 'b.txt': '', 'dir/x.txt': '' }, { fileProgressDelayMs: 0 });
      await call(slow.test, slow.windowId, 'files.delete', { paths: [slow.at('a.txt'), slow.at('b.txt')] });
      await call(slow.test, slow.windowId, 'files.copy', { sources: [slow.at('dir')], target: slow.project });
      const events = progressOf(slow.test, slow.windowId);
      expect(events.filter((e) => e.kind === 'begin').map((e) => e.title)).toEqual(['Deleting 2 items…', 'Copying “dir”…']);
      expect(events.filter((e) => e.kind === 'end')).toHaveLength(2);
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
      // Befehle, die durch einen Pfad hindurchgreifen (hinein, darunter, seinen Inhalt).
      const through = (p: string): Array<[CommandName, unknown]> => [
        ['files.list', { path: p }],
        ['files.createFile', { parent: p, name: 'neu.txt' }],
        ['files.createDirectory', { parent: p, name: 'neu' }],
        ['files.copy', { sources: [p], target: dir }],
        ['files.copy', { sources: [inside], target: p }],
        ['files.suggestCopyName', { source: p, target: dir }],
        ['files.suggestCopyName', { source: inside, target: p }],
      ];
      // Befehle auf dem Eintrag selbst; den Link im Projekt dürfen sie bedienen (eigener Test unten).
      const onEntry = (p: string): Array<[CommandName, unknown]> => [
        ['files.rename', { path: p, newName: 'umbenannt' }],
        ['files.delete', { paths: [inside, p] }],
        ['files.copyPaths', { paths: [inside, p] }],
        ['files.showInExplorer', { path: p }],
      ];
      for (const [label, candidate] of Object.entries(candidates)) {
        const commands = label === 'junction' ? through(candidate) : [...through(candidate), ...onEntry(candidate)];
        for (const [name, params] of commands) {
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

      // Auch nicht durch eine tote Junction, deren Ziel draussen erst entstehen würde.
      const gone = path.join(outside, 'gone');
      fs.symlinkSync(gone, at('dead'), 'junction');
      await expect(call(test, windowId, 'files.createFile', { parent: project, name: 'dead/neu.txt' })).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
      });
      await expect(call(test, windowId, 'files.createDirectory', { parent: project, name: 'dead' })).rejects.toMatchObject({
        code: 'FILE_EXISTS',
      });
      expect(fs.existsSync(gone)).toBe(false);

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

    it('vergleicht echte Pfade genau: ein Nachbarordner, den nur JavaScript gleich schreibt, liegt draussen', async () => {
      // Das Kelvin-Zeichen (U+212A) und „ẞ“ (U+1E9E) faltet JavaScript zu „k“ bzw. „ß“, NTFS nicht.
      for (const [name, twin] of [
        ['kodium', 'Kodium'],
        ['straße', 'straẞe'],
      ]) {
        const root = tempDir();
        const project = path.join(root, name);
        const neighbour = path.join(root, twin);
        fs.mkdirSync(project);
        fs.mkdirSync(neighbour);
        fs.writeFileSync(path.join(neighbour, 'secret.txt'), 'geheim');
        const test = createTestCore(path.join(root, 'data'));
        await test.core.start();
        await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
        const windowId = test.ports.windows.windowTitled(title(name));

        await expect(call(test, windowId, 'files.list', { path: neighbour }), name).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
        await expect(call(test, windowId, 'files.createFile', { parent: neighbour, name: 'planted.txt' })).rejects.toMatchObject({
          code: 'PATH_OUTSIDE_PROJECT',
        });
        await expect(call(test, windowId, 'files.delete', { paths: [path.join(neighbour, 'secret.txt')] })).rejects.toMatchObject({
          code: 'PATH_OUTSIDE_PROJECT',
        });
        expect(fs.readdirSync(neighbour)).toEqual(['secret.txt']);
        // Im Projekt selbst geht alles.
        expect(await call(test, windowId, 'files.list', { path: project })).toEqual([]);
      }
    });

    it('bedient einen Link nach draussen als Eintrag, ohne durch ihn hindurchzugreifen', async () => {
      const { test, windowId, project, at, outside } = await withOutside();
      fs.symlinkSync(path.join(outside, 'gone'), at('dead'), 'junction');

      // Der Baum sieht die Links, markiert, und klappt sie nicht auf.
      const listed = await call(test, windowId, 'files.list', { path: project });
      expect(listed.find((e) => e.name === 'link')).toEqual({ name: 'link', path: at('link'), isDirectory: true, blockedLink: 'outside' });
      expect(listed.find((e) => e.name === 'dead')).toEqual({ name: 'dead', path: at('dead'), isDirectory: false, blockedLink: 'missing' });
      expect(listed.find((e) => e.name === 'dir')).toEqual({ name: 'dir', path: at('dir'), isDirectory: true });

      await call(test, windowId, 'files.copyPaths', { paths: [at('link')] });
      expect(test.ports.shell.clipboard).toBe(at('link'));
      await call(test, windowId, 'files.showInExplorer', { path: at('link') });
      expect(test.ports.shell.shownInExplorer).toEqual([at('link')]);
      expect(await call(test, windowId, 'files.rename', { path: at('link'), newName: 'shared' })).toBe(at('shared'));
      expect(fs.lstatSync(at('shared')).isSymbolicLink()).toBe(true);
      await call(test, windowId, 'files.delete', { paths: [at('shared'), at('dead')] });

      // Der Papierkorb hat nur die Links genommen; das Ziel draussen ist unberührt.
      expect(test.ports.shell.trashed.map((t) => t.path)).toEqual([at('shared'), at('dead')]);
      expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('geheim');
      expect(operations(test, windowId).map((o) => o.kind)).toEqual(['renamed', 'deleted', 'deleted']);
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
      // Einmal in einem aufgeklappten, gelesenen Ordner, einmal in einem ungelesenen.
      await call(test, windowId, 'project.setExpandedFolders', { paths: [project, at('listed')] });
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

    it('erreicht auch Dienste im Kern, die die Ereignisse des Projekts abonnieren', async () => {
      const { test, windowId, project, at } = await openAlpha();
      await untilWatching(test, windowId, project);
      const core = test.core.projectCoreForWindow(windowId)!;
      const seen: string[] = [];
      core.subscribe('files.changed', (event) => seen.push(...event.changes.map((c) => `${c.kind} ${path.basename(c.path)}`)));
      core.subscribe('files.operation', (op) => seen.push(op.kind));

      await call(test, windowId, 'files.createDirectory', { parent: project, name: 'docs' });
      fs.writeFileSync(at('outside-change.txt'), '');
      await expect.poll(() => seen).toEqual(['created', 'created outside-change.txt']);
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
      // Im übergelaufenen Puffer kann auch ein Ereignis aus .git gewesen sein.
      expect(gitEvents(test, windowId)).toBeGreaterThanOrEqual(1);
    });

    it('meldet bei sehr vielen Pfaden alles in einem aufgeklappten Ordner, auch über ein Bündel hinaus', async () => {
      const { test, windowId, project, at } = await openAlpha({ 'busy/': '' });
      await call(test, windowId, 'project.setExpandedFolders', { paths: [project, at('busy')] });
      await call(test, windowId, 'files.list', { path: at('busy') });
      await untilWatching(test, windowId, project);

      // Viele Dateien in Etappen, mit kurzen Pausen: mehr Pfade, als ein Bündel einzeln prüft.
      for (let batch = 0; batch < 6; batch++) {
        for (let i = 0; i < 500; i++) fs.writeFileSync(at('busy', `f-${batch}-${i}.txt`), '');
        await sleep(20);
      }
      await expect.poll(() => changedEvents(test, windowId).some((e) => e.rescanned), { timeout: 10_000 }).toBe(true);
      await settle(test, windowId, project);
      const created = new Set(changes(test, windowId).filter((c) => c.kind === 'created').map((c) => c.path));
      expect([...created].filter((p) => p.startsWith(`${at('busy')}\\`)).length).toBe(3000);
    });

    it('lässt einen gelöschten Projektordner los und überwacht ihn wieder, sobald er zurück ist', async () => {
      const watchers = () => process.getActiveResourcesInfo().filter((r) => r === 'FSEventWrap').length;
      await sleep(50);
      const before = watchers();
      const { test, windowId, project, at } = await openAlpha({ 'a.txt': '' });
      await call(test, windowId, 'files.list', { path: project });
      await untilWatching(test, windowId, project);

      fs.rmSync(project, { recursive: true });
      await expect.poll(() => changedEvents(test, windowId).some((e) => e.rescanned)).toBe(true);
      expect(changes(test, windowId)).toContainEqual({ path: project, kind: 'deleted' });
      // Windows meldet einen gelöschten überwachten Ordner ohne Ende; die Überwachung hat ihn losgelassen.
      await expect.poll(() => watchers()).toBe(before);

      fs.mkdirSync(project);
      await untilWatching(test, windowId, project);
      fs.writeFileSync(at('back.txt'), '');
      await expect.poll(() => changes(test, windowId)).toContainEqual({ path: at('back.txt'), kind: 'created' });
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
