// Liest die Ausgabe eines laufenden `git log` seitenweise (Ticket 19): Der Prozess läuft weiter, seine Ausgabe wird
// angehalten, sobald genug Commits für die angefragte Seite gelesen sind. Lädt nie Electron.

import { spawn, type ChildProcess } from 'node:child_process';
import { gitEnvironment } from '../gitProcess';
import { killProcessTree } from '../processTree';

/** Trennzeichen im Format von `git log`: Datensätze mit RS, Felder mit NUL. */
export const RECORD = '\x1e';
export const FIELD = '\x00';

export class LogReader {
  private readonly child: ChildProcess;
  private buffer = '';
  private readonly records: string[][] = [];
  private ended = false;
  private failure: string | null = null;
  private stderr = '';
  private waiters: Array<() => void> = [];

  constructor(git: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
    this.child = spawn(git, args, { cwd: options.cwd, env: gitEnvironment(options.env ?? process.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout!.setEncoding('utf8');
    // Gelesen wird erst, wenn eine Seite gefragt ist.
    this.child.stdout!.pause();
    this.child.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf(RECORD)) >= 0) {
        const record = this.buffer.slice(0, index).replace(/^\n+/, '');
        this.buffer = this.buffer.slice(index + 1);
        this.records.push(record.split(FIELD));
      }
      this.wake();
    });
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (chunk: string) => {
      if (this.stderr.length < 16 * 1024) this.stderr += chunk;
    });
    this.child.on('error', (err) => {
      this.failure = err.message;
      this.ended = true;
      this.wake();
    });
    this.child.on('close', (code) => {
      if (code !== 0 && code !== null && this.failure === null) this.failure = this.stderr.trim() || `git log failed with exit code ${code}.`;
      this.ended = true;
      this.wake();
    });
  }

  /** Der Prozess ist beendet und alles gelesen. */
  get done(): boolean {
    return this.ended && this.records.length === 0;
  }

  /** Bis zu `count` weitere Datensätze; weniger nur am Ende. Wirft, wenn Git scheiterte. */
  async take(count: number): Promise<string[][]> {
    while (this.records.length < count && !this.ended) {
      this.child.stdout!.resume();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (this.failure !== null && this.records.length === 0) throw new Error(this.failure);
    const taken = this.records.splice(0, count);
    // Zwischen den Seiten ruht die Ausgabe (Git wartet dann am vollen Puffer).
    if (!this.ended) this.child.stdout!.pause();
    return taken;
  }

  /** Beendet Git (samt Kindprozessen). */
  async dispose(): Promise<void> {
    this.ended = true;
    this.wake();
    if (this.child.exitCode === null && this.child.pid !== undefined) {
      this.child.stdout?.destroy();
      await killProcessTree(this.child.pid).catch(() => {});
    }
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }
}
