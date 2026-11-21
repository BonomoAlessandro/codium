// Pfade in der Oberfläche. Sie kommen absolut und mit „\“ vom Kern (Codium läuft unter Windows); verglichen wird
// ohne Unterscheidung der Gross-/Kleinschreibung. Ohne Node und ohne DOM, damit es sich in Node testen lässt.

/** Schlüssel eines Pfads zum Vergleichen. */
export function pathKey(target: string): string {
  return target.toLowerCase();
}

/** Ob `target` derselbe Pfad ist wie `dir` oder darin liegt. */
export function isSameOrInside(target: string, dir: string): boolean {
  const t = pathKey(target);
  const d = pathKey(dir);
  return t === d || t.startsWith(d.endsWith('\\') ? d : `${d}\\`);
}

/** Der Elternordner; beim Laufwerk oder einer Freigabe der Pfad selbst. */
export function parentPath(target: string): string {
  const cut = target.lastIndexOf('\\');
  if (cut <= 0) return target;
  // `C:\a` → `C:\`
  if (cut === 2 && target[1] === ':') return target.slice(0, 3);
  return target.slice(0, cut);
}

/** Der letzte Teil eines Pfads. */
export function baseName(target: string): string {
  return target.slice(target.lastIndexOf('\\') + 1);
}

/** Ein Pfad unter einem Ordner. */
export function joinPath(dir: string, ...names: string[]): string {
  return [dir.endsWith('\\') ? dir.slice(0, -1) : dir, ...names].join('\\');
}

/** Der Pfad relativ zum Projektordner, mit „/“ wie in IntelliJ; der Projektordner selbst ist sein Name. */
export function relativeLabel(root: string, target: string): string {
  if (pathKey(target) === pathKey(root)) return baseName(root);
  return target.slice(root.length + 1).replaceAll('\\', '/');
}

/** Ersetzt den Anfang `from` eines Pfads durch `to` (etwa nach dem Umbenennen eines Ordners). */
export function movedPath(target: string, from: string, to: string): string {
  return pathKey(target) === pathKey(from) ? to : to + target.slice(from.length);
}
