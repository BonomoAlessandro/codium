// Gespeicherter Zustand, Schemaversion 1. Spätere Tickets ergänzen Felder; neue Felder sind optional oder
// bekommen einen Standardwert in den Funktionen unten, damit ältere Dateien gültig bleiben. Lädt nie Electron.
//
// Wichtig für die erste echte Schemaänderung (Version 2): Sie muss eine Übernahme aus Version 1 mitbringen.
// Ohne sie legt StateFile jede Datei mit Version 1 als kaputt beiseite.

import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  TOOL_WINDOW_SIDE,
  TOOL_WINDOW_SIDES,
  isToolWindowId,
  type AppSettings,
  type CursorState,
  type ToolWindowLayout,
  type ToolWindowSide,
  type ToolWindowSideLayout,
} from '../../shared/types';
import type { Bounds, WindowPlacement } from './ports';

export const APP_STATE_FILE = 'state.json';
export const PROJECT_STATE_DIR = 'projects';
export const SCHEMA_VERSION = 1;
/** Höchstzahl der zuletzt geöffneten Projekte. */
export const RECENT_PROJECTS_LIMIT = 20;

/** Einstellungen, die für alle Projekte gelten. Felder kommen mit den Tickets, die sie brauchen. */
export interface Settings {
  /** Shell fürs Terminal (Ticket 11); vom Testgerüst auf cmd gesetzt. */
  terminalShell?: string;
  /** Schriftgrösse der Editoren; ohne Angabe `DEFAULT_FONT_SIZE`. */
  fontSize?: number;
  /** JDK für den Java-Sprachserver (Ordner); ohne Angabe „Newest detected“. */
  jdk?: string;
}

/** App-Zustand im Datenordner. */
export interface AppState {
  schemaVersion: 1;
  /** Zuletzt geöffnete Projekte, neueste zuerst, höchstens `RECENT_PROJECTS_LIMIT`. */
  recentProjects: string[];
  /**
   * Projekte, die beim Beenden offen waren, in der Reihenfolge des Öffnens. Der Kern führt die Liste laufend
   * nach: Ein geöffnetes Projekt kommt dazu, ein Fenster, das neben anderen geschlossen wird, fällt heraus.
   */
  openProjects: string[];
  settings: Settings;
  /** Lage des Willkommensfensters. */
  welcomeWindow?: WindowPlacement;
  /** Der zuletzt gewählte Elternordner beim Klonen. */
  cloneParent?: string;
}

/** Zustand eines Projekts im Datenordner (nicht im Projektordner). */
export interface ProjectState {
  schemaVersion: 1;
  /** Normalisierter Pfad des Projekts, zur Kontrolle und für Menschen, die die Datei lesen. */
  path: string;
  /** Lage des Projektfensters. */
  window?: WindowPlacement;
  /** Layout der Werkzeugfenster; ohne Angabe gilt `defaultLayout()`. */
  layout?: ToolWindowLayout;
  /**
   * Aufgeklappte Ordner im Dateibaum, relativ zum Projektordner mit „/“ getrennt; der Projektordner selbst ist der
   * leere Pfad. Ohne Angabe ist nur der Projektordner aufgeklappt.
   */
  expandedFolders?: string[];
  /**
   * Offene Datei-Tabs in ihrer Reihenfolge, relativ zum Projektordner mit „/“ getrennt (wie `expandedFolders`). Ohne
   * Angabe sind keine Tabs offen.
   */
  tabs?: string[];
  /** Der aktive Tab, einer aus `tabs`. */
  activeTab?: string;
  /** Wie viele der ersten `tabs` angeheftet sind; ohne Angabe keiner. */
  pinnedTabs?: number;
  /** Zuletzt geöffnete Dateien (Ctrl + E), neueste zuerst, relativ wie `tabs`; höchstens `MAX_RECENT_FILES`. */
  recentFiles?: string[];
  /**
   * Cursor und Scrollstand je Datei, Schlüssel wie bei `tabs` (unter Windows klein geschrieben, damit eine andere
   * Schreibweise derselben Datei keinen zweiten Eintrag anlegt). Die zuletzt geänderten stehen am Ende; es bleiben
   * höchstens `MAX_CURSORS`.
   */
  cursors?: Record<string, CursorState>;
}

/** Höchstzahl gespeicherter Tabs. */
export const MAX_TABS = 1000;
/** Höchstzahl Dateien, deren Cursor sich der Projekt-Zustand merkt. */
export const MAX_CURSORS = 500;
/** Höchstzahl zuletzt geöffneter Dateien im Projekt-Zustand. */
export const MAX_RECENT_FILES = 50;

