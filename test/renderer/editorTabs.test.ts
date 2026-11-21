// Reine Regeln der Datei-Tabs und der Zuordnung von Dateien zu Sprachen, ohne DOM und ohne Monaco.

import { describe, expect, it } from 'vitest';
import { languageForFile, PLAIN_TEXT } from '../../src/renderer/editor/languages';
import { tabLabels, withTab, withoutTab } from '../../src/renderer/editor/tabs';
import { semanticRules } from '../../src/renderer/editor/theme';

const ROOT = 'C:\\work\\Alpha';
const at = (relative: string) => `${ROOT}\\${relative.replaceAll('/', '\\')}`;

describe('Beschriftung der Tabs', () => {
  const labelsOf = (relatives: string[]) => {
    const labels = tabLabels(relatives.map(at), ROOT);
    return relatives.map((r) => labels.get(at(r).toLowerCase()));
  };

  it('zeigt nur den Namen, solange er eindeutig ist', () => {
    expect(labelsOf(['src/Main.java', 'README.md'])).toEqual([{ name: 'Main.java' }, { name: 'README.md' }]);
  });

  it('unterscheidet gleiche Namen mit dem kürzesten Ordnerteil', () => {
    expect(labelsOf(['src/a/index.ts', 'src/b/index.ts', 'Other.ts'])).toEqual([
      { name: 'index.ts', hint: 'a' },
      { name: 'index.ts', hint: 'b' },
      { name: 'Other.ts' },
    ]);
    // Gleicher letzter Ordner: einer mehr.
    expect(labelsOf(['x/lib/index.ts', 'y/lib/index.ts', 'lib/index.ts'])).toEqual([
      { name: 'index.ts', hint: 'x/lib' },
      { name: 'index.ts', hint: 'y/lib' },
      { name: 'index.ts', hint: 'lib' },
    ]);
  });

  it('nimmt für eine Datei im Projektordner den Projektnamen und vergleicht ohne Gross-/Kleinschreibung', () => {
    expect(labelsOf(['index.ts', 'src/INDEX.ts'])).toEqual([
      { name: 'index.ts', hint: 'Alpha' },
      { name: 'INDEX.ts', hint: 'src' },
    ]);
  });
});

describe('Öffnen und Schliessen', () => {
  it('öffnet eine Datei nicht doppelt, auch nicht in anderer Schreibweise', () => {
    expect(withTab([at('a.txt')], at('b.txt'))).toEqual([at('a.txt'), at('b.txt')]);
    expect(withTab([at('a.txt'), at('b.txt')], at('A.TXT'))).toEqual([at('a.txt'), at('b.txt')]);
  });

  it('aktiviert nach dem Schliessen des aktiven Tabs den linken, am Anfang den rechten', () => {
    const tabs = [at('a'), at('b'), at('c')];
    expect(withoutTab(tabs, at('b'), at('b'))).toEqual({ tabs: [at('a'), at('c')], active: at('a') });
    expect(withoutTab(tabs, at('a'), at('a'))).toEqual({ tabs: [at('b'), at('c')], active: at('b') });
    // Ein anderer Tab schliesst: Der aktive bleibt.
    expect(withoutTab(tabs, at('c'), at('a'))).toEqual({ tabs: [at('b'), at('c')], active: at('c') });
    expect(withoutTab([at('a')], at('a'), at('a'))).toEqual({ tabs: [], active: null });
  });
});

describe('Sprache einer Datei', () => {
  const languages = [
    { id: 'typescript', extensions: ['.ts', '.tsx'] },
    { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
    { id: 'ini', extensions: ['.ini', '.properties', '.gitconfig'] },
    { id: 'json', extensions: ['.json'] },
    { id: 'special', extensions: ['.d.json'] },
  ];

  it('wählt nach Dateiname, sonst nach der längsten Endung, ohne Gross-/Kleinschreibung', () => {
    expect(languageForFile('index.TS', languages)).toBe('typescript');
    expect(languageForFile('dockerfile', languages)).toBe('dockerfile');
    expect(languageForFile('app.properties', languages)).toBe('ini');
    expect(languageForFile('x.d.json', languages)).toBe('special');
    expect(languageForFile('.gitconfig', languages)).toBe('ini');
    expect(languageForFile('notes', languages)).toBe(PLAIN_TEXT);
  });
});

describe('Farbschema', () => {
  it('bildet semantische Token in jeder Reihenfolge der Modifikatoren wie IntelliJ ab', () => {
    const rules = new Map(semanticRules().map((r) => [r.token, r]));
    // Felder violett, statische kursiv, Konstanten violett kursiv.
    expect(rules.get('property')).toMatchObject({ foreground: 'c77dbb', fontStyle: '' });
    expect(rules.get('property.static')).toMatchObject({ foreground: 'c77dbb', fontStyle: 'italic' });
    expect(rules.get('property.readonly.static')).toMatchObject({ foreground: 'c77dbb', fontStyle: 'italic' });
    expect(rules.get('property.static.readonly')).toMatchObject({ foreground: 'c77dbb', fontStyle: 'italic' });
    // Methodendeklarationen blau, Aufrufe in der Grundfarbe.
    expect(rules.get('method.declaration')).toMatchObject({ foreground: '56a8f5' });
    expect(rules.get('method.static.declaration')).toMatchObject({ foreground: '56a8f5', fontStyle: 'italic' });
    expect(rules.get('method')).toMatchObject({ foreground: 'bcbec4' });
    // Parameter und lokale Variablen in der Grundfarbe.
    expect(rules.get('parameter')).toMatchObject({ foreground: 'bcbec4' });
    expect(rules.get('variable.readonly')).toMatchObject({ foreground: 'bcbec4' });
  });
});
