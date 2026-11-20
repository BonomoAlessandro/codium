import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lexicalProjectKey,
  normalizeProjectPath,
  projectFolderExists,
  projectName,
  projectStateFileName,
  resolveProjectKey,
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalisiert auf den absoluten Pfad ohne abschliessenden Trenner', () => {
    expect(normalizeProjectPath('C:/Arbeit/Mein Projekt/')).toBe(base);
    expect(normalizeProjectPath('C:\\')).toBe('C:\\');
  });

  it.each(spellings)('„%s“ ergibt denselben Schlüssel und dieselbe Zustandsdatei', async (spelling) => {
    expect(lexicalProjectKey(spelling)).toBe(lexicalProjectKey(base));
    // Der Ordner fehlt: Der Schlüssel fällt auf den ohne Dateizugriff zurück.
    const resolved = await resolveProjectKey(spelling);
    expect(resolved).toEqual({ key: lexicalProjectKey(base), resolved: false });
    expect(projectStateFileName(resolved.key)).toBe(projectStateFileName(lexicalProjectKey(base)));
  });

  it('unterscheidet gleichnamige Ordner an verschiedenen Orten', () => {
    expect(projectStateFileName(lexicalProjectKey('C:\\A\\app'))).not.toBe(projectStateFileName(lexicalProjectKey('C:\\B\\app')));
  });

  it('vergleicht vorhandene Ordner über ihren echten Pfad, zeigt aber die angegebene Schreibweise', async () => {
    // os.tmpdir() liefert unter Windows oft einen Kurznamen wie C:\Users\ALESSA~1\...; mkdtemp übernimmt ihn.
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'codium-pfad-'));
    try {
      const real = fs.realpathSync.native(raw);
      const project = path.join(real, 'Projekt');
      const junction = path.join(real, 'Verknuepfung');
      fs.mkdirSync(project);
      fs.symlinkSync(project, junction, 'junction');

      // Angezeigt und als Arbeitsordner benutzt wird die angegebene Schreibweise (etwa ein Netzlaufwerk bleibt
      // ein Laufwerksbuchstabe), verglichen wird über den echten Pfad.
      expect(normalizeProjectPath(path.join(raw, 'projekt'))).toBe(path.join(raw, 'projekt'));
      const projectKey = await resolveProjectKey(project);
      expect(projectKey.resolved).toBe(true);
      expect(await resolveProjectKey(path.join(raw, 'projekt'))).toEqual(projectKey);
      expect(await resolveProjectKey(junction)).toEqual(projectKey);
      expect(await projectFolderExists(junction)).toBe(true);
      expect(await projectFolderExists(path.join(real, 'fehlt'))).toBe(false);
    } finally {
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });

  it('gibt einen Ordner, der nicht antwortet (etwa ein nicht erreichbares Netzlaufwerk), nach dem Zeitlimit auf', async () => {
    const hang = () => new Promise<never>(() => {});
    vi.spyOn(fs.promises, 'stat').mockImplementation(hang);
    vi.spyOn(fs.promises, 'realpath').mockImplementation(hang);

    const started = Date.now();
    expect(await projectFolderExists('Z:\\Projekt', 50)).toBe(false);
    expect(await resolveProjectKey('Z:\\Projekt', 50)).toEqual({ key: lexicalProjectKey('Z:\\Projekt'), resolved: false });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('macht aus dem Ordnernamen einen lesbaren Dateinamen', () => {
    expect(projectName(base)).toBe('Mein Projekt');
    expect(projectStateFileName(lexicalProjectKey(base))).toMatch(/^mein_projekt-[0-9a-f]{12}\.json$/);
  });
});
