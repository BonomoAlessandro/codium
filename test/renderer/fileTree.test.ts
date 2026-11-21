// Reine Logik des Dateibaums und der Dateinamen, ohne DOM.

import { describe, expect, it } from 'vitest';
import { copyName, fileNameProblem, splitExtension, splitNewName } from '../../src/shared/fileNames';
import type { FileEntry } from '../../src/shared/types';
import { baseName, isSameOrInside, joinPath, movedPath, parentPath, pathKey, relativeLabel } from '../../src/renderer/project/filePaths';
import {
  followPaths,
  moveSubtree,
  parentRow,
  rangeKeys,
  selectionAfterDelete,
  treeKey,
  visibleRows,
  withoutSubtree,
  type Listing,
} from '../../src/renderer/project/fileTree';

const ROOT = 'C:\\Work\\Alpha';
const dir = (name: string, parent = ROOT): FileEntry => ({ name, path: `${parent}\\${name}`, isDirectory: true });
const file = (name: string, parent = ROOT): FileEntry => ({ name, path: `${parent}\\${name}`, isDirectory: false });

/** Alpha mit src (darin main mit App.java, dazu Util.java) und README.md; gelesen sind Alpha, src und main. */
function sample() {
  const listings = new Map<string, Listing>([
    [pathKey(ROOT), { path: ROOT, entries: [dir('src'), file('README.md')] }],
    [pathKey(`${ROOT}\\src`), { path: `${ROOT}\\src`, entries: [dir('main', `${ROOT}\\src`), file('Util.java', `${ROOT}\\src`)] }],
    [pathKey(`${ROOT}\\src\\main`), { path: `${ROOT}\\src\\main`, entries: [file('App.java', `${ROOT}\\src\\main`)] }],
  ]);
  const expanded = (...paths: string[]) => new Map(paths.map((p) => [pathKey(p), p]));
  return { listings, expanded };
}

