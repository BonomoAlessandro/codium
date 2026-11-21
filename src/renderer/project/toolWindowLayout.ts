// Reine Logik der Werkzeugfenster ohne DOM, damit sie sich in Node prüfen lässt: welche es gibt, Öffnen,
// Schliessen und Wechseln, Wirkung der Tastenkürzel und die Grenzen der Grössen. Die Seite mit dem Code bleibt
// immer mindestens `CODE_MIN_WIDTH` × `CODE_MIN_HEIGHT` gross.

import { TOOL_WINDOW_SIDE, TOOL_WINDOW_SIDES, type ToolWindowId, type ToolWindowLayout, type ToolWindowSide } from '../../shared/types';
import { shortcutLabel, type KeyCommand } from '../keymap';

export interface ToolWindowDef {
  id: ToolWindowId;
  title: string;
  /** Tastenkürzel zur Anzeige, falls es eines gibt. */
  shortcut?: string;
  /** Platzhalter, bis das Werkzeugfenster mit seinem Ticket Inhalt bekommt. */
  placeholder: string;
}

function def(id: ToolWindowId, title: string, placeholder: string): ToolWindowDef {
  const shortcut = id === 'database' ? undefined : shortcutLabel(`toolWindow.${id}` as KeyCommand);
  return { id, title, placeholder, ...(shortcut ? { shortcut } : {}) };
}

export const TOOL_WINDOWS: Record<ToolWindowId, ToolWindowDef> = {
  project: def('project', 'Project', 'The project files will appear here.'),
  commit: def('commit', 'Commit', 'Changed files will appear here.'),
  terminal: def('terminal', 'Terminal', 'Terminals will appear here.'),
  git: def('git', 'Git', 'The Git log will appear here.'),
  find: def('find', 'Find', 'Search results will appear here.'),
  database: def('database', 'Database', 'Database connections will appear here.'),
};

/**
 * Die Symbolleisten wie im neuen IntelliJ: Die linke trägt oben die Werkzeugfenster der linken Seite und unten die
 * der unteren Seite (die „untere Symbolleiste“), die rechte die der rechten Seite.
 */
export const STRIPES: { left: { top: ToolWindowId[]; bottom: ToolWindowId[] }; right: { top: ToolWindowId[] } } = {
  left: { top: ['project', 'commit'], bottom: ['terminal', 'git', 'find'] },
  right: { top: ['database'] },
};

/** Mindestbreite eines Werkzeugfensters links oder rechts. */
export const SIDE_MIN_SIZE = 150;
/** Mindesthöhe des unteren Werkzeugfensters. */
export const BOTTOM_MIN_SIZE = 100;
/** So breit und so hoch bleibt der Code-Bereich mindestens, wenn Werkzeugfenster wachsen. */
export const CODE_MIN_WIDTH = 240;
export const CODE_MIN_HEIGHT = 120;

/** Ob ein Werkzeugfenster gerade verfügbar ist („Find“ nur, solange es Trefferlisten gibt). */
export type Availability = (id: ToolWindowId) => boolean;

/** Alle Werkzeugfenster einer Seite, in der Reihenfolge der Symbolleiste. */
export function toolWindowsOn(side: ToolWindowSide): ToolWindowId[] {
  return (Object.keys(TOOL_WINDOW_SIDE) as ToolWindowId[]).filter((id) => TOOL_WINDOW_SIDE[id] === side);
}

/**
 * Das Layout, wie es sich zeigt: Ist das aktive Werkzeugfenster einer Seite nicht verfügbar (etwa „Find“ nach einem
 * Neustart, ohne Trefferlisten), ist die Seite zu, mit dem ersten verfügbaren Werkzeugfenster als aktivem.
 */
export function visibleLayout(layout: ToolWindowLayout, available: Availability): ToolWindowLayout {
  const result = structuredClone(layout);
  for (const side of TOOL_WINDOW_SIDES) {
    if (available(result[side].active)) continue;
    const fallback = toolWindowsOn(side).find(available);
    result[side] = { ...result[side], open: false, ...(fallback ? { active: fallback } : {}) };
  }
  return result;
}

