// Zeilen des Branch-Dropdowns (Ticket 31): Präfixe als Ordner wie in IntelliJ, „Recent“, Filter; reine Logik ohne DOM.

import { describe, expect, it } from 'vitest';
import {
  branchRows,
  collapseFolder,
  expandFolder,
  filterFolders,
  parentRow,
  withCurrentBranchOpen,
  type BranchListRow,
} from '../../src/renderer/git/branchRows';
import type { GitBranches } from '../../src/shared/types';

function branches(local: string[], remote: string[] = [], recent: string[] = [], current = 'main'): GitBranches {
  return {
    local: local.map((name) => ({ name, current: name === current })),
    remote: remote.map((name) => ({ name, remote: name.split('/')[0] })),
    recent,
  };
}

/**
 * Zeilen als Text: zwei Leerzeichen je Ebene, Ordner mit ▸ (zu) bzw. ▾ (offen), ein Branch in einem Ordner unter dem
 * Namen des Ordners, Überschriften in eckigen Klammern.
 */
function show(rows: readonly BranchListRow[]): string[] {
  return rows.map((r) => {
    if (r.kind === 'header') return `[${r.label}]`;
    if (r.kind === 'folder') return `${'  '.repeat(r.level)}${r.expanded ? '▾' : '▸'} ${r.name}`;
    return `${'  '.repeat(r.level)}${r.level > 0 ? '  ' : ''}${r.label}`;
  });
}

const open = (...keys: string[]) => new Set(keys);

