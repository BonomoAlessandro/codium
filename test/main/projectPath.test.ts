import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeProjectPath,
  projectKey,
  projectName,
  projectStateFileName,
} from '../../src/main/core/projectPath';

describe('Projektpfade', () => {
  const base = path.resolve('C:\\Arbeit\\Mein Projekt');
  const spellings = [
    'C:\\Arbeit\\Mein Projekt',
    'C:\\Arbeit\\Mein Projekt\\',
    'C:/Arbeit/Mein Projekt/',
    'c:\\arbeit\\MEIN PROJEKT',
    'C:\\Arbeit\\.\\Mein Projekt',
  ];

  it('normalisiert auf den absoluten Pfad ohne abschliessenden Trenner', () => {
    expect(normalizeProjectPath('C:/Arbeit/Mein Projekt/')).toBe(base);
    expect(normalizeProjectPath('C:\\')).toBe('C:\\');
  });

  it.each(spellings)('„%s“ ergibt denselben Schlüssel und dieselbe Zustandsdatei', (spelling) => {
    expect(projectKey(spelling)).toBe(projectKey(base));
    expect(projectStateFileName(spelling)).toBe(projectStateFileName(base));
  });

  it('unterscheidet gleichnamige Ordner an verschiedenen Orten', () => {
    expect(projectStateFileName('C:\\A\\app')).not.toBe(projectStateFileName('C:\\B\\app'));
  });

  it('macht aus dem Ordnernamen einen lesbaren Dateinamen', () => {
    expect(projectName(base)).toBe('Mein Projekt');
    expect(projectStateFileName(base)).toMatch(/^mein_projekt-[0-9a-f]{12}\.json$/);
  });
});
