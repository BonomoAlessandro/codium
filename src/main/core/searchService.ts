// Such-Dienst eines Projekts: Dateiliste und Suche nach Namen (Ctrl + Shift + N) sowie Projektsuche (Ctrl + Shift + F),
// beide über ripgrep, das mit Codium ausgeliefert wird. Lädt nie Electron.
//
// - Die Dateiliste enthält versteckte Dateien (ohne `.git`) und beachtet `.gitignore` auch ausserhalb eines
//   Git-Repositorys (`--no-require-git`). `.gitignore`-Dateien über dem Projekt gelten nur, wenn das Projekt in einem
//   Repository liegt, wie bei Git (Review von Ticket 08). Die Liste wird beim ersten Bedarf gelesen; Dateiänderungen
//   machen sie veraltet, und die nächste Suche liest neu, höchstens einmal je `LIST_REFRESH_MS` (während eines Builds
//   kommen sehr viele Ereignisse). Die Liste mit ignorierten Dateien entsteht nur, wenn eine Suche sie braucht.
// - Die Projektsuche läuft pro Fenster höchstens einmal; eine neue bricht die laufende ab. Treffer kommen gestreamt
//   (`search.results`), nach `SEARCH_MATCH_LIMIT` Treffern bricht sie ab und meldet „mehr“. Treffer werden in einem
//   Durchlauf pro Zeile umgerechnet, nie mehr als bis zum Limit fehlen (eine minifizierte Datei hat Zehntausende in
//   einer Zeile).

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import {
  ErrorCode,
  SEARCH_MATCH_LIMIT,
  type CommandParams,
  type CommandResult,
  type EventName,
  type Events,
  type SearchMatch,
} from '../../shared/types';
import { rankFiles } from './fuzzyMatch';
import { CommandError } from './router';

/** Was der Such-Dienst vom Projekt-Kern braucht. */
export interface SearchServiceHost {
  readonly path: string;
  emit<K extends EventName>(name: K, payload: Events[K]): void;
  subscribe<K extends EventName>(name: K, listener: (payload: Events[K]) => void): () => void;
  onDispose(cleanup: () => void | Promise<void>): void;
}

/** Höchstzahl Treffer der Suche nach Namen. */
const NAME_RESULT_LIMIT = 100;
/** So lang wird eine Trefferzeile höchstens übertragen; der Treffer bleibt darin sichtbar. */
const MAX_LINE_TEXT = 500;
/** Treffer werden gesammelt und so oft an die Oberfläche geschickt. */
const BATCH_MS = 50;
/** Eine veraltete Dateiliste wird höchstens so oft neu gelesen. */
const LIST_REFRESH_MS = 1000;

/** Eine Liste mit dem Zeitpunkt, zu dem sie gelesen wurde, und ob sie seither veraltet ist. */
interface CachedList {
  list: Promise<string[]>;
  at: number;
  stale: boolean;
}

export class SearchService {
  private files: CachedList | null = null;
  private allFiles: CachedList | null = null;
  private running: { id: number; child: ChildProcess } | null = null;
  private searchCounter = 0;
  private disposed = false;
  /** Argumente, die jede Suche braucht; hängen davon ab, ob das Projekt in einem Git-Repository liegt. */
  private baseArgs: Promise<string[]> | null = null;

  constructor(
    private readonly host: SearchServiceHost,
    private readonly ripgrep: string,
    private readonly log: (message: string) => void,
  ) {
    // Änderungen von aussen kommen während eines Builds in Massen: gedrosselt neu lesen. Eine eigene Operation (neue
    // Datei, Umbenennen) soll die nächste Suche sofort sehen.
    const outdate = (immediately: boolean) => {
      for (const cached of [this.files, this.allFiles]) {
        if (!cached) continue;
        cached.stale = true;
        if (immediately) cached.at = 0;
      }
    };
    host.subscribe('files.changed', () => outdate(false));
    host.subscribe('files.operation', () => outdate(true));
    host.onDispose(() => {
      this.disposed = true;
      this.cancelRunning();
    });
  }

