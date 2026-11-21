// Reine Regeln der Suchfenster ohne DOM.

import { describe, expect, it } from 'vitest';
import type { SearchMatch } from '../../src/shared/types';
import { groupByFile, markPositions, matchParts, moveSelection } from '../../src/renderer/search/searchResults';

const match = (path: string, line: number, column: number, lineText: string, length = 3): SearchMatch => ({
  path,
  line,
  column,
  length,
  lineText,
  lineOffset: 0,
});

describe('Suchfenster', () => {
  it('gruppiert Treffer nach Datei in der Reihenfolge ihres Auftretens', () => {
    const groups = groupByFile([match('C:\\p\\b.ts', 1, 1, 'x'), match('C:\\p\\a.ts', 2, 1, 'y'), match('C:\\P\\B.ts', 3, 1, 'z')]);
    expect(groups.map((g) => [g.path, g.matches.map((m) => m.line)])).toEqual([
      ['C:\\p\\b.ts', [1, 3]],
      ['C:\\p\\a.ts', [2]],
    ]);
  });

  it('hebt Stellen und Treffer hervor', () => {
    expect(markPositions('UserService', [0, 4, 5])).toEqual([
      { text: 'U', marked: true },
      { text: 'ser', marked: false },
      { text: 'Se', marked: true },
      { text: 'rvice', marked: false },
    ]);
    // Führende Leerzeichen der Zeile fallen weg, der Treffer bleibt.
    expect(matchParts(match('a', 1, 7, '    a foo b'))).toEqual([
      { text: 'a ', marked: false },
      { text: 'foo', marked: true },
      { text: ' b', marked: false },
    ]);
  });

  it('bewegt die Auswahl nur mit Pfeiltasten, auch bei leerer Liste kein Verschlucken getippter Zeichen', () => {
    expect(moveSelection(0, 5, 'ArrowDown')).toBe(1);
    expect(moveSelection(4, 5, 'ArrowDown')).toBe(4);
    expect(moveSelection(0, 5, 'ArrowUp')).toBe(0);
    expect(moveSelection(2, 50, 'PageDown')).toBe(12);
    // Getippte Zeichen ändern nichts; sonst hielte das Suchfeld sie für eine Bewegung und verwürfe sie.
    expect(moveSelection(0, 0, 'n')).toBe(0);
    expect(moveSelection(0, 3, 'x')).toBe(0);
  });
});
