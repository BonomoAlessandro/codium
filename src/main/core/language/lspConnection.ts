// Verbindung zu einem Sprachserver über stdio (Language Server Protocol, JSON-RPC mit „Content-Length“-Kopf). Lädt nie
// Electron.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { STDERR_TAIL_BYTES, TailBuffer } from './serverLog';

/** Antwort auf eine Anfrage des Servers an den Client (etwa `workspace/configuration`). */
export type ServerRequestHandler = (method: string, params: unknown) => unknown;

export interface LspStartOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onNotification: (method: string, params: unknown) => void;
  onRequest: ServerRequestHandler;
  /** Der Server ist beendet (abgestürzt oder nach `exit`); ohne Code mit Signal, ohne beides liess er sich nicht starten. */
  onExit: (code: number | null, signal: string | null) => void;
  log: (message: string) => void;
  /** So viel vom Ende von stderr heben wir auf (Ticket 30); ohne Angabe 64 KB. */
  stderrBytes?: number;
}

export class LspError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

/** Ab dieser Dauer gilt eine Anfrage als gescheitert (der Server hängt). */
const REQUEST_TIMEOUT_MS = 30_000;

export class LspConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private exited = false;
  readonly exit: Promise<void>;
  /** Das Ende von stderr, für das Protokoll der Sprachserver (Ticket 30). */
  private readonly stderrTail: TailBuffer;
  /** Erfüllt, sobald stderr zu ist (alles gelesen); kann nach `exit` kommen. */
  readonly stderrClosed: Promise<void>;
  /** Warum sich das Programm nicht starten liess (etwa ENOENT). */
  private spawnError: string | null = null;

  constructor(private readonly options: LspStartOptions) {
    this.stderrTail = new TailBuffer(options.stderrBytes ?? STDERR_TAIL_BYTES);
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exit = new Promise((resolve) => {
      const done = (code: number | null, signal: string | null) => {
        if (this.exited) return;
        this.exited = true;
        for (const { reject, timer } of this.pending.values()) {
          clearTimeout(timer);
          reject(new Error('The language server has stopped.'));
        }
        this.pending.clear();
        options.onExit(code, signal);
        resolve();
      };
      this.child.on('exit', (code, signal) => done(code, signal));
      this.child.on('error', (err) => {
        options.log(`Sprachserver ließ sich nicht starten: ${err.message}`);
        this.spawnError = err.message;
        done(null, null);
      });
    });
    this.stderrClosed = new Promise((resolve) => {
      this.child.stderr.once('close', () => resolve());
      this.child.stderr.once('error', () => resolve());
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    // stderr wird immer gelesen (sonst füllt sich der Puffer und der Server hängt); das Ende bleibt fürs Protokoll.
    this.child.stderr.on('data', (chunk: Buffer) => this.stderrTail.push(chunk));
    this.child.stdin.on('error', () => {});
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get running(): boolean {
    return !this.exited;
  }

  /** Das aufgehobene Ende von stderr. */
  get stderr(): { text: string; truncated: boolean } {
    return this.stderrTail.read();
  }

  /** Warum sich das Programm nicht starten liess; `null`, wenn es lief. */
  get startError(): string | null {
    return this.spawnError;
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.exited) return Promise.reject(new Error('The language server has stopped.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The language server did not answer ${method} in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.exited) this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    try {
      this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
    } catch {
      // Der Server ist gerade beendet; `exit` meldet das.
    }
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const length = /Content-Length:\s*(\d+)/i.exec(header);
      if (!length) {
        // Kaputter Kopf: verwerfen bis hinter ihn.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      const end = start + Number(length[1]);
      if (this.buffer.length < end) return;
      const body = this.buffer.subarray(start, end).toString('utf8');
      this.buffer = this.buffer.subarray(end);
      let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }): void {
    if (message.method !== undefined && message.id !== undefined) {
      // Anfrage des Servers an den Client.
      let result: unknown = null;
      try {
        result = this.options.onRequest(message.method, message.params) ?? null;
      } catch {
        result = null;
      }
      this.send({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    if (message.method !== undefined) {
      this.options.onNotification(message.method, message.params);
      return;
    }
    if (typeof message.id !== 'number') return;
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new LspError(message.error.message, message.error.code));
    else waiting.resolve(message.result);
  }
}
