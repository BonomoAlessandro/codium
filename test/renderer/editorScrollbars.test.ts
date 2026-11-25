// Scrollbalken der Monaco-Editoren (Ticket 28): die freigegebenen Werte von Variante B an einer Stelle (theme.ts) und
// ihr Weg zu Monaco (Optionen, Farben) und zu app.css (Variablen). Wie es in der App aussieht, prüft
// test/ui/scrollbars.test.ts.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCROLLING_ATTRIBUTE } from '../../src/renderer/editor/scrollbars';
import {
  EDITOR_COLORS,
  EDITOR_SCROLLBAR,
  EDITOR_SCROLLBAR_WIDTH,
  editorScrollbarCssVariables,
  editorScrollbarOptions,
} from '../../src/renderer/editor/theme';

const app = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles', 'app.css'), 'utf8');

/** Farbe `#rrggbbaa` als Grau und Deckkraft. */
function rgba(color: string): { rgb: string; alpha: number } {
  return { rgb: color.slice(1, 7), alpha: parseInt(color.slice(7, 9), 16) };
}

describe('Scrollbalken der Editoren', () => {
  it('hat die Masse der freigegebenen Variante B', () => {
    expect(EDITOR_SCROLLBAR_WIDTH).toBe(16);
    expect(EDITOR_SCROLLBAR).toMatchObject({ grip: 10, gap: 1, stripe: 5, thumb: 6, thumbHover: 9, horizontal: 12 });
  });

  it('hat die Farben von IntelliJ „Dark“, beim Ziehen eine Stufe heller', () => {
    expect(EDITOR_SCROLLBAR.color).toBe('#a6a6a647');
    expect(EDITOR_SCROLLBAR.hoverColor).toBe('#a6a6a659');
    const [rest, hover, active] = [EDITOR_SCROLLBAR.color, EDITOR_SCROLLBAR.hoverColor, EDITOR_SCROLLBAR.activeColor].map(rgba);
    expect(active!.rgb).toBe(rest!.rgb);
    expect(active!.alpha - hover!.alpha).toBe(hover!.alpha - rest!.alpha);
  });

  it('gibt Monaco dieselben Farben, ohne Schatten', () => {
    expect(EDITOR_COLORS['scrollbarSlider.background']).toBe(EDITOR_SCROLLBAR.color);
    expect(EDITOR_COLORS['scrollbarSlider.hoverBackground']).toBe(EDITOR_SCROLLBAR.hoverColor);
    expect(EDITOR_COLORS['scrollbarSlider.activeBackground']).toBe(EDITOR_SCROLLBAR.activeColor);
    expect(EDITOR_COLORS['scrollbar.shadow']).toBe('#00000000');
  });

  it('Optionen: Rand 16 px, Schieber in der Greiffläche, eine Spur, immer bedienbar', () => {
    expect(editorScrollbarOptions()).toEqual({
      overviewRulerLanes: 1,
      scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        useShadows: false,
        verticalHasArrows: false,
        horizontalHasArrows: false,
        verticalScrollbarSize: 16,
        verticalSliderSize: 10,
        horizontalScrollbarSize: 12,
        horizontalSliderSize: 12,
      },
    });
  });

  it('app.css nutzt die Masse und Farben von dort, keine eigenen Werte', () => {
    for (const name of Object.keys(editorScrollbarCssVariables())) expect(app).toContain(`var(${name})`);
    expect(editorScrollbarCssVariables()).toEqual({
      '--editor-scrollbar-thumb': '6px',
      '--editor-scrollbar-thumb-hover': '9px',
      '--editor-scrollbar-stripe': '5px',
    });
    for (const color of ['background', 'hoverBackground', 'activeBackground']) expect(app).toContain(`var(--vscode-scrollbarSlider-${color})`);
    expect(app).toContain(`.monaco-editor[${SCROLLING_ATTRIBUTE}]`);
    // Die Kapsel ist ganz gerundet.
    expect(app).toMatch(/\.slider::before \{[^}]*border-radius: var\(--radius-pill\)/);
  });
});
