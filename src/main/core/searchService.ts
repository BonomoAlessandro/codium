// Such-Dienst eines Projekts: Dateiliste und Suche nach Namen (Ctrl + Shift + N) sowie Projektsuche (Ctrl + Shift + F),
// beide über ripgrep, das mit Codium ausgeliefert wird. Lädt nie Electron.
//
// - Die Dateiliste enthält versteckte Dateien (ohne `.git`) und beachtet `.gitignore` auch ausserhalb eines
//   Git-Repositorys (`--no-require-git`). Sie wird beim ersten Bedarf gelesen; jede Dateiänderung (von aussen oder in
//   Codium) macht sie ungültig, die nächste Suche liest neu. Die Liste mit ignorierten Dateien entsteht nur, wenn eine
//   Suche sie braucht.
// - Die Projektsuche läuft pro Fenster höchstens einmal; eine neue bricht die laufende ab. Treffer kommen gestreamt
//   (`search.results`), nach `SEARCH_MATCH_LIMIT` Treffern bricht sie ab und meldet „mehr“.

import { spawn, type ChildProcess } from 'node:child_process';
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

/** Argumente, die jede Suche mit ripgrep braucht: keine Konfiguration des Nutzers, versteckte Dateien ohne `.git`. */
const BASE_ARGS = ['--no-config', '--hidden', '--glob', '!.git', '--no-require-git'];

export class SearchService {
  private files: Promise<string[]> | null = null;
  private allFiles: Promise<string[]> | null = null;
  private running: { id: number; child: ChildProcess } | null = null;
  private searchCounter = 0;
  private disposed = false;

  constructor(
    private readonly host: SearchServiceHost,
    private readonly ripgrep: string,
    private readonly log: (message: string) => void,
  ) {
    const invalidate = () => {
      this.files = null;
      this.allFiles = null;
    };
    host.subscribe('files.changed', invalidate);
    host.subscribe('files.operation', invalidate);
    host.onDispose(() => {
      this.disposed = true;
      this.cancelRunning();
    });
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
    if (cached) return cached;
    const args = ['--files', '--null', ...BASE_ARGS, ...(includeIgnored ? ['--no-ignore'] : [])];
    const list = this.runToEnd(args).then((output) =>
      output
        .split('\0')
        .filter((p) => p !== '')
        .map((p) => p.replace(/^\.[\\/]/, '').replaceAll('\\', '/')),
    );
    // Scheitert das Lesen, wird beim nächsten Mal neu versucht.
    list.catch(() => {
      if (includeIgnored) this.allFiles = null;
      else this.files = null;
    });
    if (includeIgnored) this.allFiles = list;
    else this.files = list;
    return list;
  }

  /** Startet eine Projektsuche; eine laufende dieses Projekts wird abgebrochen. */
  startSearch(params: CommandParams<'search.start'>): CommandResult<'search.start'> {
    const options = parseSearchOptions(params);
    this.cancelRunning();
    const searchId = ++this.searchCounter;
    if (options.query === '') {
      this.host.emit('search.results', { searchId, matches: [], done: true });
      return { searchId };
    }
    const args = ['--json', ...BASE_ARGS, '--max-filesize', '50M'];
    args.push(options.matchCase ? '--case-sensitive' : '--ignore-case');
    if (options.wholeWord) args.push('--word-regexp');
    if (!options.regex) args.push('--fixed-strings');
    if (options.includeIgnored) args.push('--no-ignore');
    for (const mask of fileMasks(options.fileMask)) args.push('--glob', mask);
    args.push('--regexp', options.query, '--', '.');

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
      const matches = matchesOf(line, this.host.path);
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
      if (code === 2 && count === 0 && errorText.trim() !== '') finish({ error: firstLine(errorText) });
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
        else reject(new Error(`ripgrep endete mit ${code}: ${firstLine(err)}`));
      });
    });
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

/** Die Treffer einer Zeile der JSON-Ausgabe von ripgrep; Spalten in UTF-16 wie im Editor, ab 1. */
export function matchesOf(line: string, root: string): SearchMatch[] {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  const m = message as {
    type?: string;
    data?: {
      path?: { text?: string };
      lines?: { text?: string };
      line_number?: number;
      submatches?: Array<{ start: number; end: number }>;
    };
  };
  if (m.type !== 'match' || !m.data?.path?.text || m.data.lines?.text === undefined || !m.data.line_number) return [];
  const relative = m.data.path.text.replace(/^\.[\\/]/, '');
  const filePath = path.join(root, relative);
  const text = m.data.lines.text.replace(/\r?\n$/, '');
  const bytes = Buffer.from(m.data.lines.text, 'utf8');
  return (m.data.submatches ?? []).map((sub) => {
    const column = bytes.subarray(0, sub.start).toString('utf8').length;
    const length = bytes.subarray(sub.start, sub.end).toString('utf8').length;
    return {
      path: filePath,
      line: m.data!.line_number!,
      column: column + 1,
      length,
      ...shortenLine(text, column, length),
    };
  });
}

/** Kürzt eine lange Trefferzeile so, dass der Treffer sichtbar bleibt; `lineOffset` ist, wo der Ausschnitt beginnt. */
function shortenLine(text: string, column: number, length: number): { lineText: string; lineOffset: number } {
  if (text.length <= MAX_LINE_TEXT) return { lineText: text, lineOffset: 0 };
  const start = Math.max(0, Math.min(column - 100, text.length - MAX_LINE_TEXT));
  return { lineText: text.slice(start, Math.max(start + MAX_LINE_TEXT, column + length)), lineOffset: start };
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? '';
}
