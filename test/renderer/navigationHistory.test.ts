// Navigationsverlauf für Zurück und Vor (Ticket 13), ohne DOM.

import { describe, expect, it } from 'vitest';
import { JUMP_LINES, NavigationHistory, type NavLocation } from '../../src/renderer/editor/navigationHistory';

const at = (path: string, line: number, column = 1): NavLocation => ({ path, line, column });

describe('Navigationsverlauf', () => {
  it('merkt sich die Ausgangsstelle bei einem Sprung in eine andere Datei oder weit weg', () => {
    const history = new NavigationHistory();
    expect(history.moved(at('C:\\a.ts', 3), at('C:\\b.ts', 1))).toBe(true);
    expect(history.moved(at('C:\\b.ts', 1), at('C:\\b.ts', 2 + JUMP_LINES))).toBe(true);
    expect(history.goBack(at('C:\\b.ts', 2 + JUMP_LINES))).toEqual(at('C:\\b.ts', 1));
    expect(history.goBack(at('C:\\b.ts', 1))).toEqual(at('C:\\a.ts', 3));
    expect(history.goBack(at('C:\\a.ts', 3))).toBeNull();
  });

  it('merkt sich kleine Cursorbewegungen nicht', () => {
    const history = new NavigationHistory();
    expect(history.moved(at('C:\\a.ts', 3), at('C:\\a.ts', 4))).toBe(false);
    expect(history.moved(at('C:\\a.ts', 4), at('C:\\a.ts', 4 + JUMP_LINES))).toBe(false);
    expect(history.moved(at('C:\\a.ts', 4, 1), at('C:\\a.ts', 4, 80))).toBe(false);
    expect(history.canGoBack).toBe(false);
  });

  it('geht zurück und wieder vor', () => {
    const history = new NavigationHistory();
    history.moved(at('C:\\a.ts', 3), at('C:\\b.ts', 7));
    expect(history.canGoForward).toBe(false);
    const back = history.goBack(at('C:\\b.ts', 7));
    expect(back).toEqual(at('C:\\a.ts', 3));
    expect(history.canGoForward).toBe(true);
    expect(history.goForward(at('C:\\a.ts', 3))).toEqual(at('C:\\b.ts', 7));
    expect(history.goForward(at('C:\\b.ts', 7))).toBeNull();
    expect(history.goBack(at('C:\\b.ts', 7))).toEqual(at('C:\\a.ts', 3));
  });

  it('verwirft nach Zurück mit einem neuen Sprung die Vor-Einträge', () => {
    const history = new NavigationHistory();
    history.moved(at('C:\\a.ts', 3), at('C:\\b.ts', 7));
    history.goBack(at('C:\\b.ts', 7));
    expect(history.canGoForward).toBe(true);
    history.moved(at('C:\\a.ts', 3), at('C:\\c.ts', 1));
    expect(history.canGoForward).toBe(false);
    expect(history.goBack(at('C:\\c.ts', 1))).toEqual(at('C:\\a.ts', 3));
  });

  it('nimmt dieselbe Stelle nicht doppelt und folgt Umbenennen und Löschen', () => {
    const history = new NavigationHistory();
    history.jumped(at('C:\\p\\a.ts', 3));
    history.jumped(at('C:\\p\\a.ts', 3, 9));
    history.jumped(at('C:\\p\\src\\b.ts', 5));
    history.rename('C:\\p\\src', 'C:\\p\\lib');
    history.rename('C:\\p\\a.ts', null);
    expect(history.goBack(at('C:\\p\\x.ts', 1))).toEqual(at('C:\\p\\lib\\b.ts', 5));
    expect(history.goBack(at('C:\\p\\x.ts', 1))).toBeNull();
  });
});