  /**
   * Keine Konfiguration des Nutzers, versteckte Dateien, `.gitignore` auch ohne Repository. `.gitignore` über dem
   * Projekt nur, wenn das Projekt in einem Repository liegt (nicht an seiner Wurzel): Git selbst sieht über die Wurzel
   * des Repositorys nicht hinaus, und ohne Repository zählt nur das Projekt.
   */
  private searchArgs(): Promise<string[]> {
    this.baseArgs ??= insideRepository(this.host.path).then((inside) => [
      '--no-config',
      '--hidden',
      '--no-require-git',
      ...(inside ? [] : ['--no-ignore-parent']),
    ]);
    return this.baseArgs;
  }

  /** Suche nach Namen: die besten Treffer, ohne ignorierte Dateien, mit `includeIgnored` auch mit ihnen. */
  async findByName(params: CommandParams<'files.findByName'>): Promise<CommandResult<'files.findByName'>> {
    const query = (params as { query?: unknown } | undefined)?.query;
    if (typeof query !== 'string') throw new CommandError('A query is expected.', ErrorCode.invalidParams);
    const includeIgnored = (params as { includeIgnored?: unknown }).includeIgnored === true;
    const regular = await this.fileList(false);
    let candidates = regular.map((relative) => ({ relative, ignored: false }));
    if (includeIgnored) {
      const known = new Set(regular);
      const all = await this.fileList(true);
      candidates = [...candidates, ...all.filter((r) => !known.has(r)).map((relative) => ({ relative, ignored: true }))];
    }
    if (query.trim() === '') return { matches: [] };
    return {
      matches: rankFiles(query, candidates, NAME_RESULT_LIMIT).map((m) => ({
        path: path.join(this.host.path, ...m.relative.split('/')),
        relative: m.relative,
        positions: m.positions,
        ...(m.ignored ? { ignored: true } : {}),
      })),
    };
  }

  /** Alle Dateien relativ zum Projekt mit „/“; mit `includeIgnored` auch die von `.gitignore` ausgenommenen. */
  private fileList(includeIgnored: boolean): Promise<string[]> {
    const cached = includeIgnored ? this.allFiles : this.files;
    if (cached && (!cached.stale || Date.now() - cached.at < LIST_REFRESH_MS)) return cached.list;
    const list = this.searchArgs()
      .then((base) => this.runToEnd(['--files', '--null', ...base, ...EXCLUDE_GIT, ...(includeIgnored ? ['--no-ignore'] : [])]))
      .then((output) =>
        output
          .split('\0')
          .filter((p) => p !== '')
          .map((p) => p.replace(/^\.[\\/]/, '').replaceAll('\\', '/')),
      );
    const entry: CachedList = { list, at: Date.now(), stale: false };
    // Scheitert das Lesen, wird beim nächsten Mal neu versucht.
    list.catch(() => {
      if (includeIgnored && this.allFiles === entry) this.allFiles = null;
      if (!includeIgnored && this.files === entry) this.files = null;
    });
    if (includeIgnored) this.allFiles = entry;
    else this.files = entry;
    return list;
  }

