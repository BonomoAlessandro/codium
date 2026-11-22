// Terminal-Dienst (Ticket 11): Shells über node-pty, eine pro Terminal-Tab, technisch wie in THub. Die Oberfläche zeigt
// sie mit xterm.js. Lädt nie Electron.
//
// - Gestartet wird die eingestellte Shell im Projektordner oder in einem Ordner im Projekt; die Profile laden normal.
// - Schliessen beendet die Shell samt allem, was sie gestartet hat (`taskkill /T`), danach die Pseudokonsole.
// - Beim Abbau des Projekt-Kerns beendet der Dienst alle Shells und wartet darauf (höchstens einige Sekunden).
// - Pseudokonsole ist die mit node-pty gelieferte ConPTY (wie im Windows Terminal, schneller als die von Windows); lässt
//   sie sich nicht starten, die von Windows.

import * as pty from 'node-pty';
import { ErrorCode, type CommandParams, type CommandResult, type ShellInfo } from '../../shared/types';
import { consoleHostsOf, killProcessTree } from './processTree';
import type { ProjectCore } from './projectCore';
import { CommandError } from './router';
import { shellArgs, shellEnvironment } from './shells';

/** So lange wartet das Schliessen höchstens auf das Ende der Shell. */
const EXIT_WAIT_MS = 3000;
/** Grenzen der Grösse in Zeichen. */
const MAX_COLS = 1000;
const MAX_ROWS = 500;

export interface TerminalServiceOptions {
  /** Die Shell für ein neues Terminal (aus den Einstellungen); `null`, wenn es keine gibt. */
  shell: () => ShellInfo | null;
  /** Grundumgebung der Shells; ohne Angabe die des Prozesses. */
  env?: NodeJS.ProcessEnv;
  log: (message: string) => void;
  /** `false`: gleich die ConPTY von Windows (der Rückfallweg; für Tests). */
  bundledConpty?: boolean;
}

interface Terminal {
  proc: pty.IPty;
  exited: Promise<void>;
  /** Ob Codium die Shell beendet (dann schliesst `kill` die Pseudokonsole). */
  killed: boolean;
  /** conhost.exe der Pseudokonsole (nur mit der ConPTY von Windows). */
  host?: number;
}

/** Was node-pty 1.1.0 intern hat und hier gebraucht wird; jedes Feld kann in einer anderen Version fehlen. */
interface PtyInternals {
  _agent?: { _getConsoleProcessList?: () => Promise<number[]>; _conoutSocketWorker?: { dispose?: () => void } };
}

export class TerminalService {
  private readonly terminals = new Map<number, Terminal>();
  private nextId = 1;
  /** Ob die mitgelieferte ConPTY geht; nach einem Fehlschlag die von Windows. */
  private bundledConpty = true;
  private disposed = false;

  constructor(
    private readonly project: ProjectCore,
    private readonly options: TerminalServiceOptions,
  ) {
    this.bundledConpty = options.bundledConpty ?? true;
    project.onDispose(() => this.closeAll());
  }

  async start(params: CommandParams<'terminal.start'>): Promise<CommandResult<'terminal.start'>> {
    const p = (params ?? {}) as Partial<CommandParams<'terminal.start'>>;
    const cols = size(p.cols, MAX_COLS);
    const rows = size(p.rows, MAX_ROWS);
    const cwd = p.cwd === undefined ? this.project.path : await this.project.files.existingFolder(p.cwd);
    if (this.disposed) throw new CommandError('The project is closing.', ErrorCode.noProject);
    const shell = this.options.shell();
    if (!shell) throw new CommandError('No shell was found for the terminal.', ErrorCode.shellNotFound);

    // Mit der ConPTY von Windows bleibt nach dem Ende der Shell ihr conhost.exe stehen; er wird hier ermittelt (vorher
    // und nachher abfragen, wie in THub) und nach dem Ende beendet. Die mitgelieferte ConPTY endet von selbst.
    const windowsConpty = !this.bundledConpty;
    const hostsBefore = windowsConpty ? await consoleHostsOf(process.pid) : [];
    const proc = this.spawn(shell, cwd, cols, rows);
    const host = windowsConpty
      ? consoleHostsOf(process.pid).then((after) => after.filter((h) => !hostsBefore.includes(h) && ![...this.terminals.values()].some((t) => t.host === h)))
      : Promise.resolve([]);
    const terminalId = this.nextId++;
    const exited = new Promise<void>((resolve) => {
      proc.onExit(({ exitCode }) => {
        const own = this.terminals.get(terminalId);
        this.terminals.delete(terminalId);
        // Endet die Shell selbst (`exit`, Absturz), schliesst node-pty die Pseudokonsole nicht: ohne Aufräumen blieben ein
        // Worker-Thread und mit der ConPTY von Windows ein conhost.exe bis zum Ende von Codium (THub, Review von Ticket 11).
        if (own && !own.killed) closeEndedPty(proc, host);
        this.project.emit('terminal.exit', { terminalId, exitCode });
        resolve();
      });
    });
    proc.onData((data) => this.project.emit('terminal.data', { terminalId, data }));
    const terminal: Terminal = { proc, exited, killed: false };
    void host.then((found) => {
      terminal.host = found[0];
    });
    this.terminals.set(terminalId, terminal);
    return { terminalId, shell: shell.name, cwd };
  }

