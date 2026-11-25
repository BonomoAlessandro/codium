// Rundungen aus einer Hand (Ticket 25): Alle Radien in app.css laufen über die Variablen aus tokens.css, ausser Kreisen
// (50%) und bewusst eckigen Stellen (0).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles');
const tokens = fs.readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
const app = fs.readFileSync(path.join(STYLES, 'app.css'), 'utf8');

/** Die Radien, die tokens.css festlegt, mit ihrem Wert. */
function radiusTokens(): Map<string, string> {
  return new Map([...tokens.matchAll(/(--radius-[a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** Alle Radien in app.css (auch Einzelecken wie border-top-left-radius), ohne Kommentare. */
function radiusDeclarations(): Array<{ line: number; value: string }> {
  const withoutComments = app.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  return withoutComments.split('\n').flatMap((text, i) => {
    const m = /border(?:-[a-z]+)*-radius\s*:\s*([^;]+);/.exec(text);
    return m ? [{ line: i + 1, value: m[1].trim() }] : [];
  });
}

describe('Rundungen', () => {
  it('tokens.css legt klein, mittel, gross, Dialog, Inseln und Kapsel fest', () => {
    expect(Object.fromEntries(radiusTokens())).toEqual({
      '--radius-xs': '3px',
      '--radius-s': '4px',
      '--radius-m': '6px',
      '--radius-l': '8px',
      '--radius-xl': '10px',
      '--radius-island': '10px',
      '--radius-pill': '999px',
    });
  });

  it('alle Radien in app.css nutzen diese Variablen, ausser 50% und 0', () => {
    const known = radiusTokens();
    const declarations = radiusDeclarations();
    expect(declarations.length).toBeGreaterThan(20);
    const wrong = declarations.filter(({ value }) => {
      if (value === '50%' || value === '0') return false;
      const parts = value.split(/\s+/);
      return !parts.every((part) => {
        const m = /^var\((--radius-[a-z]+)\)$/.exec(part);
        return m !== null && known.has(m[1]);
      });
    });
    expect(wrong.map(({ line, value }) => `app.css:${line} ${value}`)).toEqual([]);
  });
});