  /** Startet eine Projektsuche; eine laufende dieses Projekts wird abgebrochen. */
  async startSearch(params: CommandParams<'search.start'>): Promise<CommandResult<'search.start'>> {
    const options = parseSearchOptions(params);
    this.cancelRunning();
    const searchId = ++this.searchCounter;
    if (options.query === '') {
      this.host.emit('search.results', { searchId, matches: [], done: true });
      return { searchId };
    }
    const args = ['--json', ...(await this.searchArgs()), '--max-filesize', '50M', '--glob-case-insensitive'];
    args.push(options.matchCase ? '--case-sensitive' : '--ignore-case');
    if (options.wholeWord) args.push('--word-regexp');
    if (!options.regex) args.push('--fixed-strings');
    if (options.includeIgnored) args.push('--no-ignore');
    for (const mask of fileMasks(options.fileMask)) args.push('--glob', mask);
    // Der Ausschluss von `.git` nach den Masken: Bei ripgrep gewinnt der spätere Glob (Review von Ticket 08).
    args.push(...EXCLUDE_GIT, '--regexp', options.query, '--', '.');
    // Während des Wartens auf die Argumente kann schon die nächste Suche begonnen haben.
    if (searchId !== this.searchCounter || this.disposed) {
      this.host.emit('search.results', { searchId, matches: [], done: true });
      return { searchId };
    }

    const child = spawn(this.ripgrep, args, { cwd: this.host.path, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.running = { id: searchId, child };
    let count = 0;
    let pending: SearchMatch[] = [];
    let timer: NodeJS.Timeout | null = null;
    let finished = false;
    let errorText = '';
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending.length === 0) return;
      this.host.emit('search.results', { searchId, matches: pending, done: false });
      pending = [];
    };
    const finish = (extra: { limitReached?: true; error?: string }) => {
      if (finished) return;
      finished = true;
      flush();
      if (this.running?.id === searchId) this.running = null;
      this.host.emit('search.results', { searchId, matches: [], done: true, ...extra });
    };
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      if (finished) return;
      // Eine Zeile mehr umrechnen als bis zum Limit fehlt: So zeigt sich, dass es mehr gibt.
      const matches = matchesOf(line, this.host.path, SEARCH_MATCH_LIMIT - count + 1);
      for (const match of matches) {
        if (count >= SEARCH_MATCH_LIMIT) {
          child.kill();
          finish({ limitReached: true });
          return;
        }
        count++;
        pending.push(match);
      }
      if (pending.length > 0 && !timer) timer = setTimeout(flush, BATCH_MS);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      errorText += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      this.log(`ripgrep liess sich nicht starten: ${err.message}`);
      finish({ error: 'Search is not available: ripgrep could not be started.' });
    });
    // Nach dem Ende des Prozesses sind alle Zeilen gelesen. 0: Treffer, 1: keine; 2: ein Fehler (etwa ein ungültiger
    // regulärer Ausdruck) oder einzelne unlesbare Dateien.
    child.on('close', (code) => {
      if (code === 2 && count === 0 && errorText.trim() !== '') finish({ error: ripgrepError(errorText) });
      else finish({});
    });
    return { searchId };
  }

  /** Bricht eine Suche ab, wenn sie noch läuft. */
  cancelSearch(params: CommandParams<'search.cancel'>): void {
    const searchId = (params as { searchId?: unknown } | undefined)?.searchId;
    if (this.running && this.running.id === searchId) this.cancelRunning();
  }

  private cancelRunning(): void {
    const running = this.running;
    this.running = null;
    running?.child.kill();
  }

  /** Führt ripgrep im Projekt aus und liefert die ganze Ausgabe (Exit-Code 0 oder 1, sonst ein Fehler). */
  private runToEnd(args: string[]): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('Das Projekt wird geschlossen.'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.ripgrep, args, { cwd: this.host.path, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        // Exit-Code 2 heisst auch: Einzelne Dateien oder Ordner liessen sich nicht lesen; der Rest gilt.
        if (code === 0 || code === 1 || (code === 2 && out.length > 0)) resolve(Buffer.concat(out).toString('utf8'));
        else reject(new Error(`ripgrep endete mit ${code}: ${ripgrepError(err)}`));
      });
    });
  }
}

/** `.git` fehlt in Dateiliste und Suche, als Ordner auf jeder Ebene. Muss nach den Masken des Nutzers stehen. */
const EXCLUDE_GIT = ['--glob', '!.git', '--glob', '!**/.git/**'];

/** Ob ein Ordner in einem Git-Repository liegt (ein `.git` in einem Ordner darüber). */
async function insideRepository(dir: string): Promise<boolean> {
  for (let current = path.dirname(dir); ; current = path.dirname(current)) {
    try {
      await fs.promises.stat(path.join(current, '.git'));
      return true;
    } catch {
      // Nicht hier; weiter nach oben.
    }
    if (path.dirname(current) === current) return false;
  }
}

/** Die Optionen einer Projektsuche aus einem Befehl. */
function parseSearchOptions(params: unknown): CommandParams<'search.start'> {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p.query !== 'string') throw new CommandError('A query is expected.', ErrorCode.invalidParams);
  return {
    query: p.query,
    matchCase: p.matchCase === true,
    wholeWord: p.wholeWord === true,
    regex: p.regex === true,
    fileMask: typeof p.fileMask === 'string' ? p.fileMask : '',
    includeIgnored: p.includeIgnored === true,
  };
}

