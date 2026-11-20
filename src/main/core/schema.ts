// Gespeicherter Zustand, Schemaversion 1. Spätere Tickets ergänzen Felder; neue Felder sind optional oder
// bekommen einen Standardwert in den Funktionen unten, damit ältere Dateien gültig bleiben. Lädt nie Electron.

import type { Bounds } from './ports';

export const APP_STATE_FILE = 'state.json';
export const PROJECT_STATE_DIR = 'projects';
export const SCHEMA_VERSION = 1;

/** Einstellungen, die für alle Projekte gelten. Felder kommen mit den Tickets, die sie brauchen. */
export interface Settings {
  /** Shell fürs Terminal (Ticket 11); vom Testgerüst auf cmd gesetzt. */
  terminalShell?: string;
}

/** App-Zustand im Datenordner. */
export interface AppState {
  schemaVersion: 1;
  /** Zuletzt geöffnete Projekte, neueste zuerst. */
  recentProjects: string[];
  /** Projekte, die beim Beenden offen waren. */
  openProjects: string[];
  settings: Settings;
}

/** Zustand eines Projekts im Datenordner (nicht im Projektordner). */
export interface ProjectState {
  schemaVersion: 1;
  /** Normalisierter Pfad des Projekts, zur Kontrolle und für Menschen, die die Datei lesen. */
  path: string;
  /** Normale Lage und Grösse des Projektfensters (Ticket 02). */
  windowBounds?: Bounds;
}

export function emptyAppState(): AppState {
  return { schemaVersion: 1, recentProjects: [], openProjects: [], settings: {} };
}

export function emptyProjectState(projectPath: string): ProjectState {
  return { schemaVersion: 1, path: projectPath };
}

/** Eine Bounds-Angabe aus einer Datei ist nur brauchbar, wenn alle vier Werte endliche Zahlen sind. */
export function isBounds(value: unknown): value is Bounds {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]));
}
