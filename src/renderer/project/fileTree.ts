// Reine Logik des Dateibaums ohne DOM, damit sie sich in Node prüfen lässt: welche Zeilen sichtbar sind, was eine
// Taste bewirkt (wie in IntelliJ) und wie Auswahl und aufgeklappte Ordner Umbenennen und Löschen überstehen.

import type { FileEntry } from '../../shared/types';
import { isSameOrInside, movedPath, parentPath, pathKey } from './filePaths';

/** Ein gelesener Ordner: sein Pfad und seine Einträge in der Reihenfolge des Kerns. */
export interface Listing {
  path: string;
  entries: FileEntry[];
}

/** Eine sichtbare Zeile des Baums. */
export interface TreeRow {
  path: string;
  key: string;
  name: string;
  depth: number;
  /** Ein Ordner, der sich aufklappen lässt (ein Link nach draussen oder ein toter Link nicht). */
  isDirectory: boolean;
  isRoot: boolean;
  expanded: boolean;
  /** Aufgeklappt, aber der Inhalt ist noch nicht gelesen. */
  loading: boolean;
  /** Ein Link, dem Codium nicht folgt (siehe `FileEntry.blockedLink`). */
  blockedLink?: 'outside' | 'missing';
}

/**
 * Die sichtbaren Zeilen: der Projektordner, darunter der Inhalt jedes aufgeklappten Ordners, dessen Inhalt schon
 * gelesen ist. Ein aufgeklappter Ordner, dessen Eltern zugeklappt sind, ist nicht sichtbar; das Zuklappen nimmt
 * solche Ordner aus den aufgeklappten (`collapseFolder`, Ticket 29). Ordner in `unavailable` (gerade nicht lesbar)
 * erscheinen zugeklappt, bleiben aber unter den aufgeklappten.
 */
export function visibleRows(
  root: string,
  rootName: string,
  listings: ReadonlyMap<string, Listing>,
  expanded: ReadonlyMap<string, string>,
  unavailable: ReadonlySet<string> = new Set(),
): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (entry: Pick<FileEntry, 'path' | 'name' | 'isDirectory' | 'blockedLink'>, depth: number) => {
    const key = pathKey(entry.path);
    const isDirectory = entry.isDirectory && !entry.blockedLink;
    const isExpanded = isDirectory && expanded.has(key) && !unavailable.has(key);
    const listing = isExpanded ? listings.get(key) : undefined;
    rows.push({
      path: entry.path,
      key,
      name: entry.name,
      depth,
      isDirectory,
      isRoot: depth === 0,
      expanded: isExpanded,
      loading: isExpanded && !listing,
      ...(entry.blockedLink ? { blockedLink: entry.blockedLink } : {}),
    });
    if (listing) for (const child of listing.entries) visit(child, depth + 1);
  };
  visit({ path: root, name: rootName, isDirectory: true }, 0);
  return rows;
}

/** Was eine Taste im Baum bewirkt. */
export type TreeKeyAction =
  /** Die Zeile wird zur aktuellen; mit `extend` wächst die Auswahl bis dorthin (Shift). */
  | { type: 'move'; index: number; extend: boolean }
  | { type: 'expand'; index: number }
  | { type: 'collapse'; index: number }
  /** Enter auf einer Datei: „Datei öffnen“. */
  | { type: 'open'; index: number };

/**
 * Was eine Taste bewirkt, wie in IntelliJ. `lead` ist die aktuelle Zeile (-1: keine), `pageSize` die Zahl der Zeilen
 * einer Seite.
 * - Pfeil hoch/runter, Pos1, Ende, Bild hoch/runter: andere Zeile, mit Shift die Auswahl erweitern.
 * - Pfeil rechts: zugeklappten Ordner aufklappen, beim aufgeklappten zum ersten Eintrag.
 * - Pfeil links: aufgeklappten Ordner zuklappen, sonst zum Elternordner.
 * - Enter: Ordner auf- oder zuklappen, Datei öffnen.
 */
export function treeKey(key: string, shift: boolean, rows: readonly TreeRow[], lead: number, pageSize: number): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const last = rows.length - 1;
  const move = (index: number): TreeKeyAction => ({ type: 'move', index: clamp(index, 0, last), extend: shift });
  if (lead < 0 || lead > last) {
    return ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key) ? move(key === 'End' ? last : 0) : null;
  }
  const row = rows[lead];
  switch (key) {
    case 'ArrowDown':
      return move(lead + 1);
    case 'ArrowUp':
      return move(lead - 1);
    case 'Home':
      return move(0);
    case 'End':
      return move(last);
    case 'PageDown':
      return move(lead + Math.max(1, pageSize - 1));
    case 'PageUp':
      return move(lead - Math.max(1, pageSize - 1));
    case 'ArrowRight':
      if (!row.isDirectory) return null;
      if (!row.expanded) return { type: 'expand', index: lead };
      return rows[lead + 1]?.depth === row.depth + 1 ? { type: 'move', index: lead + 1, extend: false } : null;
    case 'ArrowLeft': {
      if (row.isDirectory && row.expanded) return { type: 'collapse', index: lead };
      const parent = parentRow(rows, lead);
      return parent === -1 ? null : { type: 'move', index: parent, extend: false };
    }
    case 'Enter':
      if (!row.isDirectory) return { type: 'open', index: lead };
      return row.expanded ? { type: 'collapse', index: lead } : { type: 'expand', index: lead };
    default:
      return null;
  }
}

