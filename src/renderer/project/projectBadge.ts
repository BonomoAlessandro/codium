// Das farbige Kürzel vor dem Projektnamen in der Kopfzeile, wie im neuen IntelliJ. Reine Rechnung ohne DOM.

/** Gedämpfte Farben, gut lesbar mit weisser Schrift auf dunklem Grund. */
const BADGE_COLORS = ['#3d7a4f', '#3b6db3', '#8a5aa8', '#b0573d', '#3a8a8f', '#9c6b2f', '#a8476b', '#5a6bb0'];

/**
 * Bis zu zwei Buchstaben aus dem Projektnamen: die Anfänge der ersten beiden Wörter (getrennt durch Zeichen wie „-“,
 * „_“, „.“, Leerzeichen oder einen Wechsel auf Grossbuchstaben), bei einem Wort dessen erste zwei Zeichen.
 */
export function projectInitials(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join('').toUpperCase();
}

/** Eine Farbe aus dem Pfad: dasselbe Projekt hat immer dieselbe Farbe. */
export function projectBadgeColor(projectPath: string): string {
  let hash = 0;
  for (const char of projectPath.toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}
