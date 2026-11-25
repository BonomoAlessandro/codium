// Scrollbalken aller Monaco-Editoren (Ticket 28, Variante B wie IntelliJ), an einer Stelle: Monaco meldet jeden neuen
// Editor, auch die beiden Seiten der Vergleichsansicht, die Vorschau der Projektsuche und den Zelleditor. Jeder bekommt
// dieselben Optionen (theme.ts) und blendet die Kapsel beim Scrollen kurz ein. Form und Farben stehen in app.css.

import type { editor } from 'monaco-editor';
import { EDITOR_SCROLLBAR, editorScrollbarCssVariables, editorScrollbarOptions } from './theme';

/**
 * Attribut am Editor (`.monaco-editor`), solange gescrollt wird. Ein Attribut statt einer Klasse, weil Monaco die
 * Klassen an diesem Element selbst neu setzt (etwa beim Fokus).
 */
export const SCROLLING_ATTRIBUTE = 'data-codium-scrolling';

/** Richtet die Scrollbalken eines neuen Editors ein. */
export function setUpScrollbars(codeEditor: editor.ICodeEditor): void {
  codeEditor.updateOptions(editorScrollbarOptions());
  let timer: number | undefined;
  const scrolling = codeEditor.onDidScrollChange((e) => {
    // Nur echtes Scrollen, nicht eine neue Höhe oder Breite des Inhalts.
    if (!e.scrollTopChanged && !e.scrollLeftChanged) return;
    const node = codeEditor.getDomNode();
    if (!node) return;
    node.setAttribute(SCROLLING_ATTRIBUTE, '');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => node.removeAttribute(SCROLLING_ATTRIBUTE), EDITOR_SCROLLBAR.revealMs);
  });
  codeEditor.onDidDispose(() => {
    scrolling.dispose();
    window.clearTimeout(timer);
  });
}

/** Gibt die Masse der Kapsel und des Streifens als CSS-Variablen an app.css weiter. */
export function applyScrollbarVariables(root: HTMLElement): void {
  for (const [name, value] of Object.entries(editorScrollbarCssVariables())) root.style.setProperty(name, value);
}