/** Die Zeile des Elternordners, -1 beim Projektordner. */
export function parentRow(rows: readonly TreeRow[], index: number): number {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < depth) return i;
  return -1;
}

/** Die Schlüssel der Zeilen von `from` bis `to` (in beide Richtungen). */
export function rangeKeys(rows: readonly TreeRow[], from: number, to: number): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return rows.slice(Math.max(0, a), b + 1).map((r) => r.key);
}

/** Ein Pfad-Verzeichnis (Schlüssel → Pfad) ohne `target` und alles darunter; `keep` behält einzelne Schlüssel. */
export function withoutSubtree<V>(map: ReadonlyMap<string, V>, target: string, keep?: string): Map<string, V> {
  const result = new Map<string, V>();
  for (const [key, value] of map) if (key === keep || !isSameOrInside(key, target)) result.set(key, value);
  return result;
}

/**
 * Zuklappen (Ticket 29): Der Ordner und alle aufgeklappten Ordner darin gelten danach als zugeklappt, wie im
 * Branch-Menü. Klappt der Nutzer ihn wieder auf, ist nur die erste Ebene offen. Unverändert (dasselbe Objekt), wenn
 * nichts darunter aufgeklappt war.
 */
export function collapseFolder(expanded: ReadonlyMap<string, string>, folder: string): ReadonlyMap<string, string> {
  for (const key of expanded.keys()) if (isSameOrInside(key, folder)) return withoutSubtree(expanded, folder);
  return expanded;
}

/**
 * Die aufgeklappten Ordner ohne die, unter deren Eltern einer zugeklappt ist; der Projektordner zählt mit. Ein
 * gespeicherter Zustand von vor Ticket 29 kann solche Ordner enthalten, weil das Zuklappen sie damals behielt; sie
 * wären beim nächsten Aufklappen der Eltern wieder offen. Pfade ausserhalb des Projekts bleiben, wie sie sind.
 * Unverändert (dasselbe Objekt), wenn nichts wegfällt.
 */
export function withoutHiddenFolders(expanded: ReadonlyMap<string, string>, root: string): ReadonlyMap<string, string> {
  const rootKey = pathKey(root);
  const hidden = (key: string) => {
    if (key === rootKey || !isSameOrInside(key, rootKey)) return false;
    for (let dir = parentPath(key); ; dir = parentPath(dir)) {
      if (!expanded.has(dir)) return true;
      if (dir === rootKey || parentPath(dir) === dir) return false;
    }
  };
  const keys = [...expanded.keys()].filter(hidden);
  if (keys.length === 0) return expanded;
  const result = new Map(expanded);
  for (const key of keys) result.delete(key);
  return result;
}

/** Eine Liste von Pfaden nach dem Umbenennen von `from` in `to` bzw. ohne den gelöschten `deleted` samt Inhalt. */
export function followPaths(paths: readonly string[], change: { from: string; to: string } | { deleted: string }): string[] {
  if ('deleted' in change) return paths.filter((p) => !isSameOrInside(p, change.deleted));
  return paths.map((p) => (isSameOrInside(p, change.from) ? movedPath(p, change.from, change.to) : p));
}

/**
 * Nach dem Umbenennen von `from` in `to`: Schlüssel unter `from` wandern nach `to`. `rewrite` passt den Wert an und
 * bekommt dafür eine Funktion, die einen Pfad unter `from` nach `to` verlegt.
 */
export function moveSubtree<V>(
  map: ReadonlyMap<string, V>,
  from: string,
  to: string,
  rewrite: (value: V, relocate: (path: string) => string) => V = (value) => value,
): Map<string, V> {
  const result = new Map<string, V>();
  const relocate = (path: string) => movedPath(path, from, to);
  for (const [key, value] of map) {
    if (isSameOrInside(key, from)) result.set(movedKey(key, from, to), rewrite(value, relocate));
    else result.set(key, value);
  }
  return result;
}

/** Der Schlüssel eines Pfads unter `from`, nachdem `from` zu `to` wurde. */
export function movedKey(key: string, from: string, to: string): string {
  return pathKey(to) + key.slice(from.length);
}

/**
 * Die Zeile, die nach dem Löschen der ausgewählten ausgewählt wird, wie in IntelliJ: die erste danach, die nicht mit
 * gelöscht wird, sonst die letzte davor. `null`, wenn es keine gibt.
 */
export function selectionAfterDelete(rows: readonly TreeRow[], deleted: readonly string[]): string | null {
  const gone = (row: TreeRow) => deleted.some((d) => isSameOrInside(row.path, d));
  const indices = rows.map((row, i) => (gone(row) ? i : -1)).filter((i) => i >= 0);
  if (indices.length === 0) return null;
  const after = rows.slice(indices[indices.length - 1] + 1).find((row) => !gone(row));
  if (after) return after.path;
  const before = rows.slice(0, indices[0]).reverse().find((row) => !gone(row));
  return before?.path ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
