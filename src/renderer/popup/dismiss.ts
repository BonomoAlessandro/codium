// Gemeinsames Schliessen der Popups bei einem Klick daneben (Ticket 33): Menüs (auch das Projektmenü), Branch-Dropdown,
// Suchfenster und das Popup eines Änderungsblocks.
//
// Ein Klick daneben schliesst über `pointerdown` mit Capture am Fenster. Das erreicht das Popup vor jedem anderen
// Empfänger, also auch im Editor, im Terminal und in der Markdown-Vorschau (beide liegen im DOM der Seite, kein
// iframe), und der Klick wirkt danach wie gewohnt weiter. Drei Arten von Klicks erreichen die Seite aber nie:
// - **Zieh-Fläche der Kopfzeile** (`-webkit-app-region: drag`): Windows behandelt den Klick als Klick auf die
//   Titelleiste, und das Fenster behält dabei den Fokus. Solange ein Popup offen ist, ist die Kopfzeile deshalb keine
//   Zieh-Fläche (Klasse am Wurzelelement, app.css), wie bei VS Code mit offenem Menü. Der Klick erreicht so die Seite
//   und schliesst das Popup; gezogen wird mit dem nächsten.
// - **Ausserhalb des Fensters** (Desktop, anderes Programm, auch Alt + Tab und Minimieren): Das Fenster verliert den
//   Fokus (`blur`).
// - **Fensterrand und Fensterknöpfe** (Grösse ziehen, Maximieren, Wiederherstellen): Das Fenster ändert seine Grösse
//   (`resize`).

import { useEffect, useRef } from 'react';

/** Klasse am Wurzelelement, solange ein Popup offen ist; app.css nimmt der Kopfzeile damit die Zieh-Fläche. */
export const POPUP_OPEN_CLASS = 'popup-open';

/** Das Element, das die Klasse trägt; in Tests ein Ersatz mit `classList`. */
export interface PopupRoot {
  classList: { toggle(name: string, force?: boolean): boolean };
}

const holds = new WeakMap<PopupRoot, number>();

/**
 * Nimmt der Kopfzeile die Zieh-Fläche, bis die gelieferte Freigabe läuft. Gezählt, weil Popups übereinander liegen
 * können (etwa das Untermenü im Branch-Dropdown); erst die letzte Freigabe gibt die Zieh-Fläche zurück. Eine zweite
 * Freigabe derselben Sperre bewirkt nichts.
 */
export function holdHeaderNoDrag(root: PopupRoot = document.documentElement): () => void {
  const count = (holds.get(root) ?? 0) + 1;
  holds.set(root, count);
  if (count === 1) root.classList.toggle(POPUP_OPEN_CLASS, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const rest = (holds.get(root) ?? 1) - 1;
    holds.set(root, rest);
    if (rest === 0) root.classList.toggle(POPUP_OPEN_CLASS, false);
  };
}

/** Für Popups, die einen Klick daneben selbst erkennen (etwa über einen Hintergrund): nur die Kopfzeile ohne Zieh-Fläche. */
export function useHeaderNoDrag(): void {
  useEffect(() => holdHeaderNoDrag(), []);
}

/** Warum ein Popup schliesst: Klick daneben, Fenster verliert den Fokus, Fenster ändert die Grösse. */
export type DismissReason = 'outside' | 'blur' | 'resize';

/**
 * Schliesst ein Popup bei einem Klick daneben, bei Fokusverlust und bei Grössenänderung des Fensters, und nimmt der
 * Kopfzeile die Zieh-Fläche, solange es offen ist. `isInside` sagt, welche Klicks zum Popup gehören (etwa auch der
 * Knopf, an dem es hängt: Dessen Klick schaltet das Popup selbst um). Beide Funktionen dürfen sich bei jedem Rendern
 * ändern.
 */
export function useDismiss(isInside: (target: Node) => boolean, onDismiss: (reason: DismissReason) => void): void {
  const insideRef = useRef(isInside);
  insideRef.current = isInside;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const release = holdHeaderNoDrag();
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && insideRef.current(e.target)) return;
      dismissRef.current('outside');
    };
    // Ohne Capture: `blur` steigt nicht auf, so kommt nur der Fokusverlust des Fensters selbst an.
    const onBlur = () => dismissRef.current('blur');
    const onResize = () => dismissRef.current('resize');
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      release();
    };
  }, []);
}
