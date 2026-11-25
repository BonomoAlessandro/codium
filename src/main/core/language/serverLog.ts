// Protokoll der Sprachserver (Ticket 30). Lädt nie Electron.
//
// - Jede Verbindung hebt das Ende dessen auf, was ihr Server auf stderr schreibt (`TailBuffer`, fest 64 KB). Sonst
//   lässt sich ein Absturz im Nachhinein nicht erklären; der native TypeScript-Server etwa schreibt eine Go-Panic samt
//   Stack dorthin.
// - Endet ein Server unerwartet, schreibt der Sprach-Dienst einen Eintrag: Zeitpunkt, Projekt, Server, Art, Programm,
//   Exit-Code bzw. Signal, wie es weitergeht, und das aufgehobene stderr.
// - Das Protokoll liegt im Datenordner von Codium (`logs/language-servers.log`, im Testmodus also im Datenordner des
//   Tests) und ist begrenzt: Würde ein Eintrag es über die Grenze bringen, wird es zu `language-servers.old.log` (ein
//   älteres fällt weg), und ein neues beginnt. Alle Projektfenster schreiben über dieselbe Instanz, nacheinander.
//   „Show Log“ zeigt erst das ersetzte, dann das aktuelle Protokoll (`readAll`).
// - Beim Beenden wartet der App-Kern kurz auf Einträge, die noch geschrieben werden (`track`, `idle`).

import * as fs from 'node:fs';
import * as path from 'node:path';

/** So viel vom Ende von stderr hebt jede Verbindung auf. */
export const STDERR_TAIL_BYTES = 64 * 1024;
/** Höchstgrösse des Protokolls, bevor es ersetzt wird. */
export const SERVER_LOG_MAX_BYTES = 1024 * 1024;
export const SERVER_LOG_FILE = path.join('logs', 'language-servers.log');
const OLD_SUFFIX = '.old.log';

/** Ringpuffer für Bytes: behält höchstens die letzten `limit` Bytes. */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  /** Ob vorne schon etwas weggefallen ist. */
  private dropped = false;

  constructor(private readonly limit = STDERR_TAIL_BYTES) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (chunk.length >= this.limit) {
      this.chunks = [chunk.subarray(chunk.length - this.limit)];
      this.dropped = this.dropped || this.size > 0 || chunk.length > this.limit;
      this.size = this.limit;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit) {
      const first = this.chunks[0];
      const excess = this.size - this.limit;
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.size -= excess;
      }
      this.dropped = true;
    }
  }

  /**
   * Der aufgehobene Text. Fehlt der Anfang, beginnt er an der ersten ganzen Zeile; gibt es keine (nur eine Zeile, die
   * am Ende aufhört), wenigstens am ersten ganzen Zeichen.
   */
  read(): { text: string; truncated: boolean } {
    let bytes = Buffer.concat(this.chunks, this.size);
    if (this.dropped) {
      const newline = bytes.indexOf(0x0a);
      bytes = newline >= 0 && newline < bytes.length - 1 ? bytes.subarray(newline + 1) : bytes.subarray(utf8Start(bytes, 0));
    }
    return { text: bytes.toString('utf8'), truncated: this.dropped };
  }
}

/** Ob ein Byte ein Folgebyte eines UTF-8-Zeichens ist (10xxxxxx). */
function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/** Die erste Stelle ab `from`, an der ein ganzes Zeichen beginnt (Folgebytes vorne übersprungen). */
function utf8Start(bytes: Buffer, from: number): number {
  let at = from;
  while (at < bytes.length && isContinuation(bytes[at])) at++;
  return at;
}

/** Die letzte Stelle bis `end`, vor der nur ganze Zeichen stehen (ein angeschnittenes Zeichen fällt weg). */
function utf8End(bytes: Buffer, end: number): number {
  let at = Math.min(end, bytes.length);
  while (at > 0 && at < bytes.length && isContinuation(bytes[at])) at--;
  return at;
}

/** Ein unerwartetes Ende eines Sprachservers. */
export interface ServerStopEntry {
  time: Date;
  project: string;
  /** Name des Servers, etwa „TypeScript“. */
  server: string;
  /** Art des Servers, etwa `bundled-native` oder `jdtls`. */
  kind: string;
  command: string;
  args: string[];
  code: number | null;
  signal: string | null;
  /** Warum Codium nicht weiss, wie er endete, oder was davor schiefging (etwa ein Start ohne Antwort). */
  note?: string;
  /** Wie es weitergeht, etwa „Restarting (restart 1 of 3 within three minutes).“ */
  outcome: string;
  stderr: { text: string; truncated: boolean };
}

/** Der Eintrag als Text; englisch, weil er in der Oberfläche erscheint (Show Log). */
export function formatEntry(entry: ServerStopEntry, stderrLimit = STDERR_TAIL_BYTES): string {
  const exit = entry.code !== null ? `code ${entry.code}` : entry.signal !== null ? `signal ${entry.signal}` : 'unknown';
  const stderr = entry.stderr.text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lines = [
    `=== ${localTime(entry.time)} – ${entry.server} language server stopped unexpectedly ===`,
    `Project: ${entry.project}`,
    `Server:  ${entry.server} (${entry.kind})`,
    `Program: ${[entry.command, ...entry.args].join(' ')}`,
    `Exit:    ${exit}`,
    ...(entry.note ? [`Note:    ${entry.note}`] : []),
    `Then:    ${entry.outcome}`,
    stderr === ''
      ? '--- stderr: (empty) ---'
      : `--- stderr${entry.stderr.truncated ? ` (last ${Math.round(stderrLimit / 1024)} KB)` : ''} ---`,
    ...(stderr === '' ? [] : [stderr, '--- end of stderr ---']),
  ];
  return `${lines.join('\n')}\n\n`;
}

