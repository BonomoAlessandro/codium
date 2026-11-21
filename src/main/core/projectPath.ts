// Projekte werden über ihren normalisierten absoluten Pfad identifiziert. Reine Rechnung ohne Dateizugriff;
// Abfragen auf Projektordnern stehen in folderQueries.ts. Lädt nie Electron.

import { createHash } from 'node:crypto';
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
 * Schlüssel eines Projekts ohne Dateizugriff: der normalisierte Pfad, unter Windows ohne Unterscheidung der
 * Gross-/Kleinschreibung. Kurznamen und Junctions bleiben dabei unaufgelöst; dafür gibt es
 * `FolderQueries.resolveKey`.
 */
export function lexicalProjectKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Anzeigename eines Projekts: der Name seines Ordners (beim Laufwerk der Pfad selbst). */
export function projectName(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return path.basename(normalized) || normalized;
}

/**
 * Dateiname des Projekt-Zustands aus dem Schlüssel des Projekts: lesbarer Ordnername plus kurzer Hash des
 * Schlüssels, damit gleichnamige Ordner an verschiedenen Orten nicht kollidieren. Weil er vom Schlüssel abhängt,
 * ergibt jede Schreibweise desselben Projekts denselben Namen.
 */
export function projectStateFileName(key: string): string {
  const readable = (path.basename(key) || 'project').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  return `${readable}-${hash}.json`;
}

/** Ein absoluter Pfad unter Windows: mit Laufwerk (`C:\`) oder als Freigabe (`\\server\share`). */
const WINDOWS_ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;

/**
 * Ob ein Wert aus einem Befehl ein absoluter Pfad ist. Ein relativer Pfad hinge vom Arbeitsordner des Hauptprozesses
 * ab, ein Pfad ohne Laufwerk wie `\foo` unter Windows vom Laufwerk dieses Arbeitsordners.
 */
export function isAbsoluteCommandPath(value: unknown): value is string {
  return typeof value === 'string' && (process.platform === 'win32' ? WINDOWS_ABSOLUTE.test(value) : path.isAbsolute(value));
}

/** Ob ein Schlüssel (siehe `lexicalProjectKey`) derselbe ist wie `root` oder darunter liegt. */
export function isKeyWithin(key: string, root: string): boolean {
  if (key === root) return true;
  return key.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function stripTrailingSeparators(resolved: string): string {
  const root = path.parse(resolved).root;
  let result = resolved;
  while (result.length > root.length && /[\\/]$/.test(result)) result = result.slice(0, -1);
  return result;
}
