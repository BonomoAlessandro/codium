// Projekte werden über ihren normalisierten absoluten Pfad identifiziert. Lädt nie Electron.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Normalisierter absoluter Pfad zur Anzeige und als Arbeitsordner: aufgelöst, mit den Trennern des Systems,
 * ohne abschliessenden Trenner (ausser beim Laufwerk selbst, etwa `C:\`). Die angegebene Schreibweise bleibt
 * erhalten; ein verbundenes Netzlaufwerk wie `Z:\proj` wird bewusst nicht zum UNC-Pfad, weil etwa cmd UNC-Pfade
 * als Arbeitsordner ablehnt.
 */
export function normalizeProjectPath(projectPath: string): string {
  return stripTrailingSeparators(path.resolve(projectPath));
}

/**
 * Schlüssel eines Projekts zum Vergleichen. Für einen vorhandenen Ordner ist es sein echter Pfad (Kurznamen wie
 * `ALESSA~1`, Junctions und symbolische Links aufgelöst), unter Windows ohne Unterscheidung der
 * Gross-/Kleinschreibung. Zwei Pfade bezeichnen genau dann dasselbe Projekt, wenn ihre Schlüssel gleich sind.
 */
export function projectKey(projectPath: string): string {
  let real = path.resolve(projectPath);
  try {
    real = fs.realpathSync.native(real);
  } catch {
    // Ordner fehlt oder ist nicht lesbar: beim aufgelösten Pfad bleiben.
  }
  const normalized = stripTrailingSeparators(real);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Ob der Projektordner da ist (ein Ordner, keine Datei). */
export function projectFolderExists(projectPath: string): boolean {
  try {
    return fs.statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

/** Anzeigename eines Projekts: der Name seines Ordners (beim Laufwerk der Pfad selbst). */
export function projectName(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return path.basename(normalized) || normalized;
}

/**
 * Dateiname des Projekt-Zustands: lesbarer Ordnername plus kurzer Hash des Schlüssels, damit gleichnamige
 * Ordner an verschiedenen Orten nicht kollidieren.
 */
export function projectStateFileName(projectPath: string): string {
  // Aus dem Schlüssel abgeleitet, damit jede Schreibweise desselben Projekts genau denselben Namen ergibt.
  const key = projectKey(projectPath);
  const readable = (path.basename(key) || 'project').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  return `${readable}-${hash}.json`;
}

function stripTrailingSeparators(resolved: string): string {
  const root = path.parse(resolved).root;
  let result = resolved;
  while (result.length > root.length && /[\\/]$/.test(result)) result = result.slice(0, -1);
  return result;
}
