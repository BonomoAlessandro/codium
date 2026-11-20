// Gespeicherter Zustand, Schemaversion 1. Spätere Tickets ergänzen Felder; neue Felder sind optional oder
// bekommen einen Standardwert in den Funktionen unten, damit ältere Dateien gültig bleiben. Lädt nie Electron.
//
// Wichtig für die erste echte Schemaänderung (Version 2): Sie muss eine Übernahme aus Version 1 mitbringen.
// Ohne sie legt StateFile jede Datei mit Version 1 als kaputt beiseite.

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
}

/** Zustand eines Projekts im Datenordner (nicht im Projektordner). */
export interface ProjectState {
  schemaVersion: 1;
  /** Normalisierter Pfad des Projekts, zur Kontrolle und für Menschen, die die Datei lesen. */
  path: string;
  /** Lage des Projektfensters. */
  window?: WindowPlacement;
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
    },
    ...(welcomeWindow ? { welcomeWindow } : {}),
  };
}

/** Prüft die Felder eines gelesenen Projekt-Zustands; Ungültiges wird durch den Standardwert ersetzt. */
export function normalizeProjectState(projectPath: string, raw: Record<string, unknown>): ProjectState {
  const window = placement(raw.window);
  return {
    schemaVersion: 1,
    path: projectPath,
    ...(window ? { window } : {}),
  };
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
