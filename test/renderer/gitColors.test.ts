// Git-Farben (Tickets 16 und 29): welcher Zustand für eine Datei oder einen Ordner gilt, und dass die Farben als
// Design-Variablen in tokens.css stehen, mit den Werten des neuen IntelliJ-Designs „Dark“. Wie es in der App aussieht,
// prüfen die Oberflächentests (commit.test.ts, editor.test.ts).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GitFileStatus, GitState } from '../../src/shared/types';
import { changeKind, gitStatusLookup, type ChangeKind } from '../../src/renderer/git/fileStatus';

const ROOT = 'C:\\Work\\Shop';
const at = (relative: string) => `${ROOT}\\${relative.replaceAll('/', '\\')}`;
const STYLES = path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles');

function state(parts: Partial<GitState>): GitState {
  return { repository: true, root: ROOT, branch: 'main', ahead: 0, behind: 0, files: [], ...parts };
}

const untracked = (relative: string): GitFileStatus => ({ path: at(relative), index: '?', worktree: '?' });

describe('Git-Zustand von Ordnern (Ticket 29)', () => {
  it('ein Ordner mit nur nicht versionierten Dateien ist „nicht versioniert“, samt Unterordnern und Dateien', () => {
    // So meldet der Git-Dienst einen Ordner ohne versionierte Dateien: als Ganzes, die Dateien darin einzeln.
    const lookup = gitStatusLookup(state({ untrackedDirs: [at('drafts')], files: [untracked('drafts/ideas.md'), untracked('drafts/old/notes.txt')] }));
    expect(lookup(at('drafts'))).toBe('unversioned');
    expect(lookup(at('Drafts/OLD'))).toBe('unversioned');
    expect(lookup(at('drafts/ideas.md'))).toBe('unversioned');
    expect(lookup(at('drafts/old/notes.txt'))).toBe('unversioned');
    // Namensvettern und der Projektordner nicht.
    expect(lookup(at('drafts2'))).toBeUndefined();
    expect(lookup(ROOT)).toBeUndefined();
  });

  it('ein Ordner mit versionierten und nicht versionierten Dateien bleibt ohne Farbe', () => {
    // Git nennt nur die neue Datei, nicht den Ordner (er enthält versionierte Dateien).
    const lookup = gitStatusLookup(state({ files: [untracked('src/Draft.java'), { path: at('src/Cart.java'), index: '.', worktree: 'M' }] }));
    expect(lookup(at('src'))).toBeUndefined();
    expect(lookup(at('src/Draft.java'))).toBe('unversioned');
    expect(lookup(at('src/Cart.java'))).toBe('modified');
    expect(lookup(at('src/Price.java'))).toBeUndefined();
  });

  it('ein ignorierter Ordner ist „ignoriert“, samt allem darin; ein Ordner mit nur ignorierten Dateien bleibt ohne Farbe', () => {
    const lookup = gitStatusLookup(state({ ignored: [{ path: at('node_modules'), directory: true }, { path: at('logs/server.log') }] }));
    expect(lookup(at('node_modules'))).toBe('ignored');
    expect(lookup(at('node_modules/left-pad/index.js'))).toBe('ignored');
    expect(lookup(at('logs/server.log'))).toBe('ignored');
    expect(lookup(at('logs'))).toBeUndefined();
  });

  it('der nächste Ordner entscheidet: ein ignorierter Ordner in einem nicht versionierten und umgekehrt', () => {
    const lookup = gitStatusLookup(
      state({
        untrackedDirs: [at('drafts'), at('target/generated')],
        ignored: [{ path: at('drafts/build'), directory: true }, { path: at('target'), directory: true }, { path: at('drafts/x.log') }],
        files: [untracked('drafts/a.md')],
      }),
    );
    expect(lookup(at('drafts/build'))).toBe('ignored');
    expect(lookup(at('drafts/build/out/a.class'))).toBe('ignored');
    expect(lookup(at('drafts/x.log'))).toBe('ignored');
    expect(lookup(at('drafts/sub'))).toBe('unversioned');
    expect(lookup(at('target/generated/x'))).toBe('unversioned');
    expect(lookup(at('target/classes'))).toBe('ignored');
  });

  it('ohne Zustand gibt es keine Farbe; bei zwei Einträgen derselben Datei gilt der versionierte', () => {
    expect(gitStatusLookup(null)(at('a.txt'))).toBeUndefined();
    const lookup = gitStatusLookup(state({ files: [untracked('a.txt'), { path: at('a.txt'), index: 'D', worktree: '.' }] }));
    expect(lookup(at('a.txt'))).toBe('deleted');
  });

  it('ordnet Git-Einträge den Zuständen zu', () => {
    const kinds: Array<[GitFileStatus, ChangeKind]> = [
      [{ path: at('a'), index: 'U', worktree: 'U', conflict: true }, 'conflict'],
      [untracked('b'), 'unversioned'],
      [{ path: at('c'), index: 'R', worktree: '.', origPath: at('c0') }, 'renamed'],
      [{ path: at('d'), index: 'A', worktree: '.' }, 'added'],
      [{ path: at('e'), index: '.', worktree: 'D' }, 'deleted'],
      [{ path: at('f'), index: 'M', worktree: 'M' }, 'modified'],
    ];
    for (const [file, kind] of kinds) expect(changeKind(file)).toBe(kind);
  });
});

describe('Git-Farben als Design-Variablen (Ticket 29)', () => {
  const tokens = fs.readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  const app = fs.readFileSync(path.join(STYLES, 'app.css'), 'utf8');
  const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();

  it('tokens.css hat die Werte von IntelliJ „Dark“ (freigegeben vom Nutzer)', () => {
    expect({
      modified: token('git-modified'),
      renamed: token('git-renamed'),
      added: token('git-added'),
      deleted: token('git-deleted'),
      unversioned: token('git-unversioned'),
      ignored: token('git-ignored'),
      conflict: token('git-conflict'),
    }).toEqual({
      modified: '#70aeff',
      renamed: 'var(--git-modified)',
      added: '#73bd79',
      deleted: '#6f737a',
      unversioned: '#e88f89',
      ignored: '#d69a6b',
      conflict: '#de6a66',
    });
  });

  it('app.css färbt jeden Zustand nur über seine Variable und hat keine fest eingetragenen Git-Farben', () => {
    const kinds: ChangeKind[] = ['modified', 'renamed', 'added', 'deleted', 'unversioned', 'ignored', 'conflict'];
    const css = app.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const kind of kinds) {
      const rules = [...css.matchAll(new RegExp(`([^{}]*\\.git-${kind}\\b[^{}]*)\\{([^}]*)\\}`, 'g'))];
      expect(rules.length, kind).toBeGreaterThan(0);
      for (const [, , body] of rules) expect(body.trim(), kind).toBe(`color: var(--git-${kind});`);
    }
    // Die früheren Werte (Darcula) kommen in app.css nicht mehr vor.
    for (const old of ['#6897bb', '#629755', '#d1675a']) expect(app.toLowerCase()).not.toContain(old);
  });
});
