// Unscharfer Vergleich für die Dateisuche nach Namen (Ctrl + Shift + N), wie in IntelliJ: Die Buchstaben der Eingabe
// müssen in dieser Reihenfolge vorkommen (ohne Gross-/Kleinschreibung); Wortanfänge, CamelCase-Höcker und
// zusammenhängende Treffer zählen mehr, Lücken weniger. Reine Funktionen ohne Dateizugriff. Lädt nie Electron.

/** Ein Treffer: Punktzahl (höher ist besser) und die Stellen der getroffenen Zeichen. */
export interface FuzzyMatch {
  score: number;
  positions: number[];
}

const SEPARATORS = new Set(['/', '\\', '_', '-', '.', ' ', '$']);

/** Ob an Stelle `i` ein Wort beginnt: am Anfang, nach einem Trenner, ein Grossbuchstabe nach einem kleinen, eine Ziffer. */
function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (SEPARATORS.has(prev)) return true;
  if (cur !== cur.toLowerCase() && prev === prev.toLowerCase() && prev !== prev.toUpperCase()) return true;
  return /\d/.test(cur) && !/\d/.test(prev);
}

const WORD_START = 10;
const FIRST_CHAR = 6;
const CONSECUTIVE = 6;
const EXACT_CASE = 1;
const GAP = 1;
const MAX_GAP_PENALTY = 6;

/**
 * Vergleicht eine Eingabe unscharf mit einem Text; `null`, wenn die Buchstaben nicht der Reihe nach vorkommen. Gesucht
 * wird die beste Zuordnung (dynamische Programmierung über Eingabe × Text).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Schnelle Vorprüfung: kommen die Buchstaben überhaupt der Reihe nach vor?
  for (let i = 0, j = 0; i < q.length; i++, j++) {
    j = t.indexOf(q[i], j);
    if (j < 0) return null;
  }
  const n = t.length;
  const m = q.length;
  const NONE = Number.NEGATIVE_INFINITY;
  // best[i][j]: beste Punktzahl, wenn Eingabezeichen i auf Textzeichen j liegt; from[i][j]: Stelle von Zeichen i - 1.
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  const starts = Array.from({ length: n }, (_, j) => isWordStart(text, j));
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(NONE);
    const back = new Int32Array(n).fill(-1);
    for (let j = i; j < n; j++) {
      if (t[j] !== q[i]) continue;
      let charScore = 1 + (query[i] === text[j] ? EXACT_CASE : 0) + (starts[j] ? WORD_START : 0) + (j === 0 ? FIRST_CHAR : 0);
      if (i === 0) {
        row[j] = charScore - Math.min(j, MAX_GAP_PENALTY) * GAP;
        continue;
      }
      const prev = best[i - 1];
      let bestPrev = NONE;
      let bestK = -1;
      for (let k = i - 1; k < j; k++) {
        if (prev[k] === NONE) continue;
        const gap = j - k - 1;
        const value = prev[k] + (gap === 0 ? CONSECUTIVE : -Math.min(gap, MAX_GAP_PENALTY) * GAP);
        if (value > bestPrev) {
          bestPrev = value;
          bestK = k;
        }
      }
      if (bestK < 0) continue;
      charScore += bestPrev;
      row[j] = charScore;
      back[j] = bestK;
    }
    best.push(row);
    from.push(back);
  }
  let end = -1;
  for (let j = 0; j < n; j++) if (best[m - 1][j] !== NONE && (end < 0 || best[m - 1][j] > best[m - 1][end])) end = j;
  if (end < 0) return null;
  const positions: number[] = [];
  for (let i = m - 1, j = end; i >= 0; j = from[i][j], i--) positions.unshift(j);
  return { score: best[m - 1][end], positions };
}

/** Eine Datei für die Suche nach Namen: relativer Pfad mit „/“. */
export interface NamedFile {
  relative: string;
}

/** Abzug, wenn die Eingabe nicht im Dateinamen, sondern nur im ganzen Pfad vorkommt. */
const PATH_ONLY_PENALTY = 30;

/**
 * Bewertet eine Datei für die Suche nach Namen. Ohne „/“ in der Eingabe zählt zuerst der Dateiname; kommt die Eingabe
 * nur im ganzen Pfad vor, zählt sie schwächer. Mit „/“ wird der ganze Pfad verglichen. Die Stellen beziehen sich auf
 * den relativen Pfad.
 */
export function matchFile(query: string, relative: string): FuzzyMatch | null {
  const normalized = query.replaceAll('\\', '/').replace(/\s+/g, '');
  const nameStart = relative.lastIndexOf('/') + 1;
  if (!normalized.includes('/')) {
    const inName = fuzzyMatch(normalized, relative.slice(nameStart));
    if (inName) return { score: inName.score, positions: inName.positions.map((p) => p + nameStart) };
  }
  const inPath = fuzzyMatch(normalized, relative);
  if (!inPath) return null;
  return { score: inPath.score - (normalized.includes('/') ? 0 : PATH_ONLY_PENALTY), positions: inPath.positions };
}

/** Die besten Treffer, absteigend nach Punktzahl, bei Gleichstand der kürzere und dann der alphabetisch erste Pfad. */
export function rankFiles<T extends NamedFile>(query: string, files: readonly T[], limit: number): Array<T & FuzzyMatch> {
  const matches: Array<T & FuzzyMatch> = [];
  for (const file of files) {
    const match = matchFile(query, file.relative);
    if (match) matches.push({ ...file, ...match });
  }
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.relative.length - b.relative.length ||
      (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0),
  );
  return matches.slice(0, limit);
}
