// Welche Ordner gemerkte Einträge enthalten (Ticket 32, Review): Je Ordner zählt der Index die Einträge darunter. So
// erkennt ein Zwischenspeicher ohne Durchlauf aller Einträge, ob ein geänderter oder gelöschter Pfad ein Ordner mit
// gemerktem Inhalt ist. Den Inhalt findet dann ein einziger Durchlauf, der je Eintrag nur seine Elternordner nachschlägt:
// Der Aufwand ist Einträge × Tiefe statt Änderungen × Einträge. Ohne Node und ohne DOM; Kern und Oberfläche geben an,
// wie sie den Elternordner eines Schlüssels bilden.

/** Der Schlüssel des Elternordners; `null` am Laufwerk bzw. an der Wurzel. */
export type ParentOf = (key: string) => string | null;

/** Elternordner eines Windows-Pfads als Schlüssel (`c:\a\b` → `c:\a` → `c:\` → `null`). */
export const windowsParent: ParentOf = (key) => {
  const cut = key.lastIndexOf('\\');
  if (cut <= 0 || cut === key.length - 1) return null;
  if (cut === 2 && key[1] === ':') return key.slice(0, 3);
  return key.slice(0, cut);
};

/** Der nächste Elternordner eines Schlüssels (ohne ihn selbst), der in `folders` liegt; `null`, wenn keiner. */
export function ancestorIn(key: string, folders: ReadonlySet<string>, parentOf: ParentOf): string | null {
  for (let dir = parentOf(key); dir !== null; dir = parentOf(dir)) if (folders.has(dir)) return dir;
  return null;
}

export class FolderIndex {
  private readonly counts = new Map<string, number>();

  constructor(private readonly parentOf: ParentOf) {}

  /** Ein Eintrag ist dazugekommen. */
  add(key: string): void {
    for (let dir = this.parentOf(key); dir !== null; dir = this.parentOf(dir)) this.counts.set(dir, (this.counts.get(dir) ?? 0) + 1);
  }

  /** Ein Eintrag ist weggefallen. */
  remove(key: string): void {
    for (let dir = this.parentOf(key); dir !== null; dir = this.parentOf(dir)) {
      const count = (this.counts.get(dir) ?? 0) - 1;
      if (count > 0) this.counts.set(dir, count);
      else this.counts.delete(dir);
    }
  }

  /** Ob unter diesem Schlüssel gemerkte Einträge liegen, er also ein Ordner mit gemerktem Inhalt ist. */
  hasEntriesBelow(key: string): boolean {
    return this.counts.has(key);
  }

  /** Der nächste Elternordner eines Eintrags, der in `folders` liegt; `null`, wenn keiner. */
  ancestorIn(key: string, folders: ReadonlySet<string>): string | null {
    return ancestorIn(key, folders, this.parentOf);
  }
}