/** Ortszeit mit Datum und Millisekunden, etwa „2026-11-24 14:35:02.123“. */
function localTime(time: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())} ` +
    `${two(time.getHours())}:${two(time.getMinutes())}:${two(time.getSeconds())}.${String(time.getMilliseconds()).padStart(3, '0')}`
  );
}

export class LanguageServerLog {
  /** Schreibvorgänge nacheinander, auch aus mehreren Projektfenstern. Lehnt nie ab (siehe `append`). */
  private queue: Promise<void> = Promise.resolve();
  /** Einträge, die noch vorbereitet werden (etwa der Rest von stderr), bevor sie `append` erreichen. */
  private readonly preparing = new Set<Promise<unknown>>();

  constructor(
    /** Absoluter Pfad der Protokolldatei. */
    readonly file: string,
    private readonly options: { maxBytes?: number; log?: (message: string) => void } = {},
  ) {}

  private get maxBytes(): number {
    return this.options.maxBytes ?? SERVER_LOG_MAX_BYTES;
  }

  /**
   * Hängt einen Eintrag an; ersetzt das Protokoll vorher, wenn es sonst zu gross würde. Lässt es sich nicht ersetzen
   * (etwa weil ein anderes Programm es offen hält), kommt der Eintrag trotzdem dazu. Wirft nie.
   */
  append(entry: ServerStopEntry): Promise<void> {
    const text = this.fit(formatEntry(entry));
    const write = this.queue.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        const size = (await fs.promises.stat(this.file).catch(() => null))?.size ?? 0;
        if (size > 0 && size + Buffer.byteLength(text, 'utf8') > this.maxBytes) {
          try {
            await fs.promises.rename(this.file, this.oldFile);
          } catch (err) {
            this.report(`Protokoll der Sprachserver nicht ersetzt, der Eintrag kommt trotzdem dazu: ${(err as Error).message}`);
          }
        }
        await fs.promises.appendFile(this.file, text, 'utf8');
      } catch (err) {
        this.report(`Protokoll der Sprachserver nicht geschrieben: ${(err as Error).message}`);
      }
    });
    // Auch ein Fehler in der Meldung darf die Warteschlange nicht dauerhaft ablehnen lassen.
    this.queue = write.catch(() => {});
    return this.queue;
  }

  /** Zahl der Einträge, die noch vorbereitet werden (Tests). */
  get preparingCount(): number {
    return this.preparing.size;
  }

  /** Merkt sich einen Eintrag, der noch vorbereitet wird und danach `append` aufruft (siehe `idle`). */
  track(work: Promise<unknown>): void {
    const settled = work.catch(() => {});
    this.preparing.add(settled);
    void settled.then(() => this.preparing.delete(settled));
  }

  /** Wartet, bis vorbereitete und laufende Einträge geschrieben sind, höchstens `timeoutMs` (beim Beenden). */
  async idle(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const done = (async () => {
      await Promise.all([...this.preparing]);
      await this.queue;
    })();
    await Promise.race([done, new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
    clearTimeout(timer);
  }

  /** Der Inhalt des Protokolls; leer, solange es keines gibt. */
  async read(): Promise<string> {
    await this.queue;
    return fs.promises.readFile(this.file, 'utf8').catch(() => '');
  }

  /**
   * Erst das ersetzte, dann das aktuelle Protokoll (für „Show Log“): So fehlen nach einem Ersetzen die ersten Abstürze
   * einer Reihe nicht.
   */
  async readAll(): Promise<string> {
    await this.queue;
    const [old, current] = await Promise.all([this.oldFile, this.file].map((f) => fs.promises.readFile(f, 'utf8').catch(() => '')));
    return old + current;
  }

  private report(message: string): void {
    try {
      this.options.log?.(message);
    } catch {
      // Die Meldung ist nur ein Hinweis; das Protokoll geht vor.
    }
  }

  /** Das ersetzte Protokoll. */
  get oldFile(): string {
    return this.file.replace(/\.log$/i, '') + OLD_SUFFIX;
  }

  /** Ein einzelner Eintrag über der Grenze wird hinten gekürzt; vorne steht, was passiert ist. */
  private fit(text: string): string {
    if (Buffer.byteLength(text, 'utf8') <= this.maxBytes) return text;
    const marker = '\n… (cut to fit the log size)\n\n';
    const room = Math.max(0, this.maxBytes - Buffer.byteLength(marker, 'utf8'));
    const bytes = Buffer.from(text, 'utf8');
    // Nie mitten in einem Zeichen abschneiden (sonst stünde am Ende ein Ersatzzeichen).
    return bytes.subarray(0, utf8End(bytes, room)).toString('utf8') + marker;
  }
}
