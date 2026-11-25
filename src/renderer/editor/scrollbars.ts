// Scrollbalken aller Monaco-Editoren (Ticket 28, Variante B wie IntelliJ), an einer Stelle: Monaco meldet jeden neuen
// Editor, auch die beiden Seiten der Vergleichsansicht, die Vorschau der Projektsuche, den Zelleditor und die Vorschau
// im Peek (eingebetteter Editor). Jeder bekommt dieselben Optionen und blendet die Kapsel beim Scrollen kurz ein. Die
// Form steht in app.css, Masse und Farben in theme.ts.

import type { editor } from 'monaco-editor';
import { EDITOR_SCROLLBAR, editorScrollbarCssVariables, editorScrollbarOptions } from './theme';

/**
 * Attribut am Editor (`.monaco-editor`), solange gescrollt wird. Ein Attribut statt einer Klasse, weil Monaco die
 * Klassen an diesem Element selbst neu setzt (etwa beim Fokus).
 */
export const SCROLLING_ATTRIBUTE = 'data-codium-scrolling';

/** Richtet die Scrollbalken eines neuen Editors ein (aus `monaco.editor.onDidCreateEditor`). */
export function setUpScrollbars(codeEditor: editor.ICodeEditor): void {
  // Sofort, noch im Konstruktor des Editors: Die Breite des Schiebers (`verticalSliderSize`, `horizontalSliderSize`)
  // liest Monaco nur einmal, wenn er die Ansicht anlegt (verticalScrollbar.js und horizontalScrollbar.js, `_createSlider`).
  codeEditor.updateOptions(editorScrollbarOptions());
  // Und noch einmal, sobald der Konstruktor fertig ist: Ein eingebetteter Editor (Vorschau im Peek) merkt sich
  // Optionen erst danach (`_overwriteOptions`) und setzt im Konstruktor eigene (Rand 14 px, zwei Spuren, Schatten).
  // Was jetzt kommt, mischt er in seine eigenen Optionen; so übersteht es auch Änderungen am Editor darüber.
  let disposed = false;
  queueMicrotask(() => {
    if (!disposed) codeEditor.updateOptions(editorScrollbarOptions());
  });
  let timer: number | undefined;
  const scrolling = codeEditor.onDidScrollChange((e) => {
    // Nur echtes Scrollen, nicht eine neue Höhe oder Breite des Inhalts.
    if (!e.scrollTopChanged && !e.scrollLeftChanged) return;
    const node = codeEditor.getDomNode();
    if (!node) return;
    if (!node.hasAttribute(SCROLLING_ATTRIBUTE)) node.setAttribute(SCROLLING_ATTRIBUTE, '');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => node.removeAttribute(SCROLLING_ATTRIBUTE), EDITOR_SCROLLBAR.revealMs);
  });
  codeEditor.onDidDispose(() => {
    disposed = true;
    scrolling.dispose();
    window.clearTimeout(timer);
  });
}

/** Gibt Masse und Zeiten der Kapsel und des Streifens als CSS-Variablen an app.css weiter. */
export function applyScrollbarVariables(root: HTMLElement): void {
  for (const [name, value] of Object.entries(editorScrollbarCssVariables())) root.style.setProperty(name, value);
}
