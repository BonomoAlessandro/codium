// Wo ein Fenster beim Öffnen hinkommt: reine Rechnung auf den Bildschirmen, die der Port „Fenster“ meldet.
// Lädt nie Electron.

import type { Bounds, DisplayInfo, WindowPlacement } from './ports';

/** Oberster Streifen des Fensters, an dem es sich greifen und verschieben lässt (Kopfzeile). */
const TITLE_BAR_HEIGHT = 32;
/** So viel der Kopfzeile muss im Arbeitsbereich eines Bildschirms liegen, damit das Fenster als sichtbar gilt. */
const MIN_VISIBLE_TITLE_BAR = { width: 100, height: 16 };

/**
 * Die Lage, in der ein Fenster öffnet:
 * - Die gespeicherte Lage gilt unverändert, solange die Kopfzeile auf einem angeschlossenen Bildschirm greifbar ist.
 * - Sonst (etwa nach dem Abziehen eines Bildschirms) kommt das Fenster zentriert auf den Hauptbildschirm, in der
 *   gespeicherten Grösse, höchstens aber so gross wie dessen Arbeitsbereich. Der Maximiert-Zustand bleibt.
 */
export function placeWindow(saved: WindowPlacement, displays: DisplayInfo[]): WindowPlacement {
  if (displays.length === 0 || displays.some((d) => titleBarVisible(saved.bounds, d.workArea))) {
    return structuredClone(saved);
  }
  const primary = displays.find((d) => d.primary) ?? displays[0];
  return { bounds: centreIn(primary.workArea, saved.bounds), maximized: saved.maximized };
}

/** Versatz eines neuen Fensters gegenüber dem zuletzt benutzten, wie in IntelliJ. */
export const CASCADE_OFFSET = 30;

/**
 * Lage eines neuen Fensters ohne gespeicherte Lage: um `CASCADE_OFFSET` nach rechts unten versetzt gegenüber dem
 * zuletzt benutzten Fenster, in dessen Grösse und Maximiert-Zustand. Ragte es damit aus dem Arbeitsbereich des
 * Bildschirms, beginnt es oben links in diesem Bereich.
 */
export function cascadeFrom(reference: WindowPlacement, displays: DisplayInfo[]): WindowPlacement {
  const { x, y, width, height } = reference.bounds;
  const shifted: Bounds = { x: x + CASCADE_OFFSET, y: y + CASCADE_OFFSET, width, height };
  const area = displays.find((d) => titleBarVisible(reference.bounds, d.workArea))?.workArea;
  if (area && (shifted.x + width > area.x + area.width || shifted.y + height > area.y + area.height)) {
    return placeWindow({ bounds: { ...shifted, x: area.x, y: area.y }, maximized: reference.maximized }, displays);
  }
  return placeWindow({ bounds: shifted, maximized: reference.maximized }, displays);
}

/** Ob ein greifbares Stück der Kopfzeile im Bereich liegt. */
function titleBarVisible(window: Bounds, area: Bounds): boolean {
  const titleBar: Bounds = { ...window, height: Math.min(TITLE_BAR_HEIGHT, window.height) };
  const overlapWidth = Math.min(titleBar.x + titleBar.width, area.x + area.width) - Math.max(titleBar.x, area.x);
  const overlapHeight = Math.min(titleBar.y + titleBar.height, area.y + area.height) - Math.max(titleBar.y, area.y);
  return overlapWidth >= MIN_VISIBLE_TITLE_BAR.width && overlapHeight >= MIN_VISIBLE_TITLE_BAR.height;
}

/** Zentriert eine Grösse im Bereich; was grösser ist als der Bereich, wird auf ihn verkleinert. */
function centreIn(area: Bounds, size: { width: number; height: number }): Bounds {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return {
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height,
  };
}
