// Projekte werden über ihren normalisierten absoluten Pfad identifiziert. Lädt nie Electron.
//
// Dateiabfragen auf Projektordnern laufen asynchron und mit Zeitlimit: Ein nicht erreichbares Netzlaufwerk darf
// den Hauptprozess nicht anhalten. Läuft das Zeitlimit ab, gilt der Ordner als nicht erreichbar.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Zeitlimit einer Dateiabfrage auf einem Projektordner. */
export const FOLDER_QUERY_TIMEOUT_MS = 2000;

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
 * Gross-/Kleinschreibung. Kurznamen und Junctions bleiben dabei unaufgelöst; dafür gibt es `resolveProjectKey`.
 */
export function lexicalProjectKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Schlüssel eines Projekts zum Vergleichen. Für einen erreichbaren Ordner ist es sein echter Pfad (Kurznamen wie
 * `ALESSA~1`, Junctions und symbolische Links aufgelöst), unter Windows ohne Unterscheidung der
 * Gross-/Kleinschreibung. Fehlt der Ordner oder antwortet er nicht innerhalb des Zeitlimits, ist es der
 * Schlüssel ohne Dateizugriff (`resolved: false`). Zwei Pfade bezeichnen dasselbe Projekt, wenn ihre Schlüssel
 * gleich sind.
 */
export async function resolveProjectKey(
  projectPath: string,
  timeoutMs = FOLDER_QUERY_TIMEOUT_MS,
): Promise<{ key: string; resolved: boolean }> {
  const real = await withTimeout(fs.promises.realpath(path.resolve(projectPath)), timeoutMs).catch(() => null);
  if (real === null) return { key: lexicalProjectKey(projectPath), resolved: false };
  return { key: lexicalProjectKey(real), resolved: true };
}

/** Ob der Projektordner da ist (ein Ordner, keine Datei) und innerhalb des Zeitlimits antwortet. */
export async function projectFolderExists(projectPath: string, timeoutMs = FOLDER_QUERY_TIMEOUT_MS): Promise<boolean> {
  const stats = await withTimeout(fs.promises.stat(projectPath), timeoutMs).catch(() => null);
  return stats?.isDirectory() ?? false;
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

function stripTrailingSeparators(resolved: string): string {
  const root = path.parse(resolved).root;
  let result = resolved;
  while (result.length > root.length && /[\\/]$/.test(result)) result = result.slice(0, -1);
  return result;
}

/** Wartet höchstens `timeoutMs` auf eine Abfrage; danach scheitert sie. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Keine Antwort nach ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