/** Die Einstellungen für die Oberfläche: gespeicherte Werte, sonst die Standardwerte. */
export function appSettings(settings: Settings): AppSettings {
  return { fontSize: settings.fontSize ?? DEFAULT_FONT_SIZE, jdk: settings.jdk ?? null };
}

/** Ob eine Schriftgrösse gültig ist: eine ganze Zahl von `MIN_FONT_SIZE` bis `MAX_FONT_SIZE`. */
export function isFontSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE;
}

/** Ob ein JDK-Ordner als Einstellung taugt: ein absoluter Windows-Pfad. */
export function isJdkPath(value: unknown): value is string {
  return typeof value === 'string' && /^([a-z]:[\\/]|\\\\)/i.test(value) && value.length < 1000;
}

/** Ein Cursor aus unbekannter Quelle: Zeile und Spalte ganze Zahlen ab 1, Scrollstand endlich und nicht negativ. */
export function parseCursor(value: unknown): CursorState | undefined {
  if (!isRecord(value)) return undefined;
  const { line, column, scrollTop } = value;
  if (!isPositiveInteger(line) || !isPositiveInteger(column)) return undefined;
  if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop) || scrollTop < 0) return undefined;
  return { line, column, scrollTop: Math.round(scrollTop) };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Höchstzahl gespeicherter aufgeklappter Ordner. */
export const MAX_EXPANDED_FOLDERS = 10_000;

/** Grösste Grösse eines Werkzeugfensters in Pixeln, die der Kern annimmt; die Oberfläche begrenzt enger. */
export const MAX_TOOL_WINDOW_SIZE = 10_000;

/** Layout eines Projekts ohne gespeichertes: links „Project“ offen, unten „Terminal“ und rechts „Database“ zu. */
export function defaultLayout(): ToolWindowLayout {
  return {
    left: { active: 'project', open: true, size: 280 },
    bottom: { active: 'terminal', open: false, size: 260 },
    right: { active: 'database', open: false, size: 320 },
  };
}

/**
 * Prüft ein vollständiges Layout aus unbekannter Quelle (Befehl `project.setLayout`): `undefined`, sobald eine Seite
 * fehlt oder nicht passt. Grössen werden auf ganze Pixel gerundet.
 */
export function parseLayout(value: unknown): ToolWindowLayout | undefined {
  if (!isRecord(value)) return undefined;
  const sides: Partial<ToolWindowLayout> = {};
  for (const side of TOOL_WINDOW_SIDES) {
    const parsed = parseSideLayout(side, value[side]);
    if (!parsed) return undefined;
    sides[side] = parsed;
  }
  return sides as ToolWindowLayout;
}

/** Ein Layout aus der Zustandsdatei: Unbrauchbare Seiten bekommen den Standard; `undefined`, wenn das Feld fehlt. */
function normalizeLayout(value: unknown): ToolWindowLayout | undefined {
  if (!isRecord(value)) return undefined;
  const defaults = defaultLayout();
  const layout = { ...defaults };
  for (const side of TOOL_WINDOW_SIDES) layout[side] = parseSideLayout(side, value[side]) ?? defaults[side];
  return layout;
}

/** Eine Seite: ein Werkzeugfenster dieser Seite, offen ja oder nein, eine Grösse von 1 bis `MAX_TOOL_WINDOW_SIZE`. */
function parseSideLayout(side: ToolWindowSide, value: unknown): ToolWindowSideLayout | undefined {
  if (!isRecord(value)) return undefined;
  const { active, open, size } = value;
  if (!isToolWindowId(active) || TOOL_WINDOW_SIDE[active] !== side) return undefined;
  if (typeof open !== 'boolean') return undefined;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 1 || size > MAX_TOOL_WINDOW_SIZE) return undefined;
  return { active, open, size: Math.round(size) };
}

export function emptyAppState(): AppState {
  return { schemaVersion: 1, recentProjects: [], openProjects: [], settings: {} };
}

export function emptyProjectState(projectPath: string): ProjectState {
  return { schemaVersion: 1, path: projectPath };
}

/** Prüft die Felder eines gelesenen App-Zustands; Ungültiges wird durch den Standardwert ersetzt. */
export function normalizeAppState(raw: Record<string, unknown>): AppState {
  const settings = isRecord(raw.settings) ? raw.settings : {};
  const welcomeWindow = placement(raw.welcomeWindow);
  return {
    schemaVersion: 1,
    recentProjects: stringArray(raw.recentProjects).slice(0, RECENT_PROJECTS_LIMIT),
    openProjects: stringArray(raw.openProjects),
    settings: {
      ...(typeof settings.terminalShell === 'string' ? { terminalShell: settings.terminalShell } : {}),
      ...(isFontSize(settings.fontSize) ? { fontSize: settings.fontSize } : {}),
      ...(isJdkPath(settings.jdk) ? { jdk: settings.jdk } : {}),
    },
    ...(welcomeWindow ? { welcomeWindow } : {}),
    ...(typeof raw.cloneParent === 'string' && raw.cloneParent !== '' ? { cloneParent: raw.cloneParent } : {}),
  };
}

