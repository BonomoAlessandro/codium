// Das Fenster (Hauptprozess) und die Oberfläche (CSS) brauchen dieselben Farben und dieselbe Höhe der Kopfzeile,
// sonst blitzt beim Öffnen eine andere Farbe auf oder die Fensterknöpfe passen nicht zur Kopfzeile.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEADER_HEIGHT, PANEL_BACKGROUND, WINDOW_BACKGROUND, WINDOW_SYMBOL_COLOR } from '../../src/shared/theme';

const ROOT = path.resolve(__dirname, '..', '..');
const tokens = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'tokens.css'), 'utf8');

function token(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();
}

describe('Design', () => {
  it('Fenster und Oberfläche haben dieselben Farben und dieselbe Höhe der Kopfzeile', () => {
    expect(token('bg')).toBe(WINDOW_BACKGROUND);
    expect(token('bg-panel')).toBe(PANEL_BACKGROUND);
    expect(token('icon')).toBe(WINDOW_SYMBOL_COLOR);
    expect(token('header-height')).toBe(`${HEADER_HEIGHT}px`);
  });

  it('hat nur ein dunkles Schema, unabhängig vom Design von Windows', () => {
    expect(tokens).not.toMatch(/prefers-color-scheme/);
    expect(tokens).toMatch(/color-scheme:\s*dark/);
  });

  it('die Seite ist englisch', () => {
    expect(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')).toMatch(/<html lang="en">/);
  });
});
