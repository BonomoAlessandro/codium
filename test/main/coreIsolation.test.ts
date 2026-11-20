// Der Kern und der System-Port laden nie Electron und kennen den Testmodus nicht; sonst liessen sie sich nicht
// in Node testen. Geprüft am Quelltext, damit auch Module erfasst sind, die noch kein Test importiert.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const FORBIDDEN = [
  { pattern: /from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)|import\(\s*['"]electron['"]\s*\)/, what: 'Electron' },
  { pattern: /from\s+['"][^'"]*\/electron\/[^'"]*['"]/, what: 'die Electron-Ports' },
  { pattern: /from\s+['"][^'"]*\/testMode['"]/, what: 'den Testmodus' },
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('Kern ohne Electron', () => {
  const files = [...sourceFiles(path.join(ROOT, 'src', 'main', 'core')), ...sourceFiles(path.join(ROOT, 'src', 'main', 'system'))];

  it('findet die Module des Kerns', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [path.relative(ROOT, file), file]))('%s lädt weder Electron noch den Testmodus', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8');
    for (const { pattern, what } of FORBIDDEN) expect(pattern.test(source), `lädt ${what}`).toBe(false);
  });

  it('sperrt Electron im Testlauf', async () => {
    await expect(import('electron')).rejects.toThrow(/Electron darf in den Tests nicht geladen werden/);
  });
});
