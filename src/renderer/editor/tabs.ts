// Regeln der Datei-Tabs ohne DOM und ohne Monaco, damit sie sich in Node prüfen lassen: Beschriftungen bei gleichen
// Dateinamen, Öffnen und Schliessen.

import { baseName, parentPath, pathKey } from '../project/filePaths';

/** Beschriftung eines Tabs: der Dateiname, bei gleichen Namen dazu der kürzeste unterscheidende Teil des Ordners. */
export interface TabLabel {
  name: string;
  /** Ordnerteil mit „/“, etwa „a“ oder „src/a“; fehlt, wenn der Name allein eindeutig ist. */
  hint?: string;
}

/**
 * Die Beschriftungen aller Tabs (Schlüssel ist `pathKey`). Bei gleichen Namen (ohne Gross-/Kleinschreibung) bekommt
 * jeder dieser Tabs so viele der letzten Ordner seines Pfads, dass kein anderer Tab mit diesem Namen denselben
 * Ordnerteil hat. Liegt eine Datei direkt im Projektordner, ist ihr Ordnerteil der Name des Projekts.
 */
export function tabLabels(paths: readonly string[], projectPath: string): Map<string, TabLabel> {
  const labels = new Map<string, TabLabel>();
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const nameKey = pathKey(baseName(p));
    groups.set(nameKey, [...(groups.get(nameKey) ?? []), p]);
  }
  for (const group of groups.values()) {
    if (group.length === 1) {
      labels.set(pathKey(group[0]), { name: baseName(group[0]) });
      continue;
    }
    const folders = group.map((p) => folderSegments(p, projectPath));
    group.forEach((p, i) => {
      const own = folders[i];
      let count = 1;
      // So viele Ordner von hinten, bis sich der Teil von dem aller anderen unterscheidet (höchstens alle eigenen).
      while (count < own.length && folders.some((other, j) => j !== i && sameTail(own, other, count))) count++;
      labels.set(pathKey(p), { name: baseName(p), hint: own.slice(-count).join('/') });
    });
  }
  return labels;
}

/** Die Ordner einer Datei relativ zum Projekt; direkt im Projektordner der Name des Projekts. */
function folderSegments(filePath: string, projectPath: string): string[] {
  const folder = parentPath(filePath);
  if (pathKey(folder) === pathKey(projectPath)) return [baseName(projectPath)];
  const inside = pathKey(folder).startsWith(`${pathKey(projectPath)}\\`);
  const relative = inside ? folder.slice(projectPath.length + 1) : folder;
  return relative.split('\\').filter((s) => s !== '');
}

/** Ob die letzten `count` Ordner von `own` dieselben sind wie in `other` (dort ebenso von hinten gezählt). */
function sameTail(own: readonly string[], other: readonly string[], count: number): boolean {
  const a = own.slice(-count).map(pathKey).join('\\');
  const b = other.slice(-Math.min(count, other.length)).map(pathKey).join('\\');
  return a === b;
}

/** Tabs nach dem Öffnen einer Datei: Ist sie schon offen, bleibt alles, sonst kommt sie ans Ende. */
export function withTab(tabs: readonly string[], target: string): string[] {
  return tabs.some((t) => pathKey(t) === pathKey(target)) ? [...tabs] : [...tabs, target];
}

/**
 * Tabs nach dem Schliessen eines Tabs und der dann aktive: Schliesst der aktive, wird wie in IntelliJ der links von
 * ihm aktiv, am Anfang der rechts von ihm.
 */
export function withoutTab(
  tabs: readonly string[],
  active: string | null,
  closing: string,
): { tabs: string[]; active: string | null } {
  const index = tabs.findIndex((t) => pathKey(t) === pathKey(closing));
  if (index < 0) return { tabs: [...tabs], active };
  const remaining = tabs.filter((_, i) => i !== index);
  if (active === null || pathKey(active) !== pathKey(closing)) return { tabs: remaining, active };
  if (remaining.length === 0) return { tabs: remaining, active: null };
  return { tabs: remaining, active: remaining[Math.max(0, index - 1)] };
}
