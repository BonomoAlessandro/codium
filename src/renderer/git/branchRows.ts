// Zeilen des Branch-Dropdowns (Ticket 31) als reine Logik ohne DOM, damit sie sich in Node prüfen lässt; BranchPopup.tsx
// zeichnet sie nur.
//
// - „Recent“: die zuletzt ausgecheckten Branches (vom Kern), mit vollem Namen, ohne Ordner.
// - „Local“ und „Remote“: Ein „/“ im Namen bildet Ordner, wie in IntelliJ; bei Remote-Branches ist der Name des Remotes
//   die erste Ebene (auch bei nur einem Remote, wie in IntelliJ). Je Ebene stehen die Ordner vor den Branches, beides
//   alphabetisch ohne Rücksicht auf Gross und Klein, Zahlen nach ihrem Wert (`release/1.9` vor `release/1.10`).
// - Der Filter gilt für den vollen Namen. Welche Ordner offen sind, bestimmt der Aufrufer: ohne Filter der gemerkte
//   Zustand, mit Filter anfangs alle Ordner mit Treffern (`filterFolders`). Ordner ohne Treffer verschwinden.
//
// Ein Ordner heisst nach Bereich und Pfad, etwa `local:feature/team-a` oder `remote:origin/feature`.

import type { GitBranches } from '../../shared/types';

export type LocalBranch = GitBranches['local'][number];
export type BranchSection = 'recent' | 'local' | 'remote';
type TreeSection = Exclude<BranchSection, 'recent'>;

export type BranchListRow =
  | { kind: 'header'; section: BranchSection; label: string }
  | {
      kind: 'folder';
      key: string;
      section: TreeSection;
      /** Der Name des Ordners (eine Ebene), etwa „team-a“. */
      name: string;
      /** Der Pfad im Bereich, etwa „feature/team-a“ oder „origin/feature“. */
      path: string;
      level: number;
      expanded: boolean;
    }
  | { kind: 'local'; key: string; section: 'recent' | 'local'; branch: LocalBranch; label: string; level: number }
  | { kind: 'remote'; key: string; name: string; label: string; level: number };

const HEADERS: Record<BranchSection, string> = { recent: 'Recent', local: 'Local', remote: 'Remote' };

/** Ein Baum aus Ordnern und Blättern; ein Blatt trägt die Zeile, die es zeichnet. */
interface Folder<T> {
  folders: Map<string, Folder<T>>;
  leaves: Array<{ label: string; item: T }>;
}

/** Der Schlüssel eines Ordners. */
export function folderKey(section: TreeSection, path: string): string {
  return `${section}:${path}`;
}

/** Ob ein Branch zum Suchtext passt: Teil des vollen Namens, ohne Rücksicht auf Gross und Klein. */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || name.toLowerCase().includes(q);
}