/** Ob ein Werkzeugfenster sichtbar ist. */
export function isShown(layout: ToolWindowLayout, id: ToolWindowId): boolean {
  const side = layout[TOOL_WINDOW_SIDE[id]];
  return side.open && side.active === id;
}

/** Zeigt ein Werkzeugfenster; ein anderes auf derselben Seite verschwindet dafür. */
export function showToolWindow(layout: ToolWindowLayout, id: ToolWindowId): ToolWindowLayout {
  const side = TOOL_WINDOW_SIDE[id];
  return { ...layout, [side]: { ...layout[side], active: id, open: true } };
}

/** Schliesst das Werkzeugfenster einer Seite; es bleibt das aktive, das nächste Öffnen der Seite zeigt es wieder. */
export function hideSide(layout: ToolWindowLayout, side: ToolWindowSide): ToolWindowLayout {
  return { ...layout, [side]: { ...layout[side], open: false } };
}

/** Klick auf ein Symbol der Symbolleiste: schliesst das Werkzeugfenster, wenn es sichtbar ist, sonst zeigt es dieses. */
export function toggleToolWindow(layout: ToolWindowLayout, id: ToolWindowId): ToolWindowLayout {
  return isShown(layout, id) ? hideSide(layout, TOOL_WINDOW_SIDE[id]) : showToolWindow(layout, id);
}

export type ShortcutAction = 'show' | 'focus' | 'hide' | 'none';

/**
 * Wirkung des Kürzels eines Werkzeugfensters, wie in IntelliJ: Ein verborgenes zeigen (der Fokus geht hinein), in ein
 * sichtbares ohne Fokus den Fokus setzen, ein sichtbares mit Fokus schliessen. Nicht verfügbare bleiben unberührt.
 */
export function shortcutAction(
  layout: ToolWindowLayout,
  id: ToolWindowId,
  focusInside: boolean,
  available: Availability,
): ShortcutAction {
  if (!available(id)) return 'none';
  if (!isShown(layout, id)) return 'show';
  return focusInside ? 'hide' : 'focus';
}

/** Die Fläche zwischen den Symbolleisten, unter der Kopfzeile und über der Statusleiste, in Pixeln. */
export interface LayoutArea {
  width: number;
  height: number;
}

/** Angezeigte Grössen der Werkzeugfenster in Pixeln; 0 für eine geschlossene Seite. */
export interface PanelSizes {
  left: number;
  right: number;
  bottom: number;
}

/** Die Seite links oder rechts, die bei Platzmangel Vorrang hat: die zuletzt gezogene. */
export type WidthPriority = 'left' | 'right' | null;

/**
 * Die angezeigten Grössen: die gespeicherten, aber nie unter der Mindestgrösse und nie so gross, dass der Code-Bereich
 * kleiner würde als seine Mindestgrösse. Reicht der Platz nicht für links und rechts zusammen (etwa in einem
 * verkleinerten oder halb angedockten Fenster), weicht wie in IntelliJ zuerst die Seite, die nicht zuletzt gezogen wurde,
 * bis zu ihrer Mindestbreite, erst dann die zuletzt gezogene. Ohne zuletzt gezogene Seite schrumpfen beide anteilig.
 * Die gespeicherten Grössen bleiben dabei, wie sie sind; im grösseren Fenster zeigen sie sich wieder. Unten gibt es
 * keine Gegenseite: Das untere Werkzeugfenster wird nur auf die Höhe begrenzt, die der Code-Bereich übrig lässt.
 */
