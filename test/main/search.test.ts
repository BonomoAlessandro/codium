// Teststelle 1: Suche nach Namen, Projektsuche und zuletzt geöffnete Dateien am Vertrag, mit echtem ripgrep und echtem
// Dateisystem in Temp-Ordnern.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rankFiles } from '../../src/main/core/fuzzyMatch';
import {
  SEARCH_MATCH_LIMIT,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type Events,
  type SearchMatch,
  type SearchOptions,
} from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Suche', () => {
  const tempDir = useTempDirs();

  async function openProject(files: Record<string, string>, options: { git?: boolean } = {}) {
    const root = tempDir();
    const project = path.join(root, 'Alpha');
    fs.mkdirSync(project);
    // Ein Ordner .git wie in einem Repository (ripgrep beachtet .gitignore auch ohne, .git muss trotzdem fehlen).
    if (options.git) {
      fs.mkdirSync(path.join(project, '.git'));
      fs.writeFileSync(path.join(project, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(project, '.git', 'config'), '[core]\n');
    }
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
      fs.writeFileSync(path.join(project, relative), content);
    }
    const test = createTestCore(path.join(root, 'data'));
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(title('Alpha'));
    return { project, test, windowId, at: (...parts: string[]) => path.join(project, ...parts) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function names(test: TestCore, windowId: number, query: string, includeIgnored = false): Promise<string[]> {
    return (await call(test, windowId, 'files.findByName', { query, includeIgnored })).matches.map((m) => m.relative);
  }

  /** Startet eine Projektsuche und wartet auf ihr Ende. */
  async function search(test: TestCore, windowId: number, options: Partial<SearchOptions> & { query: string }) {
    const { searchId } = await call(test, windowId, 'search.start', {
      matchCase: false,
      wholeWord: false,
      regex: false,
      fileMask: '',
      includeIgnored: false,
      ...options,
    });
    const events = () =>
      test.events
        .forWindow(windowId)
        .filter((e) => e.name === 'search.results')
        .map((e) => e.payload as Events['search.results'])
        .filter((e) => e.searchId === searchId);
    await expect.poll(() => events().some((e) => e.done), { timeout: 10_000 }).toBe(true);
    const all = events();
    const done = all.find((e) => e.done)!;
    return { matches: all.flatMap((e) => e.matches), limitReached: done.limitReached === true, error: done.error, searchId };
  }

  const where = (matches: SearchMatch[], root: string) =>
    matches.map((m) => `${path.relative(root, m.path).replaceAll('\\', '/')}:${m.line}:${m.column}`).sort();

  describe('Suche nach Namen', () => {
    it('vergleicht unscharf und bevorzugt Wortanfänge und CamelCase', async () => {
      const { test, windowId } = await openProject({
        'src/UserService.java': '',
        'docs/users_overview.txt': '',
        'src/Unrelated.java': '',
      });
      expect(await names(test, windowId, 'UsrSrv')).toEqual(['src/UserService.java', 'docs/users_overview.txt']);
      expect(await names(test, windowId, 'us')).toContain('src/UserService.java');
      // Mit „/“ zählt der Pfad.
      expect(await names(test, windowId, 'docs/over')).toEqual(['docs/users_overview.txt']);
    });

    it('lässt ignorierte Dateien ohne Schalter weg, zeigt versteckte, aber nie .git', async () => {
      const { test, windowId } = await openProject(
        {
          '.gitignore': 'target/\n*.log\n',
          'target/Build.class': '',
          'app.log': '',
          '.github/workflow.yml': '',
          'src/App.java': '',
        },
        { git: true },
      );
      expect(await names(test, windowId, 'workflow')).toEqual(['.github/workflow.yml']);
      expect(await names(test, windowId, 'Build')).toEqual([]);
      expect(await names(test, windowId, 'app.log')).toEqual([]);
      const withIgnored = await call(test, windowId, 'files.findByName', { query: 'Build', includeIgnored: true });
      expect(withIgnored.matches).toMatchObject([{ relative: 'target/Build.class', ignored: true }]);
      expect(await names(test, windowId, 'HEAD', true)).toEqual([]);
      expect(await names(test, windowId, 'config', true)).toEqual([]);
    });

    it('beachtet .gitignore auch ohne Git-Repository', async () => {
      const { test, windowId } = await openProject({ '.gitignore': 'node_modules/\n', 'node_modules/lib/index.js': '', 'index.js': '' });
      expect(await names(test, windowId, 'index')).toEqual(['index.js']);
      expect(await names(test, windowId, 'index', true)).toEqual(['index.js', 'node_modules/lib/index.js']);
    });

    it('findet eine neu angelegte Datei nach dem Dateiereignis', async () => {
      const { test, windowId, at } = await openProject({ 'a.txt': '' });
      expect(await names(test, windowId, 'Fresh')).toEqual([]);
      fs.writeFileSync(at('FreshFile.ts'), '');
      await expect.poll(() => names(test, windowId, 'Fresh'), { timeout: 10_000 }).toEqual(['FreshFile.ts']);
      // Auch eine in Codium angelegte.
      await call(test, windowId, 'files.createFile', { parent: at(), name: 'Other/Created.md' });
      expect(await names(test, windowId, 'Created')).toEqual(['Other/Created.md']);
    });
  });

  describe('Projektsuche', () => {
    it('sucht mit jedem Schalter', async () => {
      const { test, windowId, project } = await openProject(
        {
          '.gitignore': 'build/\n',
          'src/A.java': 'class Foo {}\nfoo();\nfoobar();\n',
          'src/B.ts': 'const FOO = 1;\n',
          'build/C.java': 'foo\n',
          '.config/hidden.txt': 'foo hidden\n',
          '.git/should-not.txt': 'foo\n',
        },
        { git: true },
      );
      // Ohne Schalter: ohne Gross-/Kleinschreibung, Teilwörter, versteckte Dateien, ohne Ignoriertes und .git.
      expect(where((await search(test, windowId, { query: 'foo' })).matches, project)).toEqual(
        ['.config/hidden.txt:1:1', 'src/A.java:1:7', 'src/A.java:2:1', 'src/A.java:3:1', 'src/B.ts:1:7'].sort(),
      );
      expect(where((await search(test, windowId, { query: 'foo', matchCase: true })).matches, project)).toEqual(
        ['.config/hidden.txt:1:1', 'src/A.java:2:1', 'src/A.java:3:1'].sort(),
      );
      expect(where((await search(test, windowId, { query: 'foo', wholeWord: true })).matches, project)).toEqual(
        ['.config/hidden.txt:1:1', 'src/A.java:1:7', 'src/A.java:2:1', 'src/B.ts:1:7'].sort(),
      );
      expect(where((await search(test, windowId, { query: 'fo+bar', regex: true })).matches, project)).toEqual(['src/A.java:3:1']);
      // Ohne Regex ist „fo+bar“ wörtlich gemeint.
      expect((await search(test, windowId, { query: 'fo+bar' })).matches).toEqual([]);
      expect(where((await search(test, windowId, { query: 'foo', fileMask: '*.ts' })).matches, project)).toEqual(['src/B.ts:1:7']);
      expect(where((await search(test, windowId, { query: 'foo', fileMask: '*.java, !A.java' })).matches, project)).toEqual([]);
      expect(where((await search(test, windowId, { query: 'foo', includeIgnored: true, fileMask: '*.java' })).matches, project)).toEqual(
        ['build/C.java:1:1', 'src/A.java:1:7', 'src/A.java:2:1', 'src/A.java:3:1'].sort(),
      );
      // Ein ungültiger regulärer Ausdruck meldet einen Fehler.
      const invalid = await search(test, windowId, { query: 'foo(', regex: true });
      expect(invalid.error).toBeTruthy();
    });

    it('liefert Zeile, Spalte und Länge wie im Editor, auch nach Umlauten', async () => {
      const { test, windowId, at } = await openProject({ 'a.txt': 'Grüsse äöü Ziel hier\n' });
      const { matches } = await search(test, windowId, { query: 'Ziel' });
      expect(matches).toEqual([{ path: at('a.txt'), line: 1, column: 12, length: 4, lineText: 'Grüsse äöü Ziel hier', lineOffset: 0 }]);
    });

    it('beachtet .gitignore auch ohne Git-Repository', async () => {
      const { test, windowId, project } = await openProject({ '.gitignore': 'out/\n', 'out/x.txt': 'needle\n', 'y.txt': 'needle\n' });
      expect(where((await search(test, windowId, { query: 'needle' })).matches, project)).toEqual(['y.txt:1:1']);
      expect(where((await search(test, windowId, { query: 'needle', includeIgnored: true })).matches, project)).toEqual(
        ['out/x.txt:1:1', 'y.txt:1:1'].sort(),
      );
    });

    it(`bricht nach ${SEARCH_MATCH_LIMIT} Treffern ab und meldet „mehr“; eine neue Suche bricht die laufende ab`, async () => {
      const many = Array.from({ length: 400 }, () => 'hit hit hit').join('\n');
      const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.txt`, many]));
      const { test, windowId } = await openProject(files);
      const result = await search(test, windowId, { query: 'hit' });
      expect(result.matches).toHaveLength(SEARCH_MATCH_LIMIT);
      expect(result.limitReached).toBe(true);
      const small = await search(test, windowId, { query: 'hit', fileMask: 'f0.txt' });
      expect(small.matches).toHaveLength(1200);
      expect(small.limitReached).toBe(false);

      // Eine neue Suche bricht die laufende ab: Von der ersten kommt danach nichts mehr.
      const first = await call(test, windowId, 'search.start', { query: 'hit', matchCase: false, wholeWord: false, regex: false, fileMask: '', includeIgnored: false });
      const second = await search(test, windowId, { query: 'nothing-matches-this' });
      expect(second.matches).toEqual([]);
      const before = test.events.sent.filter((e) => e.name === 'search.results' && (e.payload as Events['search.results']).searchId === first.searchId).length;
      await sleep(300);
      const after = test.events.sent.filter((e) => e.name === 'search.results' && (e.payload as Events['search.results']).searchId === first.searchId).length;
      expect(after).toBe(before);
    });
  });

  describe('Befunde aus dem Review von Ticket 08', () => {
    it('rechnet eine minifizierte Zeile mit Zehntausenden Treffern schnell um und hält am Limit', async () => {
      const { test, windowId } = await openProject({ 'bundle.min.js': 'return a;'.repeat(120_000) });
      const started = Date.now();
      const result = await search(test, windowId, { query: 'return' });
      expect(result.matches).toHaveLength(SEARCH_MATCH_LIMIT);
      expect(result.limitReached).toBe(true);
      expect(result.matches[1]).toMatchObject({ line: 1, column: 10, length: 6 });
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('findet Treffer in Windows-1252-Zeilen, mit Spalten wie im Editor', async () => {
      const root = tempDir();
      const project = path.join(root, 'Alpha');
      fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, 'cp1252.txt'), Buffer.from([0x47, 0x72, 0xfc, 0x73, 0x73, 0x65, 0x20, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x0a]));
      const test = createTestCore(path.join(root, 'data'));
      await test.core.start();
      await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
      const windowId = test.ports.windows.windowTitled(title('Alpha'));
      const { matches } = await search(test, windowId, { query: 'needle' });
      expect(matches).toMatchObject([{ line: 1, column: 8, length: 6, lineText: 'Grüsse needle' }]);
    });

    it('durchsucht .git nie, auch nicht mit einer Maske wie „*“; Masken ohne Gross-/Kleinschreibung', async () => {
      const { test, windowId, project } = await openProject({ 'A.java': 'needle\n' }, { git: true });
      fs.writeFileSync(path.join(project, '.git', 'needle.txt'), 'needle\n');
      for (const fileMask of ['*', '**']) {
        expect(where((await search(test, windowId, { query: 'needle', fileMask })).matches, project), fileMask).toEqual(['A.java:1:1']);
      }
      // „.*“ meint versteckte Dateien; .git gehört nicht dazu.
      expect(where((await search(test, windowId, { query: 'needle', fileMask: '.*' })).matches, project)).toEqual([]);
      expect(where((await search(test, windowId, { query: 'ref', fileMask: '*', includeIgnored: true })).matches, project)).toEqual([]);
      expect(where((await search(test, windowId, { query: 'needle', fileMask: '*.JAVA' })).matches, project)).toEqual(['A.java:1:1']);
    });

    it('lässt .gitignore über einem Projekt ohne Repository aus, wie Git', async () => {
      const root = tempDir();
      fs.writeFileSync(path.join(root, '.gitignore'), '*.txt\n');
      const project = path.join(root, 'Alpha');
      fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, 'notes.txt'), 'needle\n');
      const test = createTestCore(path.join(root, 'data'));
      await test.core.start();
      await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
      const windowId = test.ports.windows.windowTitled(title('Alpha'));
      expect(await names(test, windowId, 'notes')).toEqual(['notes.txt']);
      expect((await search(test, windowId, { query: 'needle' })).matches).toHaveLength(1);
    });

    it('meldet bei einem ungültigen regulären Ausdruck die Ursache', async () => {
      const { test, windowId } = await openProject({ 'a.txt': 'x\n' });
      const { error } = await search(test, windowId, { query: 'foo(', regex: true });
      expect(error).toMatch(/^regex parse error: .*unclosed group/i);
    });

    it('bricht eine laufende Suche wirklich ab, wenn eine neue beginnt', async () => {
      // Viele grosse Dateien ohne Treffer: Eine volle Suche dauert spürbar.
      const block = `${'lorem ipsum dolor sit amet '.repeat(40)}\n`.repeat(4000);
      const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`big${i}.txt`, block]));
      const { test, windowId } = await openProject(files);
      const fullStart = Date.now();
      await search(test, windowId, { query: 'q[0-9]{7}z', regex: true });
      const full = Date.now() - fullStart;

      const first = await call(test, windowId, 'search.start', { query: 'q[0-9]{7}z', regex: true, matchCase: false, wholeWord: false, fileMask: '', includeIgnored: false });
      const cancelAt = Date.now();
      await search(test, windowId, { query: 'nothing', fileMask: 'none.xyz' });
      const doneOfFirst = () =>
        test.events.sent.some((e) => e.name === 'search.results' && (e.payload as Events['search.results']).searchId === first.searchId && (e.payload as Events['search.results']).done);
      await expect.poll(doneOfFirst, { timeout: 10_000 }).toBe(true);
      // Die abgebrochene Suche endet weit vor der Dauer einer vollen.
      expect(Date.now() - cancelAt).toBeLessThan(Math.max(300, full / 2));
    });
  });

  describe('Zuletzt geöffnete Dateien', () => {
    it('überstehen einen Neustart, neueste zuerst, ohne Doppelte und ohne gelöschte', async () => {
      const { test: first, windowId: firstWindow, at } = await openProject({ 'a.txt': '', 'b.txt': '', 'c.txt': '' });
      for (const name of ['a.txt', 'b.txt', 'c.txt', 'A.TXT']) await call(first, firstWindow, 'project.addRecentFile', { path: at(name) });
      expect(await call(first, firstWindow, 'project.recentFiles')).toEqual([at('A.TXT'), at('c.txt'), at('b.txt')]);
      fs.rmSync(at('b.txt'));
      const test = await restart(first);
      await test.core.start();
      const windowId = test.ports.windows.windowTitled(title('Alpha'));
      expect(await call(test, windowId, 'project.recentFiles')).toEqual([at('A.TXT'), at('c.txt')]);
      // Umbenennen in Codium: der Eintrag folgt.
      await call(test, windowId, 'files.rename', { path: at('c.txt'), newName: 'd.txt' });
      expect(await call(test, windowId, 'project.recentFiles')).toEqual([at('A.TXT'), at('d.txt')]);
    });
  });
});

describe('Unscharfer Vergleich', () => {
  it('trifft Buchstaben in Reihenfolge und bewertet Wortanfänge höher', () => {
    expect(fuzzyMatch('usv', 'UserService')).not.toBeNull();
    expect(fuzzyMatch('vsu', 'UserService')).toBeNull();
    expect(fuzzyMatch('US', 'UserService')!.positions).toEqual([0, 4]);
    const camel = fuzzyMatch('us', 'UserService')!.score;
    const plain = fuzzyMatch('us', 'business')!.score;
    expect(camel).toBeGreaterThan(plain);
    expect(rankFiles('fb', [{ relative: 'a/foobar.txt' }, { relative: 'FooBar.java' }], 10).map((f) => f.relative)).toEqual([
      'FooBar.java',
      'a/foobar.txt',
    ]);
  });

  it('stellt einen Präfix vor verstreute CamelCase-Treffer, wie IntelliJ (Review von Ticket 08)', () => {
    const rank = (query: string, names: string[]) => rankFiles(query, names.map((relative) => ({ relative })), 10).map((f) => f.relative);
    expect(rank('app', ['ApiPathParser.ts', 'AppPanelPresenter.ts', 'app.ts'])[0]).toBe('app.ts');
    expect(rank('ind', ['isNaN.d.ts', 'index.js'])[0]).toBe('index.js');
    expect(rank('date', ['DataTypeEditor.ts', 'date.ts'])[0]).toBe('date.ts');
  });

  it('bewertet 100 000 Pfade schnell genug für jeden Tastendruck', () => {
    const files = Array.from({ length: 100_000 }, (_, i) => ({ relative: `src/module${i % 300}/feature${i % 97}/Component${i}Service.ts` }));
    for (const query of ['u', 'us', 'UsrSrv', 'compserv']) {
      const started = performance.now();
      rankFiles(query, files, 100);
      expect(performance.now() - started, query).toBeLessThan(1500);
    }
  });
});