/** Einmal gebaut: `localeCompare` mit Optionen baut bei jedem Vergleich einen eigenen (Review von Ticket 31). */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Alphabetisch ohne Rücksicht auf Gross und Klein, Zahlen nach ihrem Wert; bei Gleichstand nach den Zeichen. */
export function compareNames(a: string, b: string): number {
  return COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Die sichtbaren Zeilen: Überschriften, Ordner und Branches mit ihrer Ebene. */
export function branchRows(branches: GitBranches, query: string, expanded: ReadonlySet<string>): BranchListRow[] {
  const rows: BranchListRow[] = [];
  const byName = new Map(branches.local.map((b) => [b.name, b]));

  const recent = branches.recent.flatMap((name) => {
    const branch = byName.get(name);
    return branch && matchesQuery(name, query) ? [branch] : [];
  });
  if (recent.length > 0) {
    rows.push({ kind: 'header', section: 'recent', label: HEADERS.recent });
    for (const branch of recent) rows.push({ kind: 'local', key: `recent:${branch.name}`, section: 'recent', branch, label: branch.name, level: 0 });
  }

  const local = buildTree(branches.local.filter((b) => matchesQuery(b.name, query)).map((b) => ({ name: b.name, item: b })));
  pushTree(rows, 'local', local, expanded, (branch, label, level) => ({ kind: 'local', key: `local:${branch.name}`, section: 'local', branch, label, level }));

  const remote = buildTree(branches.remote.filter((b) => matchesQuery(b.name, query)).map((b) => ({ name: b.name, item: b.name })));
  pushTree(rows, 'remote', remote, expanded, (name, label, level) => ({ kind: 'remote', key: `remote:${name}`, name, label, level }));
  return rows;
}

/** Beim Filtern offen: alle Ordner, in denen ein Treffer liegt. */
export function filterFolders(branches: GitBranches, query: string): Set<string> {
  const result = new Set<string>();
  const add = (section: TreeSection, name: string) => {
    if (!matchesQuery(name, query)) return;
    for (const path of folderPaths(name)) result.add(folderKey(section, path));
  };
  for (const b of branches.local) add('local', b.name);
  for (const b of branches.remote) add('remote', b.name);
  return result;
}

/**
 * Was beim Öffnen des Dropdowns offen ist: der gemerkte Zustand und dazu die Ordner, in denen der aktuelle Branch liegt.
 * Liegt er in keinem, bleibt der gemerkte Zustand, wie er ist.
 */
export function withCurrentBranchOpen(remembered: ReadonlySet<string>, current: string | null): ReadonlySet<string> {
  const keys = current ? folderPaths(current).map((path) => folderKey('local', path)) : [];
  if (keys.every((key) => remembered.has(key))) return remembered;
  return new Set([...remembered, ...keys]);
}

/**
 * Die Ordner im offenen Dropdown ohne Filter: `shown` ist offen zu sehen, `remembered` merkt sich das Projektfenster für
 * die Sitzung. Gemerkt wird nur ausdrückliches Auf- und Zuklappen; die Ordner des aktuellen Branches sind bei jedem
 * Öffnen zusätzlich offen, gehen aber nicht in den gemerkten Zustand ein (Review von Ticket 31).
 */
export interface FolderState {
  shown: ReadonlySet<string>;
  remembered: ReadonlySet<string>;
}

/** Der Zustand beim Öffnen des Dropdowns. */
export function openFolderState(remembered: ReadonlySet<string>, current: string | null): FolderState {
  return { shown: withCurrentBranchOpen(remembered, current), remembered };
}

/** Der Nutzer klappt einen Ordner auf (`open`) oder zu; beides gilt für das, was zu sehen ist, und für das Gemerkte. */
export function toggleFolderState(state: FolderState, key: string, open: boolean): FolderState {
  return open
    ? { shown: expandFolder(state.shown, key), remembered: expandFolder(state.remembered, key) }
    : { shown: collapseFolder(state.shown, key), remembered: collapseFolder(state.remembered, key) };
}

/**
 * Aufklappen, samt den Ordnern darüber: Aufklappen lässt sich nur ein sichtbarer Ordner, und im gemerkten Zustand soll
 * kein offener Ordner in einem geschlossenen liegen (etwa wenn der Ordner darüber nur wegen des aktuellen Branches offen
 * war).
 */
export function expandFolder(expanded: ReadonlySet<string>, key: string): Set<string> {
  const colon = key.indexOf(':');
  const parts = key.slice(colon + 1).split('/');
  const result = new Set(expanded);
  for (let i = 1; i <= parts.length; i++) result.add(`${key.slice(0, colon + 1)}${parts.slice(0, i).join('/')}`);
  return result;
}

/** Zuklappen schliesst auch alle Ordner darin, wie im Dateibaum (Ticket 29): Beim Aufklappen ist nur die erste Ebene offen. */
export function collapseFolder(expanded: ReadonlySet<string>, key: string): Set<string> {
  return new Set([...expanded].filter((k) => k !== key && !k.startsWith(`${key}/`)));
}

/**
 * Die Zeile des Ordners, in dem eine Zeile liegt (für Pfeil links), -1 für eine Zeile direkt unter der Überschrift. Zeilen
 * ohne Ebene (Überschriften, im Dropdown auch Aktionen und Trennlinien) begrenzen die Suche.
 */
export function parentRow(rows: ReadonlyArray<{ kind: string; level?: number }>, index: number): number {
  const level = rows[index]?.level;
  if (level === undefined || level === 0) return -1;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = rows[i].level;
    if (candidate === undefined) return -1;
    if (candidate < level) return i;
  }
  return -1;
}

/** Die Pfade der Ordner, in denen ein Branch liegt: `a/b/c` liegt in `a` und `a/b`. */
function folderPaths(name: string): string[] {
  const parts = name.split('/');
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

function buildTree<T>(entries: ReadonlyArray<{ name: string; item: T }>): Folder<T> {
  const root: Folder<T> = { folders: new Map(), leaves: [] };
  for (const { name, item } of entries) {
    const parts = name.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part);
      if (!next) {
        next = { folders: new Map(), leaves: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.leaves.push({ label: parts[parts.length - 1], item });
  }
  return root;
}

function pushTree<T>(
  rows: BranchListRow[],
  section: TreeSection,
  root: Folder<T>,
  expanded: ReadonlySet<string>,
  leafRow: (item: T, label: string, level: number) => BranchListRow,
): void {
  if (root.folders.size === 0 && root.leaves.length === 0) return;
  rows.push({ kind: 'header', section, label: HEADERS[section] });
  const visit = (folder: Folder<T>, path: string, level: number) => {
    for (const name of [...folder.folders.keys()].sort(compareNames)) {
      const childPath = path === '' ? name : `${path}/${name}`;
      const key = folderKey(section, childPath);
      const isOpen = expanded.has(key);
      rows.push({ kind: 'folder', key, section, name, path: childPath, level, expanded: isOpen });
      if (isOpen) visit(folder.folders.get(name)!, childPath, level + 1);
    }
    for (const leaf of [...folder.leaves].sort((a, b) => compareNames(a.label, b.label))) rows.push(leafRow(leaf.item, leaf.label, level));
  };
  visit(root, '', 0);
}
