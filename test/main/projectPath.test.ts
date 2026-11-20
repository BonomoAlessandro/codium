import * as fs from 'node:fs';
import * as os from 'node:os';
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

  it('löst bei vorhandenen Ordnern Kurznamen und Junctions zum echten Pfad auf', () => {
    // os.tmpdir() liefert unter Windows oft einen Kurznamen wie C:\Users\ALESSA~1\...; mkdtemp übernimmt ihn.
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'codium-pfad-'));
    try {
      const real = fs.realpathSync.native(raw);
      const project = path.join(real, 'Projekt');
      const junction = path.join(real, 'Verknuepfung');
      fs.mkdirSync(project);
      fs.symlinkSync(project, junction, 'junction');

      expect(normalizeProjectPath(path.join(raw, 'projekt'))).toBe(project);
      expect(projectKey(junction)).toBe(projectKey(project));
      expect(projectStateFileName(path.join(raw, 'Projekt'))).toBe(projectStateFileName(project));
    } finally {
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });

  it('macht aus dem Ordnernamen einen lesbaren Dateinamen', () => {
    expect(projectName(base)).toBe('Mein Projekt');
    expect(projectStateFileName(base)).toMatch(/^mein_projekt-[0-9a-f]{12}\.json$/);
  });
});