/** Prüft die Felder eines gelesenen Projekt-Zustands; Ungültiges wird durch den Standardwert ersetzt. */
export function normalizeProjectState(projectPath: string, raw: Record<string, unknown>): ProjectState {
  const window = placement(raw.window);
  const layout = normalizeLayout(raw.layout);
  const expandedFolders = Array.isArray(raw.expandedFolders)
    ? stringArray(raw.expandedFolders).filter(isRelativeFolder).slice(0, MAX_EXPANDED_FOLDERS)
    : undefined;
  // Ohne Doppelte (unter Windows auch ohne solche, die sich nur in der Schreibweise unterscheiden); sonst lehnte der
  // Kern jedes spätere Speichern der Tabs ab (Review von Ticket 05).
  const seenTabs = new Set<string>();
  const tabs = Array.isArray(raw.tabs)
    ? stringArray(raw.tabs)
        .filter((t) => {
          const key = process.platform === 'win32' ? t.toLowerCase() : t;
          if (t === '' || !isRelativeFolder(t) || seenTabs.has(key)) return false;
          seenTabs.add(key);
          return true;
        })
        .slice(0, MAX_TABS)
    : undefined;
  const activeTab = typeof raw.activeTab === 'string' && tabs?.includes(raw.activeTab) ? raw.activeTab : undefined;
  const pinnedTabs =
    tabs && typeof raw.pinnedTabs === 'number' && Number.isInteger(raw.pinnedTabs) && raw.pinnedTabs > 0
      ? Math.min(raw.pinnedTabs, tabs.length)
      : undefined;
  const cursors = normalizeCursors(raw.cursors);
  const seenRecent = new Set<string>();
  const recentFiles = Array.isArray(raw.recentFiles)
    ? stringArray(raw.recentFiles)
        .filter((r) => {
          const key = process.platform === 'win32' ? r.toLowerCase() : r;
          if (r === '' || !isRelativeFolder(r) || seenRecent.has(key)) return false;
          seenRecent.add(key);
          return true;
        })
        .slice(0, MAX_RECENT_FILES)
    : undefined;
  return {
    schemaVersion: 1,
    path: projectPath,
    ...(window ? { window } : {}),
    ...(layout ? { layout } : {}),
    ...(expandedFolders ? { expandedFolders } : {}),
    ...(tabs ? { tabs } : {}),
    ...(activeTab !== undefined ? { activeTab } : {}),
    ...(pinnedTabs !== undefined ? { pinnedTabs } : {}),
    ...(cursors ? { cursors } : {}),
    ...(recentFiles ? { recentFiles } : {}),
  };
}

/** Die gespeicherten Cursor: nur gültige Einträge mit relativem Pfad, höchstens die letzten `MAX_CURSORS`. */
function normalizeCursors(value: unknown): Record<string, CursorState> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, cursor]): Array<[string, CursorState]> => {
    const parsed = parseCursor(cursor);
    return parsed && key !== '' && isRelativeFolder(key) ? [[key, parsed]] : [];
  });
  return Object.fromEntries(entries.slice(-MAX_CURSORS));
}

/** Ein relativer Pfad aus der Zustandsdatei: mit „/“ getrennt, ohne Laufwerk, ohne leere Teile, `.` oder `..`. */
function isRelativeFolder(value: string): boolean {
  if (value === '') return true;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !/[\\:]/.test(segment));
}

/** Eine Bounds-Angabe aus einer Datei ist nur brauchbar, wenn alle vier Werte endliche Zahlen sind. */
export function isBounds(value: unknown): value is Bounds {
  if (!isRecord(value)) return false;
  return ['x', 'y', 'width', 'height'].every((k) => typeof value[k] === 'number' && Number.isFinite(value[k]));
}

/** Eine gespeicherte Fensterlage, oder `undefined`, wenn sie fehlt oder unbrauchbar ist (etwa Grösse null). */
function placement(value: unknown): WindowPlacement | undefined {
  if (!isRecord(value) || !isBounds(value.bounds)) return undefined;
  const { x, y, width, height } = value.bounds;
  if (width < 1 || height < 1) return undefined;
  return { bounds: { x, y, width, height }, maximized: value.maximized === true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
