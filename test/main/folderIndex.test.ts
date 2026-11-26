// Index der Ordner mit gemerkten Einträgen (Ticket 32, Review): zählt je Ordner die Einträge darunter.

import { describe, expect, it } from 'vitest';
import { ancestorIn, FolderIndex, windowsParent } from '../../src/shared/folderIndex';

describe('Index der Ordner mit gemerkten Einträgen', () => {
  it('bildet die Elternordner eines Windows-Pfads bis zum Laufwerk', () => {
    expect(windowsParent('c:\\a\\b\\f.java')).toBe('c:\\a\\b');
    expect(windowsParent('c:\\a')).toBe('c:\\');
    expect(windowsParent('c:\\')).toBeNull();
    expect(windowsParent('name')).toBeNull();
  });

  it('zählt je Ordner die Einträge darunter und vergisst leere Ordner', () => {
    const index = new FolderIndex(windowsParent);
    index.add('c:\\p\\a\\x.java');
    index.add('c:\\p\\a\\y.java');
    index.add('c:\\p\\b\\z.java');
    expect(index.hasEntriesBelow('c:\\p')).toBe(true);
    expect(index.hasEntriesBelow('c:\\p\\a')).toBe(true);
    expect(index.hasEntriesBelow('c:\\p\\a\\x.java')).toBe(false);
    expect(index.hasEntriesBelow('c:\\p\\c')).toBe(false);
    index.remove('c:\\p\\a\\x.java');
    expect(index.hasEntriesBelow('c:\\p\\a')).toBe(true);
    index.remove('c:\\p\\a\\y.java');
    expect(index.hasEntriesBelow('c:\\p\\a')).toBe(false);
    expect(index.hasEntriesBelow('c:\\p')).toBe(true);
  });

  it('findet den nächsten Elternordner aus einer Menge, ohne den Eintrag selbst', () => {
    const folders = new Set(['c:\\p\\a', 'c:\\p']);
    expect(ancestorIn('c:\\p\\a\\b\\x.java', folders, windowsParent)).toBe('c:\\p\\a');
    expect(ancestorIn('c:\\q\\x.java', folders, windowsParent)).toBeNull();
    expect(ancestorIn('c:\\p\\a', folders, windowsParent)).toBe('c:\\p');
    // „c:\pa“ liegt nicht in „c:\p“.
    expect(ancestorIn('c:\\pa\\x.java', new Set(['c:\\p']), windowsParent)).toBeNull();
  });
});