export function panelSizes(layout: ToolWindowLayout, area: LayoutArea, priority: WidthPriority = null): PanelSizes {
  const bottom = layout.bottom.open
    ? clamp(layout.bottom.size, BOTTOM_MIN_SIZE, Math.max(BOTTOM_MIN_SIZE, area.height - CODE_MIN_HEIGHT))
    : 0;
  const left = layout.left.open ? Math.max(layout.left.size, SIDE_MIN_SIZE) : 0;
  const right = layout.right.open ? Math.max(layout.right.size, SIDE_MIN_SIZE) : 0;
  const available = area.width - CODE_MIN_WIDTH;
  if (left + right <= available) return { left, right, bottom };
  if (left > 0 && right > 0 && priority !== null) {
    // Zuerst weicht die andere Seite bis zur Mindestbreite, dann die bevorzugte.
    const preferred = priority === 'left' ? left : right;
    const preferredShown = Math.min(preferred, Math.max(SIDE_MIN_SIZE, available - SIDE_MIN_SIZE));
    const otherShown = Math.max(SIDE_MIN_SIZE, available - preferredShown);
    return priority === 'left'
      ? { left: preferredShown, right: otherShown, bottom }
      : { left: otherShown, right: preferredShown, bottom };
  }
  // Was über der Mindestgrösse liegt, schrumpft bei beiden im selben Verhältnis (oder bei der einzigen offenen Seite).
  const minimum = (left > 0 ? SIDE_MIN_SIZE : 0) + (right > 0 ? SIDE_MIN_SIZE : 0);
  const flexible = (left > 0 ? left - SIDE_MIN_SIZE : 0) + (right > 0 ? right - SIDE_MIN_SIZE : 0);
  const factor = flexible > 0 ? clamp((available - minimum) / flexible, 0, 1) : 0;
  const shrink = (size: number) => (size > 0 ? Math.floor(SIDE_MIN_SIZE + (size - SIDE_MIN_SIZE) * factor) : 0);
  return { left: shrink(left), right: shrink(right), bottom };
}

/**
 * Mindest- und Höchstgrösse einer Seite beim Ziehen. Die Höchstgrösse lässt dem Code-Bereich seine Mindestgrösse; eine
 * offene Gegenseite darf dabei bis auf ihre Mindestbreite verdrängt werden, wie in IntelliJ.
 */
export function sizeLimits(side: ToolWindowSide, layout: ToolWindowLayout, area: LayoutArea): { min: number; max: number } {
  if (side === 'bottom') return { min: BOTTOM_MIN_SIZE, max: Math.max(BOTTOM_MIN_SIZE, area.height - CODE_MIN_HEIGHT) };
  const opposite = side === 'left' ? 'right' : 'left';
  const displaced = layout[opposite].open ? SIDE_MIN_SIZE : 0;
  return { min: SIDE_MIN_SIZE, max: Math.max(SIDE_MIN_SIZE, area.width - CODE_MIN_WIDTH - displaced) };
}

/** Die Grösse beim Ziehen an einer Trennlinie: die verlangte, begrenzt auf Mindest- und Höchstgrösse, ganze Pixel. */
export function dragSize(side: ToolWindowSide, requested: number, layout: ToolWindowLayout, area: LayoutArea): number {
  const { min, max } = sizeLimits(side, layout, area);
  return Math.round(clamp(requested, min, max));
}

/** Ein Ziehen an der Trennlinie einer Seite, vom Beginn an. */
export interface Resize {
  side: ToolWindowSide;
  /** Angezeigte Grösse der gezogenen Seite zu Beginn: Gezogen wird von dem aus, was zu sehen ist. */
  startSize: number;
  /** Das gespeicherte Layout zu Beginn. */
  stored: ToolWindowLayout;
}

/** Beginnt das Ziehen an einer Trennlinie, bei der bisherigen Vorrang-Seite (`priority`) für die angezeigte Grösse. */
export function beginResize(layout: ToolWindowLayout, side: ToolWindowSide, area: LayoutArea, priority: WidthPriority): Resize {
  return { side, startSize: panelSizes(layout, area, priority)[side], stored: layout };
}

/**
 * Das zu speichernde Layout, wenn das Ziehen bei der verlangten Grösse ist: Nur die gezogene Seite bekommt ihre neue
 * Grösse, die Gegenseite behält ihre gespeicherte. Angezeigt wird es mit der gezogenen Seite als Vorrang-Seite
 * (`panelSizes(…, side)`); so steht die gezogene Breite auch nach dem Loslassen, und die Gegenseite weicht, höchstens
 * bis zu ihrer Mindestbreite.
 */
export function resizeTo(resize: Resize, requested: number, area: LayoutArea): ToolWindowLayout {
  const { side, stored } = resize;
  const size = dragSize(side, requested, stored, area);
  return { ...stored, [side]: { ...stored[side], size } };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