describe('Zeilen des Branch-Dropdowns', () => {
  it('macht Präfixe zu Ordnern, auch verschachtelt; Branches ohne „/“ stehen direkt unter „Local“', () => {
    const b = branches(['main', 'feature/login', 'feature/logout', 'feature/team-a/x', 'develop', 'bugfix/c']);
    const rows = branchRows(b, '', open('local:feature', 'local:feature/team-a'));
    expect(show(rows)).toEqual(['[Local]', '▸ bugfix', '▾ feature', '  ▾ team-a', '      x', '    login', '    logout', 'develop', 'main']);

    // Die Zeile im Ordner zeigt den Namen ohne Präfix; der Branch selbst trägt den vollen Namen.
    const x = rows.find((r) => r.kind === 'local' && r.label === 'x');
    expect(x).toMatchObject({ kind: 'local', section: 'local', level: 2, branch: { name: 'feature/team-a/x', current: false } });
    expect(rows.find((r) => r.kind === 'folder' && r.name === 'team-a')).toMatchObject({ key: 'local:feature/team-a', path: 'feature/team-a', level: 1 });
    // Zugeklappt: nur der Ordner, sein Inhalt fehlt.
    expect(show(branchRows(b, '', open()))).toEqual(['[Local]', '▸ bugfix', '▸ feature', 'develop', 'main']);
  });

  it('stellt Remote-Branches unter ihr Remote, darunter die Ordner der Präfixe, auch bei nur einem Remote', () => {
    const b = branches(['main'], ['origin/main', 'origin/feature/a', 'upstream/main']);
    expect(show(branchRows(b, '', open('remote:origin', 'remote:origin/feature')))).toEqual([
      '[Local]',
      'main',
      '[Remote]',
      '▾ origin',
      '  ▾ feature',
      '      a',
      '    main',
      '▸ upstream',
    ]);
    const rows = branchRows(branches(['main'], ['origin/main']), '', open('remote:origin'));
    expect(show(rows)).toEqual(['[Local]', 'main', '[Remote]', '▾ origin', '    main']);
    // Untermenü, Checkout und Tooltip arbeiten mit dem vollen Namen.
    expect(rows.at(-1)).toMatchObject({ kind: 'remote', name: 'origin/main', label: 'main', level: 1 });
  });

  it('ordnet Ordner vor Branches, beides alphabetisch ohne Rücksicht auf Gross und Klein, Zahlen nach ihrem Wert', () => {
    const b = branches(['Zeta', 'alpha', 'release/1.10', 'release/1.9', 'release/1.2', 'Beta/x', 'main', 'hotfix/b', 'hotfix/A']);
    expect(show(branchRows(b, '', open('local:release', 'local:hotfix')))).toEqual([
      '[Local]',
      '▸ Beta',
      '▾ hotfix',
      '    A',
      '    b',
      '▾ release',
      '    1.2',
      '    1.9',
      '    1.10',
      'alpha',
      'main',
      'Zeta',
    ]);
  });

  it('öffnet beim Öffnen des Dropdowns die Ordner des aktuellen Branches, zusätzlich zu den gemerkten', () => {
    const b = branches(['main', 'feature/team-a/x', 'feature/y', 'bugfix/c'], [], [], 'feature/team-a/x');
    const shown = withCurrentBranchOpen(open('local:bugfix'), 'feature/team-a/x');
    expect([...shown].sort()).toEqual(['local:bugfix', 'local:feature', 'local:feature/team-a']);
    expect(show(branchRows(b, '', shown))).toEqual(['[Local]', '▾ bugfix', '    c', '▾ feature', '  ▾ team-a', '      x', '    y', 'main']);
    // Ohne Präfix, bei losgelöstem HEAD: nichts dazu, und der gemerkte Zustand bleibt unverändert.
    const remembered = open('local:bugfix');
    expect(withCurrentBranchOpen(remembered, 'main')).toBe(remembered);
    expect(withCurrentBranchOpen(remembered, null)).toBe(remembered);
    expect([...remembered]).toEqual(['local:bugfix']);
  });

  it('öffnet beim Filtern alle Ordner mit Treffern, zeigt nur die Treffer und blendet die übrigen Ordner aus', () => {
    const b = branches(['main', 'feature/login', 'feature/logout', 'feature/team-a/x', 'bugfix/c', 'catalog'], ['origin/main', 'origin/feature/login']);
    // Der Filter gilt für den vollen Namen: „feat“ findet „feature/login“, obwohl die Zeile nur „login“ zeigt.
    const feat = filterFolders(b, ' Feat ');
    expect([...feat].sort()).toEqual(['local:feature', 'local:feature/team-a', 'remote:origin', 'remote:origin/feature']);
    expect(show(branchRows(b, ' Feat ', feat))).toEqual([
      '[Local]',
      '▾ feature',
      '  ▾ team-a',
      '      x',
      '    login',
      '    logout',
      '[Remote]',
      '▾ origin',
      '  ▾ feature',
      '      login',
    ]);
    // „log“ trifft auch einen Branch ohne Ordner; Ordner ohne Treffer (bugfix, team-a) verschwinden.
    expect(show(branchRows(b, 'log', filterFolders(b, 'log')))).toEqual([
      '[Local]',
      '▾ feature',
      '    login',
      '    logout',
      'catalog',
      '[Remote]',
      '▾ origin',
      '  ▾ feature',
      '      login',
    ]);
    // Klappt der Nutzer beim Filtern einen Ordner zu, bleibt er zu, solange der Filter gilt.
    expect(show(branchRows(b, 'log', collapseFolder(filterFolders(b, 'log'), 'remote:origin')))).toEqual([
      '[Local]',
      '▾ feature',
      '    login',
      '    logout',
      'catalog',
      '[Remote]',
      '▸ origin',
    ]);
    // Ohne Treffer: keine Zeilen, auch keine Überschriften.
    expect(branchRows(b, 'nichts', filterFolders(b, 'nichts'))).toEqual([]);
  });

  it('klappt beim Zuklappen eines Ordners auch seine Unterordner zu (wie im Dateibaum, Ticket 29)', () => {
    const b = branches(['main', 'feature/team-a/x', 'feature/team-b/y', 'featurex/z']);
    const all = open('local:feature', 'local:feature/team-a', 'local:feature/team-b', 'local:featurex', 'remote:origin');
    const collapsed = collapseFolder(all, 'local:feature');
    expect([...collapsed].sort()).toEqual(['local:featurex', 'remote:origin']);
    expect([...all]).toHaveLength(5);
    // Wieder aufgeklappt: nur die direkte Ebene, die Unterordner zu.
    expect(show(branchRows(b, '', expandFolder(collapsed, 'local:feature')))).toEqual([
      '[Local]',
      '▾ feature',
      '  ▸ team-a',
      '  ▸ team-b',
      '▾ featurex',
      '    z',
      'main',
    ]);
  });

  it('zeigt „Recent“ über „Local“ mit vollen Namen; der Filter gilt auch dort', () => {
    const b = branches(['main', 'feature/a', 'bugfix/c'], ['origin/main'], ['bugfix/c', 'feature/a']);
    const rows = branchRows(b, '', open());
    expect(show(rows)).toEqual(['[Recent]', 'bugfix/c', 'feature/a', '[Local]', '▸ bugfix', '▸ feature', 'main', '[Remote]', '▸ origin']);
    expect(rows[1]).toMatchObject({ kind: 'local', section: 'recent', label: 'bugfix/c', level: 0, branch: { name: 'bugfix/c' } });
    // Ein Branch steht in „Recent“ und unter „Local“ zugleich; jede Zeile hat ihren eigenen Schlüssel.
    const keys = rows.filter((r) => r.kind !== 'header').map((r) => (r as { key: string }).key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(show(branchRows(b, 'feat', filterFolders(b, 'feat')))).toEqual(['[Recent]', 'feature/a', '[Local]', '▾ feature', '    a']);
    // Ohne Treffer in „Recent“ fehlt der Bereich samt Überschrift, ebenso ohne zuletzt benutzte Branches.
    expect(show(branchRows(b, 'main', filterFolders(b, 'main')))).toEqual(['[Local]', 'main', '[Remote]', '▾ origin', '    main']);
    expect(show(branchRows(branches(['main']), '', open()))).toEqual(['[Local]', 'main']);
    // Was es lokal nicht (mehr) gibt, erscheint nicht.
    expect(show(branchRows(branches(['main'], [], ['weg']), '', open()))).toEqual(['[Local]', 'main']);
  });

  it('findet den Elternordner einer Zeile (Pfeil links), nie über die Überschrift hinaus', () => {
    const b = branches(['main', 'feature/team-a/x', 'feature/y'], [], ['feature/y']);
    const rows = branchRows(b, '', open('local:feature', 'local:feature/team-a'));
    const at = (text: string) => show(rows).indexOf(text);
    expect(parentRow(rows, at('      x'))).toBe(at('  ▾ team-a'));
    expect(parentRow(rows, at('    y'))).toBe(at('▾ feature'));
    expect(parentRow(rows, at('  ▾ team-a'))).toBe(at('▾ feature'));
    expect(parentRow(rows, at('▾ feature'))).toBe(-1);
    expect(parentRow(rows, at('main'))).toBe(-1);
    expect(parentRow(rows, at('feature/y'))).toBe(-1);
  });
});
