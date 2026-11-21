import { describe, expect, it } from 'vitest';
import { menuKey } from '../../src/renderer/popup/menuKeys';
import { projectBadgeColor, projectInitials } from '../../src/renderer/project/projectBadge';

describe('Bedienung eines Menüs mit der Tastatur', () => {
  it('Pfeile laufen im Kreis, Pos1 und Ende springen an die Enden', () => {
    expect(menuKey('ArrowDown', -1, 3)).toEqual({ type: 'highlight', index: 0 });
    expect(menuKey('ArrowDown', 2, 3)).toEqual({ type: 'highlight', index: 0 });
    expect(menuKey('ArrowUp', 0, 3)).toEqual({ type: 'highlight', index: 2 });
    expect(menuKey('ArrowUp', -1, 3)).toEqual({ type: 'highlight', index: 2 });
    expect(menuKey('Home', 2, 3)).toEqual({ type: 'highlight', index: 0 });
    expect(menuKey('End', 0, 3)).toEqual({ type: 'highlight', index: 2 });
    expect(menuKey('ArrowDown', -1, 0)).toBeNull();
  });

  it('Enter wählt den hervorgehobenen Eintrag, Escape und Tab schliessen, andere Tasten gehen vorbei', () => {
    expect(menuKey('Enter', 1, 3)).toEqual({ type: 'choose', index: 1 });
    expect(menuKey('Enter', -1, 3)).toBeNull();
    expect(menuKey('Escape', 1, 3)).toEqual({ type: 'close' });
    expect(menuKey('Tab', 1, 3)).toEqual({ type: 'close' });
    expect(menuKey('a', 1, 3)).toBeNull();
  });
});

describe('Kürzel des Projekts in der Kopfzeile', () => {
  it('nimmt die Anfänge der ersten beiden Wörter, bei einem Wort die ersten zwei Zeichen', () => {
    expect(projectInitials('codium')).toBe('CO');
    expect(projectInitials('my-project')).toBe('MP');
    expect(projectInitials('termHub')).toBe('TH');
    expect(projectInitials('spring boot demo')).toBe('SB');
    expect(projectInitials('Ä')).toBe('Ä');
    expect(projectInitials('---')).toBe('?');
  });

  it('gibt demselben Projekt immer dieselbe Farbe, unabhängig von der Schreibweise', () => {
    expect(projectBadgeColor('C:\\Work\\Codium')).toBe(projectBadgeColor('c:\\work\\codium'));
    expect(projectBadgeColor('C:\\Work\\Codium')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
