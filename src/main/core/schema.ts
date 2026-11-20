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

/** Prüft die Felder eines gelesenen App-Zustands; Ungültiges wird durch den Standardwert ersetzt. */
export function normalizeAppState(raw: Record<string, unknown>): AppState {
  const settings = isRecord(raw.settings) ? raw.settings : {};
  return {
    schemaVersion: 1,
    recentProjects: stringArray(raw.recentProjects),
    openProjects: stringArray(raw.openProjects),
    settings: {
      ...(typeof settings.terminalShell === 'string' ? { terminalShell: settings.terminalShell } : {}),
    },
  };
}

/** Prüft die Felder eines gelesenen Projekt-Zustands; Ungültiges wird durch den Standardwert ersetzt. */
export function normalizeProjectState(projectPath: string, raw: Record<string, unknown>): ProjectState {
  return {
    schemaVersion: 1,
    path: projectPath,
    ...(isBounds(raw.windowBounds) ? { windowBounds: raw.windowBounds } : {}),
  };
}

/** Eine Bounds-Angabe aus einer Datei ist nur brauchbar, wenn alle vier Werte endliche Zahlen sind. */
export function isBounds(value: unknown): value is Bounds {
  if (!isRecord(value)) return false;
  return ['x', 'y', 'width', 'height'].every((k) => typeof value[k] === 'number' && Number.isFinite(value[k]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
