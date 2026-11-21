// Unscharfer Vergleich für die Dateisuche nach Namen (Ctrl + Shift + N), wie in IntelliJ: Die Buchstaben der Eingabe
// müssen in dieser Reihenfolge vorkommen (ohne Gross-/Kleinschreibung); Wortanfänge, CamelCase-Höcker und
// zusammenhängende Treffer zählen mehr, Lücken weniger. Reine Funktionen ohne Dateizugriff. Lädt nie Electron.

/** Ein Treffer: Punktzahl (höher ist besser) und die Stellen der getroffenen Zeichen. */
export interface FuzzyMatch {
  score: number;
  positions: number[];
}

/** Ob ein Zeichen (UTF-16-Code) ein Trenner zwischen Wörtern ist: / \ _ - . Leerzeichen $ */
function isSeparator(code: number): boolean {
  return code === 47 || code === 92 || code === 95 || code === 45 || code === 46 || code === 32 || code === 36;
}

const isDigit = (code: number) => code >= 48 && code <= 57;
const isLower = (code: number) => code >= 97 && code <= 122;
const isUpper = (code: number) => code >= 65 && code <= 90;

/**
 * Ob an Stelle `i` ein Wort beginnt: am Anfang, nach einem Trenner, ein Grossbuchstabe nach einem kleinen, eine Ziffer
 * nach etwas anderem. Ohne reguläre Ausdrücke: läuft für jede Datei bei jedem Tastendruck.
 */
function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text.charCodeAt(i - 1);
  const cur = text.charCodeAt(i);
  if (isSeparator(prev)) return true;
  if (isUpper(cur) && isLower(prev)) return true;
  return isDigit(cur) && !isDigit(prev);
}

// Zusammenhängende Zeichen zählen mehr als ein neuer Wortanfang, damit ein Präfix („app“ → app.ts) verstreute
// CamelCase-Treffer (ApiPathParser) schlägt; ein Grossbuchstabe in der Eingabe meint aber einen Wortanfang
// („US“ → UserService), wie in IntelliJ (Review von Ticket 08).
const WORD_START = 10;
const FIRST_CHAR = 6;
const CONSECUTIVE = 12;
const EXACT_CASE = 1;
const GAP = 1;
const MAX_GAP_PENALTY = 6;
const UPPER_NOT_AT_WORD_START = 15;
const NONE = Number.NEGATIVE_INFINITY;

/** Wiederverwendete Puffer: Bei 100 000 Dateien je Tastendruck kosten neue Arrays mehr als die Rechnung. */
let scores = new Float64Array(256);
let froms = new Int32Array(256);
let farBest = new Float64Array(64);
let farIndex = new Int32Array(64);
let starts = new Uint8Array(64);

function ensureCapacity(m: number, n: number): void {
  if (scores.length < m * n) {
    scores = new Float64Array(m * n * 2);
    froms = new Int32Array(m * n * 2);
  }
  if (farBest.length < n) {
    farBest = new Float64Array(n * 2);
    farIndex = new Int32Array(n * 2);
    starts = new Uint8Array(n * 2);
  }
}

/**
 * Vergleicht eine Eingabe unscharf mit einem Text; `null`, wenn die Buchstaben nicht der Reihe nach vorkommen. Gesucht
 * wird die beste Zuordnung (dynamische Programmierung über Eingabe × Text, O(m · n): Der Abzug für Lücken ist
 * gedeckelt, weite Lücken laufen über ein laufendes Maximum).
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
  ensureCapacity(m, n);
  for (let j = 0; j < n; j++) starts[j] = isWordStart(text, j) ? 1 : 0;
  // scores[i * n + j]: beste Punktzahl, wenn Eingabezeichen i auf Textzeichen j liegt; froms: Stelle von Zeichen i - 1.
  for (let i = 0; i < m; i++) {
    const row = i * n;
    const prevRow = (i - 1) * n;
    if (i > 0) {
      // Laufendes Maximum der vorherigen Zeile bis Stelle k (Wert und Stelle), für weite Lücken.
      for (let k = 0; k < n; k++) {
        const before = k > 0 ? farBest[k - 1] : NONE;
        const value = scores[prevRow + k];
        if (value > before) {
          farBest[k] = value;
          farIndex[k] = k;
        } else {
          farBest[k] = before;
          farIndex[k] = k > 0 ? farIndex[k - 1] : -1;
        }
      }
    }
    const qc = q.charCodeAt(i);
    const upperInQuery = query.charCodeAt(i) !== qc;
    for (let j = 0; j < n; j++) {
      scores[row + j] = NONE;
      froms[row + j] = -1;
      if (j < i || t.charCodeAt(j) !== qc) continue;
      const wordStart = starts[j] === 1;
      let charScore =
        1 +
        (query.charCodeAt(i) === text.charCodeAt(j) ? EXACT_CASE : 0) +
        (wordStart ? WORD_START : 0) +
        (j === 0 ? FIRST_CHAR : 0) -
        (upperInQuery && !wordStart ? UPPER_NOT_AT_WORD_START : 0);
      if (i === 0) {
        scores[row + j] = charScore - Math.min(j, MAX_GAP_PENALTY) * GAP;
        continue;
      }
      // Nahe Vorgänger einzeln (der Abzug wächst mit der Lücke), weite über das laufende Maximum (Abzug gedeckelt).
      let bestPrev = NONE;
      let bestK = -1;
      const far = j - 1 - MAX_GAP_PENALTY;
      if (far >= 0 && farBest[far] !== NONE) {
        bestPrev = farBest[far] - MAX_GAP_PENALTY * GAP;
        bestK = farIndex[far];
      }
      for (let k = Math.max(i - 1, far + 1); k < j; k++) {
        const prev = scores[prevRow + k];
        if (prev === NONE) continue;
        const gap = j - k - 1;
        const value = prev + (gap === 0 ? CONSECUTIVE : -gap * GAP);
        if (value > bestPrev) {
          bestPrev = value;
          bestK = k;
        }
      }
      if (bestK < 0) continue;
      charScore += bestPrev;
      scores[row + j] = charScore;
      froms[row + j] = bestK;
    }
  }
  const last = (m - 1) * n;
  let end = -1;
  for (let j = 0; j < n; j++) if (scores[last + j] !== NONE && (end < 0 || scores[last + j] > scores[last + end])) end = j;
  if (end < 0) return null;
  const positions = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; j = froms[i * n + j], i--) positions[i] = j;
  return { score: scores[last + end], positions };
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