  write(params: CommandParams<'terminal.write'>): void {
    const p = params as Partial<CommandParams<'terminal.write'>>;
    if (typeof p?.data !== 'string') throw new CommandError('Terminal input is expected.', ErrorCode.invalidParams);
    this.terminals.get(terminalIdOf(p))?.proc.write(p.data);
  }

  resize(params: CommandParams<'terminal.resize'>): void {
    const p = params as Partial<CommandParams<'terminal.resize'>>;
    const terminal = this.terminals.get(terminalIdOf(p));
    if (!terminal) return;
    try {
      terminal.proc.resize(size(p.cols, MAX_COLS), size(p.rows, MAX_ROWS));
    } catch {
      // Eine gerade beendete Shell: harmlos.
    }
  }

  async close(params: CommandParams<'terminal.close'>): Promise<void> {
    const id = terminalIdOf(params as Partial<CommandParams<'terminal.close'>>);
    const terminal = this.terminals.get(id);
    if (terminal) await this.kill(terminal);
  }

  /** Prozessnummer der Shell eines Terminals (für Tests). */
  pidOf(terminalId: number): number | undefined {
    return this.terminals.get(terminalId)?.proc.pid;
  }

  /** Beendet alle Shells (beim Abbau des Projekt-Kerns). */
  private async closeAll(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.terminals.values()].map((t) => this.kill(t)));
  }

  /** Beendet die Shell samt Kindern, dann die Pseudokonsole, und wartet auf das Ende (höchstens `EXIT_WAIT_MS`). */
  private async kill(terminal: Terminal): Promise<void> {
    terminal.killed = true;
    await killProcessTree(terminal.proc.pid);
    try {
      terminal.proc.kill();
    } catch {
      // Schon beendet.
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([terminal.exited, new Promise<void>((resolve) => (timer = setTimeout(resolve, EXIT_WAIT_MS)))]);
    clearTimeout(timer);
  }

  private spawn(shell: ShellInfo, cwd: string, cols: number, rows: number): pty.IPty {
    const options = (useConptyDll: boolean): pty.IWindowsPtyForkOptions => ({
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: shellEnvironment(this.options.env ?? process.env),
      useConpty: true,
      useConptyDll,
    });
    const started = (() => {
      if (!this.bundledConpty) return pty.spawn(shell.path, shellArgs(shell), options(false));
      try {
        return pty.spawn(shell.path, shellArgs(shell), options(true));
      } catch (bundledError) {
        const proc = pty.spawn(shell.path, shellArgs(shell), options(false));
        this.bundledConpty = false;
        this.options.log(`Die mitgelieferte ConPTY lässt sich nicht starten, die Shells laufen über die von Windows: ${(bundledError as Error).message}`);
        return proc;
      }
    })();
    // node-pty listet beim Beenden über einen Hilfsprozess die Prozesse der Konsole und beendet ersatzweise nach 5 s die
    // Prozess-ID der Shell, die inzwischen ein anderer Prozess haben kann (THub). Codium beendet den Prozessbaum selbst.
    const agent = (started as unknown as PtyInternals)._agent;
    if (agent && typeof agent._getConsoleProcessList === 'function') agent._getConsoleProcessList = () => Promise.resolve([]);
    return started;
  }
}

/** Nach dem Ende einer Shell: Pseudokonsole schliessen und den Worker von node-pty freigeben. */
function closeEndedPty(proc: pty.IPty, host: Promise<number[]>): void {
  void host.then((found) => {
    for (const pid of found) {
      try {
        process.kill(pid);
      } catch {
        // Schon beendet.
      }
    }
  });
  try {
    (proc as unknown as PtyInternals)._agent?._conoutSocketWorker?.dispose?.();
  } catch {
    // Schon aufgeräumt.
  }
}


function terminalIdOf(params: { terminalId?: unknown } | undefined): number {
  const id = params?.terminalId;
  if (typeof id !== 'number' || !Number.isInteger(id)) throw new CommandError('A terminal id is expected.', ErrorCode.invalidParams);
  return id;
}

function size(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new CommandError('The terminal size must be positive whole numbers.', ErrorCode.invalidParams);
  }
  return Math.min(value, max);
}