/** Eine Dateimaske wie in IntelliJ („*.java, *.ts“, „!*.min.js“) als Globs für ripgrep. */
export function fileMasks(mask: string): string[] {
  return mask
    .split(/[,;]/)
    .map((m) => m.trim())
    .filter((m) => m !== '' && m !== '!');
}

/** Dekodiert Bytes wie beim Lesen einer Datei: gültiges UTF-8, sonst Windows-1252. */
function decodeLine(bytes: Buffer): (part: Buffer) => string {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return (part) => part.toString('utf8');
  } catch {
    const decoder = new TextDecoder('windows-1252');
    return (part) => decoder.decode(part);
  }
}

/**
 * Die Treffer einer Zeile der JSON-Ausgabe von ripgrep, höchstens `limit`; Spalten in UTF-16 wie im Editor, ab 1. Die
 * Spalten werden in einem Durchlauf vorwärts gezählt. Zeilen, die kein gültiges UTF-8 sind, liefert ripgrep als
 * Base64; sie werden wie Windows-1252 gelesen (Review von Ticket 08).
 */
export function matchesOf(line: string, root: string, limit = Number.POSITIVE_INFINITY): SearchMatch[] {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  const m = message as {
    type?: string;
    data?: {
      path?: { text?: string; bytes?: string };
      lines?: { text?: string; bytes?: string };
      line_number?: number;
      submatches?: Array<{ start: number; end: number }>;
    };
  };
  if (m.type !== 'match' || !m.data?.line_number) return [];
  const pathText = m.data.path?.text ?? (m.data.path?.bytes ? Buffer.from(m.data.path.bytes, 'base64').toString('utf8') : undefined);
  const lineBytes =
    m.data.lines?.text !== undefined
      ? Buffer.from(m.data.lines.text, 'utf8')
      : m.data.lines?.bytes !== undefined
        ? Buffer.from(m.data.lines.bytes, 'base64')
        : undefined;
  if (!pathText || !lineBytes) return [];
  const filePath = path.join(root, pathText.replace(/^\.[\\/]/, ''));
  const decode = decodeLine(lineBytes);
  const lineNumber = m.data.line_number;
  let text: string | null = null;
  const fullText = () => (text ??= decode(lineBytes).replace(/\r?\n$/, ''));
  const result: SearchMatch[] = [];
  let bytePos = 0;
  let charPos = 0;
  for (const sub of m.data.submatches ?? []) {
    if (result.length >= limit) break;
    if (sub.start < bytePos) continue;
    charPos += decode(lineBytes.subarray(bytePos, sub.start)).length;
    const length = decode(lineBytes.subarray(sub.start, sub.end)).length;
    bytePos = sub.end;
    result.push({ path: filePath, line: lineNumber, column: charPos + 1, length, ...shortenLine(fullText(), charPos, length) });
    charPos += length;
  }
  return result;
}

/** Kürzt eine lange Trefferzeile so, dass der Treffer sichtbar bleibt; `lineOffset` ist, wo der Ausschnitt beginnt. */
function shortenLine(text: string, column: number, length: number): { lineText: string; lineOffset: number } {
  if (text.length <= MAX_LINE_TEXT) return { lineText: text, lineOffset: 0 };
  const start = Math.max(0, Math.min(column - 100, text.length - MAX_LINE_TEXT));
  return { lineText: text.slice(start, Math.max(start + MAX_LINE_TEXT, column + length)), lineOffset: start };
}

/**
 * Eine Fehlermeldung von ripgrep für die Oberfläche: ohne „rg: “, mit der eigentlichen Ursache, etwa „regex parse
 * error: unclosed group“ (Review von Ticket 08).
 */
export function ripgrepError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return '';
  const head = lines[0].replace(/^rg:\s*/, '').replace(/:$/, '');
  const cause = lines.findLast((l) => l.startsWith('error:'))?.replace(/^error:\s*/, '');
  return cause && !head.includes(cause) ? `${head}: ${cause}` : head;
}
