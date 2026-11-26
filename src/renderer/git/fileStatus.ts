// Git-Zustand von Dateien und Ordnern für die Farben (Tickets 16 und 29), ohne DOM, damit es sich in Node prüfen lässt.
// Die Farben selbst stehen als Design-Variablen `--git-*` in tokens.css; die Klassen `git-<Zustand>` in app.css nutzen
// nur diese, im Dateibaum, in der Änderungsansicht, im Git-Log und in den Datei-Tabs.

import type { GitFileStatus, GitState } from '../../shared/types';
import { pathKey } from '../project/filePaths';

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'unversioned' | 'ignored' | 'conflict';

/** Art einer Änderung für Farbe und Beschriftung. */
export function changeKind(file: GitFileStatus): ChangeKind {
  if (file.conflict) return 'conflict';
  if (file.index === '?') return 'unversioned';
  if (file.index === '!') return 'ignored';
  if (file.origPath) return 'renamed';
  if (file.index === 'A') return 'added';
  if (file.index === 'D' || file.worktree === 'D') return 'deleted';
  return 'modified';
}

/**
 * Der Git-Zustand je Pfad, für Dateien und Ordner:
 * - Dateien nach ihrem Eintrag; gibt es zwei (etwa „D“ und „?“), gilt der versionierte.
 * - Ignoriert: eigene Einträge und alles unter einem ignorierten Ordner.
 * - Nicht versioniert (Ticket 29): ein Ordner, in dem keine versionierte Datei liegt, und alles darin. Ein Ordner mit
 *   versionierten Dateien oder nur mit ignorierten bleibt ohne Farbe, wie in IntelliJ.
 *
 * Ordner werden über die Elternordner nachgeschlagen, vom nächsten aufwärts (der nächste entscheidet, etwa ein
 * ignorierter Ordner in einem nicht versionierten), statt jede Zeile gegen alle Einträge zu prüfen.
 */
export function gitStatusLookup(state: GitState | null | undefined): (path: string) => ChangeKind | undefined {
  const byPath = new Map<string, ChangeKind>();
  for (const file of state?.files ?? []) {
    const key = pathKey(file.path);
    const known = byPath.get(key);
    if (!known || known === 'unversioned') byPath.set(key, changeKind(file));
  }
  /** Ordner, deren Zustand für alles darin gilt. */
  const folders = new Map<string, 'ignored' | 'unversioned'>();
  for (const dir of state?.untrackedDirs ?? []) folders.set(pathKey(dir), 'unversioned');
  for (const entry of state?.ignored ?? []) {
    byPath.set(pathKey(entry.path), 'ignored');
    if (entry.directory) folders.set(pathKey(entry.path), 'ignored');
  }
  return (target: string): ChangeKind | undefined => {
    const key = pathKey(target);
    const own = byPath.get(key) ?? folders.get(key);
    if (own) return own;
    if (folders.size === 0) return undefined;
    for (let i = key.lastIndexOf('\\'); i > 0; i = key.lastIndexOf('\\', i - 1)) {
      const inherited = folders.get(key.slice(0, i));
      if (inherited) return inherited;
    }
    return undefined;
  };
}
