// Regeln der Suchfenster ohne DOM, damit sie sich in Node prüfen lassen: Treffer nach Dateien gruppieren, Teile eines
// Textes zum Hervorheben, Auswahl mit den Pfeiltasten.

import type { SearchMatch } from '../../shared/types';
import { pathKey } from '../project/filePaths';

/** Die Treffer einer Datei, in der Reihenfolge ihres ersten Auftretens. */
export interface FileGroup {
  path: string;
  matches: SearchMatch[];
}

/** Gruppiert Treffer nach Datei; Dateien und Treffer behalten ihre Reihenfolge. */
export function groupByFile(matches: readonly SearchMatch[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const match of matches) {
    const key = pathKey(match.path);
    const group = groups.get(key) ?? { path: match.path, matches: [] };
    group.matches.push(match);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Ein Stück Text, hervorgehoben oder nicht. */
export interface TextPart {
  text: string;
  marked: boolean;
}

/** Teilt einen Text an den angegebenen Stellen in hervorgehobene und normale Stücke (für die Suche nach Namen). */
export function markPositions(text: string, positions: readonly number[], offset = 0): TextPart[] {
  const marked = new Set(positions.map((p) => p - offset));
  const parts: TextPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const isMarked = marked.has(i);
    const last = parts.at(-1);
    if (last && last.marked === isMarked) last.text += text[i];
    else parts.push({ text: text[i], marked: isMarked });
  }
  return parts;
}

/** Die Zeile eines Treffers in drei Stücke: davor, der Treffer, danach (ohne führende Leerzeichen). */
export function matchParts(match: SearchMatch): TextPart[] {
  const start = match.column - 1 - match.lineOffset;
  const raw = match.lineText;
  const trimmed = raw.trimStart();
  const cut = raw.length - trimmed.length;
  const from = Math.max(0, start - cut);
  return [
    { text: trimmed.slice(0, from), marked: false },
    { text: trimmed.slice(from, from + match.length), marked: true },
    { text: trimmed.slice(from + match.length), marked: false },
  ].filter((p) => p.text !== '');
}

/** Die nächste Auswahl in einer Liste mit den Pfeiltasten; bleibt an den Enden stehen. */
export function moveSelection(index: number, count: number, key: string, pageSize = 10): number {
  // Andere Tasten (etwa getippte Zeichen) ändern nichts, auch bei leerer Liste.
  if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(key)) return index;
  if (count === 0) return index;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'PageDown':
      return Math.min(count - 1, index + pageSize);
    case 'PageUp':
      return Math.max(0, index - pageSize);
    default:
      return index;
  }
}