describe('Sichtbare Zeilen des Dateibaums', () => {
  it('zeigt den Inhalt aufgeklappter, gelesener Ordner, eingerückt', () => {
    const { listings, expanded } = sample();
    const rows = visibleRows(ROOT, 'Alpha', listings, expanded(ROOT, `${ROOT}\\src`, `${ROOT}\\SRC\\main`));
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}${r.expanded ? '/' : ''}`)).toEqual([
      'Alpha/',
      '  src/',
      '    main/',
      '      App.java',
      '    Util.java',
      '  README.md',
    ]);
    expect(rows[0]).toMatchObject({ isRoot: true, path: ROOT, loading: false });
  });

  it('merkt sich aufgeklappte Ordner unter einem zugeklappten und zeigt einen ungelesenen als „lädt“', () => {
    const { listings, expanded } = sample();
    // src zu: main bleibt aufgeklappt, ist aber nicht sichtbar.
    expect(visibleRows(ROOT, 'Alpha', listings, expanded(ROOT, `${ROOT}\\src\\main`)).map((r) => r.name)).toEqual([
      'Alpha',
      'src',
      'README.md',
    ]);
    listings.delete(pathKey(`${ROOT}\\src`));
    const rows = visibleRows(ROOT, 'Alpha', listings, expanded(ROOT, `${ROOT}\\src`));
    expect(rows.find((r) => r.name === 'src')).toMatchObject({ expanded: true, loading: true });
  });

  it('zeigt einen gerade nicht lesbaren Ordner zugeklappt, ohne ihn aus den aufgeklappten zu nehmen', () => {
    const { listings, expanded } = sample();
    const rows = visibleRows(ROOT, 'Alpha', listings, expanded(ROOT, `${ROOT}\\src`), new Set([pathKey(`${ROOT}\\src`)]));
    expect(rows.find((r) => r.name === 'src')).toMatchObject({ expanded: false, loading: false, isDirectory: true });
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'src', 'README.md']);
  });

  it('klappt Links nach draussen und tote Links nicht auf', () => {
    const listings = new Map<string, Listing>([
      [
        pathKey(ROOT),
        {
          path: ROOT,
          entries: [
            { ...dir('shared'), blockedLink: 'outside' },
            { name: 'dead', path: `${ROOT}\\dead`, isDirectory: false, blockedLink: 'missing' },
          ],
        },
      ],
    ]);
    const rows = visibleRows(ROOT, 'Alpha', listings, new Map([[pathKey(ROOT), ROOT], [pathKey(`${ROOT}\\shared`), `${ROOT}\\shared`]]));
    expect(rows.slice(1)).toEqual([
      expect.objectContaining({ name: 'shared', isDirectory: false, expanded: false, loading: false, blockedLink: 'outside' }),
      expect.objectContaining({ name: 'dead', isDirectory: false, blockedLink: 'missing' }),
    ]);
    expect(treeKey('Enter', false, rows, 1, 10)).toEqual({ type: 'open', index: 1 });
    expect(treeKey('ArrowRight', false, rows, 1, 10)).toBeNull();
  });
});

describe('Tasten im Dateibaum', () => {
  const { listings, expanded } = sample();
  const rows = visibleRows(ROOT, 'Alpha', listings, expanded(ROOT, `${ROOT}\\src`));
  // Alpha, src, main, Util.java, README.md
  const at = (name: string) => rows.findIndex((r) => r.name === name);

  it('bewegt mit Pfeilen, Pos1, Ende und Bild-Tasten; Shift erweitert', () => {
    expect(treeKey('ArrowDown', false, rows, at('src'), 10)).toEqual({ type: 'move', index: at('main'), extend: false });
    expect(treeKey('ArrowUp', true, rows, at('src'), 10)).toEqual({ type: 'move', index: 0, extend: true });
    expect(treeKey('ArrowUp', false, rows, 0, 10)).toEqual({ type: 'move', index: 0, extend: false });
    expect(treeKey('End', false, rows, 0, 10)).toEqual({ type: 'move', index: rows.length - 1, extend: false });
    expect(treeKey('Home', false, rows, 3, 10)).toEqual({ type: 'move', index: 0, extend: false });
    expect(treeKey('PageDown', false, rows, 0, 3)).toEqual({ type: 'move', index: 2, extend: false });
    expect(treeKey('PageUp', false, rows, 4, 3)).toEqual({ type: 'move', index: 2, extend: false });
    // Ohne aktuelle Zeile beginnt es oben (Ende: unten).
    expect(treeKey('ArrowDown', false, rows, -1, 10)).toEqual({ type: 'move', index: 0, extend: false });
    expect(treeKey('End', false, rows, -1, 10)).toEqual({ type: 'move', index: rows.length - 1, extend: false });
    expect(treeKey('Enter', false, rows, -1, 10)).toBeNull();
  });

  it('Pfeil rechts klappt auf bzw. geht zum ersten Eintrag, Pfeil links klappt zu bzw. geht zum Elternordner', () => {
    expect(treeKey('ArrowRight', false, rows, at('main'), 10)).toEqual({ type: 'expand', index: at('main') });
    expect(treeKey('ArrowRight', false, rows, at('src'), 10)).toEqual({ type: 'move', index: at('main'), extend: false });
    expect(treeKey('ArrowRight', false, rows, at('Util.java'), 10)).toBeNull();
    expect(treeKey('ArrowLeft', false, rows, at('src'), 10)).toEqual({ type: 'collapse', index: at('src') });
    expect(treeKey('ArrowLeft', false, rows, at('Util.java'), 10)).toEqual({ type: 'move', index: at('src'), extend: false });
    expect(treeKey('ArrowLeft', false, rows, at('main'), 10)).toEqual({ type: 'move', index: at('src'), extend: false });
    expect(parentRow(rows, at('README.md'))).toBe(0);
    expect(parentRow(rows, 0)).toBe(-1);
  });

  it('Enter öffnet eine Datei und klappt Ordner auf und zu', () => {
    expect(treeKey('Enter', false, rows, at('Util.java'), 10)).toEqual({ type: 'open', index: at('Util.java') });
    expect(treeKey('Enter', false, rows, at('main'), 10)).toEqual({ type: 'expand', index: at('main') });
    expect(treeKey('Enter', false, rows, at('src'), 10)).toEqual({ type: 'collapse', index: at('src') });
    expect(treeKey('a', false, rows, at('src'), 10)).toBeNull();
  });

  it('liefert Bereiche in beide Richtungen', () => {
    expect(rangeKeys(rows, at('README.md'), at('main'))).toEqual([rows[at('main')].key, rows[at('Util.java')].key, rows[at('README.md')].key]);
  });
});

describe('Auswahl und aufgeklappte Ordner bei Löschen und Umbenennen', () => {
  const { listings, expanded } = sample();
  const rows = visibleRows(ROOT, 'Alpha', listings, expanded(ROOT, `${ROOT}\\src`, `${ROOT}\\src\\main`));

  it('wählt nach dem Löschen den nächsten Eintrag, sonst den vorherigen', () => {
    expect(selectionAfterDelete(rows, [`${ROOT}\\src\\main`])).toBe(`${ROOT}\\src\\Util.java`);
    expect(selectionAfterDelete(rows, [`${ROOT}\\README.md`])).toBe(`${ROOT}\\src\\Util.java`);
    expect(selectionAfterDelete(rows, [`${ROOT}\\src`, `${ROOT}\\README.md`])).toBe(ROOT);
    expect(selectionAfterDelete(rows, [])).toBeNull();
  });

  it('vergisst einen gelöschten Ordner samt Inhalt und lässt Namensvettern stehen', () => {
    const map = new Map([
      [pathKey(`${ROOT}\\src`), 1],
      [pathKey(`${ROOT}\\src\\main`), 2],
      [pathKey(`${ROOT}\\src2`), 3],
    ]);
    expect([...withoutSubtree(map, `${ROOT}\\SRC`).keys()]).toEqual([pathKey(`${ROOT}\\src2`)]);
    // Den Projektordner behält er, wenn verlangt.
    expect([...withoutSubtree(new Map([[pathKey(ROOT), 0], ...map]), ROOT, pathKey(ROOT)).keys()]).toEqual([pathKey(ROOT)]);
  });

  it('führt kopierte Pfade bei Umbenennen und Löschen nach', () => {
    const copied = [`${ROOT}\\src\\a.ts`, `${ROOT}\\README.md`, `${ROOT}\\src2\\b.ts`];
    expect(followPaths(copied, { from: `${ROOT}\\src`, to: `${ROOT}\\lib` })).toEqual([`${ROOT}\\lib\\a.ts`, `${ROOT}\\README.md`, `${ROOT}\\src2\\b.ts`]);
    expect(followPaths(copied, { deleted: `${ROOT}\\SRC` })).toEqual([`${ROOT}\\README.md`, `${ROOT}\\src2\\b.ts`]);
  });

  it('lässt beim Umbenennen eines Ordners alles darunter mitwandern', () => {
    const map = new Map([
      [pathKey(`${ROOT}\\src`), `${ROOT}\\src`],
      [pathKey(`${ROOT}\\src\\Main`), `${ROOT}\\src\\Main`],
      [pathKey(ROOT), ROOT],
    ]);
    const moved = moveSubtree(map, `${ROOT}\\src`, `${ROOT}\\Source`, (p, relocate) => relocate(p));
    expect([...moved.entries()]).toEqual([
      [pathKey(`${ROOT}\\Source`), `${ROOT}\\Source`],
      [pathKey(`${ROOT}\\Source\\Main`), `${ROOT}\\Source\\Main`],
      [pathKey(ROOT), ROOT],
    ]);
  });
});

describe('Pfade in der Oberfläche', () => {
  it('vergleicht ohne Gross-/Kleinschreibung und nur an Ordnergrenzen', () => {
    expect(isSameOrInside('c:\\work\\alpha\\SRC\\a.ts', ROOT)).toBe(true);
    expect(isSameOrInside(ROOT, 'C:\\WORK\\ALPHA')).toBe(true);
    expect(isSameOrInside('C:\\Work\\Alpha2', ROOT)).toBe(false);
    expect(isSameOrInside('C:\\x', 'C:\\')).toBe(true);
  });

  it('zerlegt und setzt Pfade zusammen', () => {
    expect(parentPath(`${ROOT}\\src`)).toBe(ROOT);
    expect(parentPath('C:\\Work')).toBe('C:\\');
    expect(baseName(`${ROOT}\\src\\App.java`)).toBe('App.java');
    expect(joinPath('C:\\', 'a', 'b')).toBe('C:\\a\\b');
    expect(relativeLabel(ROOT, `${ROOT}\\src\\App.java`)).toBe('src/App.java');
    expect(relativeLabel(ROOT, ROOT)).toBe('Alpha');
    expect(movedPath(`${ROOT}\\src\\a.ts`, `${ROOT}\\src`, `${ROOT}\\lib`)).toBe(`${ROOT}\\lib\\a.ts`);
  });
});

describe('Dateinamen unter Windows', () => {
  it('lehnt unerlaubte Namen mit einer englischen Meldung ab', () => {
    for (const name of ['Main.java', '.gitignore', 'a b.txt', 'résumé.md', 'con1', 'console.log']) expect(fileNameProblem(name), name).toBeNull();
    for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?', 'a"b', 'a<b', 'a>b', 'a|b', 'x\u0001', 'end.', 'end ', 'CON', 'nul.txt', 'COM1', 'lpt9.log', 'x'.repeat(256)]) {
      expect(fileNameProblem(name), JSON.stringify(name)).toMatch(/^[A-Z“]/);
    }
  });

  it('liest neue Namen mit Unterordnern wie IntelliJ', () => {
    expect(splitNewName('src/main/App.java')).toEqual({ segments: ['src', 'main', 'App.java'] });
    expect(splitNewName('a\\b')).toEqual({ segments: ['a', 'b'] });
    expect(splitNewName('')).toEqual({ problem: 'Enter a name.' });
    expect(splitNewName('a//b')).toEqual({ problem: 'A name cannot be empty.' });
    expect(splitNewName('a/../b')).toMatchObject({ problem: expect.stringContaining('not a valid name') });
    expect(splitNewName('sub/.GIT/x')).toEqual({ problem: 'Codium does not change the Git folder (.git).' });
  });

  it('trennt die Endung ab, ausser bei Ordnern und Punktdateien', () => {
    expect(splitExtension('Main.java', false)).toEqual({ base: 'Main', extension: '.java' });
    expect(splitExtension('archive.tar.gz', false)).toEqual({ base: 'archive.tar', extension: '.gz' });
    expect(splitExtension('.gitignore', false)).toEqual({ base: '.gitignore', extension: '' });
    expect(splitExtension('v1.2', true)).toEqual({ base: 'v1.2', extension: '' });
  });

  it('schlägt für eine Kopie den ersten freien Namen mit Zusatz vor', () => {
    const taken = (...names: string[]) => (candidate: string) => names.map((n) => n.toLowerCase()).includes(candidate.toLowerCase());
    expect(copyName('Main.java', false, taken())).toBe('Main.java');
    expect(copyName('Main.java', false, taken('main.JAVA'))).toBe('Main (2).java');
    expect(copyName('Main.java', false, taken('Main.java', 'Main (2).java'))).toBe('Main (3).java');
    expect(copyName('Main (2).java', false, taken('Main (2).java'))).toBe('Main (3).java');
    expect(copyName('src', true, taken('src'))).toBe('src (2)');
    expect(copyName('.env', false, taken('.env'))).toBe('.env (2)');
  });
});
