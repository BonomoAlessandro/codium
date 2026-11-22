// Git-Dienst im Projekt-Kern (Ticket 15): ruft das installierte Git auf (Grundsätze in gitProcess.ts: kein Editor, keine
// Eingabeaufforderung im Terminal), liest maschinenlesbare Ausgaben, hält den Zustand des Repositorys aktuell und führt
// die Branch-Aktionen aus. Jeder Aufruf landet in der Git-Konsole. Lädt nie Electron.
//
// - Lesende Abfragen sperren den Index nicht (`--no-optional-locks`).
// - Schreibende Aktionen eines Projekts laufen nacheinander.
// - Der Zustand wird neu gelesen nach eigenen Aktionen, nach „Git-Daten geändert“, nach Dateiereignissen (gebündelt)
//   und auf Wunsch der Oberfläche (Fokus des Fensters).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ErrorCode, type CommandParams, type GitBranches, type GitConsoleEntry, type GitFileStatus, type GitState } from '../../../shared/types';
import { gitMessage, runGit, type GitRun } from '../gitProcess';
import type { ProjectCore } from '../projectCore';
import { CommandError } from '../router';

/** So viele Einträge hält die Git-Konsole pro Projektfenster. */
export const CONSOLE_LIMIT = 1000;
/** So lange bündelt der Dienst Ereignisse, bevor er den Zustand neu liest. */
const REFRESH_DELAY_MS = 300;

export interface GitServiceOptions {
  /** Pfad zum installierten Git; `null` ohne Git (dann sind alle Git-Funktionen aus). */
  git: string | null;
  /** Umgebung für Git; ohne Angabe die des Prozesses. */
  env?: NodeJS.ProcessEnv;
  log: (message: string) => void;
}

interface RunOptions {
  /** Hintergrundabfrage (nicht vom Nutzer ausgelöst, nicht schreibend, ohne Netz). */
  background?: boolean;
  /** Schreibende Aktion: läuft nach allen anderen schreibenden dieses Projekts. */
  write?: boolean;
}

const NO_REPOSITORY: GitState = { repository: false, branch: null, ahead: 0, behind: 0, files: [] };

export class GitService {
  private state: GitState = NO_REPOSITORY;
  private root: string | null = null;
  private gitDir: string | null = null;
  private readonly entries: GitConsoleEntry[] = [];
  /** Grenze der Konsole; Tests setzen eine kleinere, um nicht tausend Prozesse zu starten. */
  consoleLimit = CONSOLE_LIMIT;
  private nextEntryId = 1;
  private writeChain: Promise<unknown> = Promise.resolve();
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<GitState> | null = null;
  private refreshAgain = false;
  private watcher: fs.FSWatcher | null = null;
  private disposed = false;
  /** Laufende Aufrufe; der Abbau wartet auf sie (sie halten den Projektordner als Arbeitsordner). */
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly project: ProjectCore,
    private readonly options: GitServiceOptions,
  ) {
    project.onDispose(() => this.dispose());
    project.subscribe('git.dataChanged', () => this.scheduleRefresh());
    project.subscribe('files.changed', () => this.scheduleRefresh());
    project.subscribe('files.operation', () => this.scheduleRefresh());
    if (options.git) void this.refresh();
  }

  /** Der letzte bekannte Zustand. */
  current(): GitState {
    return this.state;
  }

  /** Die Einträge der Git-Konsole, älteste zuerst. */
  console(): GitConsoleEntry[] {
    return [...this.entries];
  }

  // ---------- Zustand ----------

  /** Liest den Zustand neu (gebündelt: läuft schon ein Lesen, folgt genau eines danach). */
  refresh(): Promise<GitState> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        let next: GitState;
        do {
          this.refreshAgain = false;
          next = await this.readState();
        } while (this.refreshAgain && !this.disposed);
        return next;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private scheduleRefresh(): void {
    if (!this.options.git || this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private async readState(): Promise<GitState> {
    if (!this.options.git) return this.publish(NO_REPOSITORY);
    const top = await this.run(['rev-parse', '--show-toplevel', '--absolute-git-dir'], { background: true });
    if (top.code !== 0) {
      this.root = null;
      this.gitDir = null;
      this.watchGitDir(null);
      return this.publish(NO_REPOSITORY);
    }
    const [root, gitDir] = top.stdout.split(/\r?\n/).map((l) => path.normalize(l.trim()));
    this.root = root;
    this.gitDir = gitDir;
    this.watchGitDir(gitDir);
    const status = await this.run(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--', '.'], {
      background: true,
    });
    if (status.code !== 0) return this.publish({ ...NO_REPOSITORY, repository: true, root });
    return this.publish({ ...parseStatus(status.stdout, root), ...(this.operation() ? { operation: this.operation()! } : {}) });
  }

  private operation(): GitState['operation'] | undefined {
    const dir = this.gitDir;
    if (!dir) return undefined;
    if (fs.existsSync(path.join(dir, 'rebase-merge')) || fs.existsSync(path.join(dir, 'rebase-apply'))) return 'rebase';
    if (fs.existsSync(path.join(dir, 'MERGE_HEAD'))) return 'merge';
    if (fs.existsSync(path.join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
    if (fs.existsSync(path.join(dir, 'REVERT_HEAD'))) return 'revert';
    return undefined;
  }

  private publish(state: GitState): GitState {
    const changed = JSON.stringify(state) !== JSON.stringify(this.state);
    this.state = state;
    if (changed && !this.disposed) this.project.emit('git.stateChanged', state);
    return state;
  }

  /**
   * Liegt das Git-Verzeichnis ausserhalb des Projekts (Worktree, Submodul, Projekt als Unterordner eines Repositorys),
   * meldet die Dateiüberwachung des Projekts keine „Git-Daten geändert“: Dann beobachtet der Dienst HEAD, Index und Refs
   * dort selbst (Hinweis aus dem Review von Ticket 04).
   */
  private watchGitDir(gitDir: string | null): void {
    const inside = gitDir !== null && isInside(gitDir, this.project.path);
    const wanted = gitDir !== null && !inside ? gitDir : null;
    if (this.watcher && (wanted === null || (this.watcher as fs.FSWatcher & { codiumDir?: string }).codiumDir !== wanted)) {
      this.watcher.close();
      this.watcher = null;
    }
    if (!wanted || this.watcher || this.disposed) return;
    try {
      const watcher = fs.watch(wanted, { recursive: true }, (_event, file) => {
        const name = String(file ?? '').replace(/\\/g, '/');
        if (name === '' || /^(HEAD|index|packed-refs|MERGE_HEAD|ORIG_HEAD|refs\/|rebase-)/.test(name)) this.scheduleRefresh();
      });
      watcher.on('error', () => {});
      (watcher as fs.FSWatcher & { codiumDir?: string }).codiumDir = wanted;
      this.watcher = watcher;
    } catch (err) {
      this.options.log(`Git-Verzeichnis ${wanted} lässt sich nicht beobachten: ${(err as Error).message}`);
    }
  }

  // ---------- Branches ----------

  async branches(): Promise<GitBranches> {
    await this.requireRepository();
    const result = await this.run(['for-each-ref', '--format=%(refname)%00%(upstream:short)%00%(HEAD)%00%(symref)', 'refs/heads', 'refs/remotes'], {
      background: true,
    });
    if (result.code !== 0) throw this.failure(result);
    const local: GitBranches['local'] = [];
    const remote: GitBranches['remote'] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line === '') continue;
      const [ref, upstream, head, symref] = line.split('\0');
      if (ref.startsWith('refs/heads/')) {
        local.push({ name: ref.slice('refs/heads/'.length), ...(upstream ? { upstream } : {}), current: head === '*' });
      } else if (ref.startsWith('refs/remotes/') && !symref) {
        const name = ref.slice('refs/remotes/'.length);
        remote.push({ name, remote: name.split('/')[0] });
      }
    }
    return { local, remote };
  }

  async createBranch(params: CommandParams<'git.createBranch'>): Promise<void> {
    const p = params as Partial<CommandParams<'git.createBranch'>>;
    const name = branchName(p?.name);
    const from = p?.from === undefined ? undefined : branchName(p.from);
    await this.requireRepository();
    const args = p.checkout === true ? ['checkout', '-b', name, ...(from ? [from] : [])] : ['branch', name, ...(from ? [from] : [])];
    await this.write(args);
  }

  async checkout(params: CommandParams<'git.checkout'>): Promise<void> {
    const name = branchName((params as Partial<CommandParams<'git.checkout'>>)?.name);
    await this.requireRepository();
    await this.write(['checkout', name]);
  }

  async checkoutRemote(params: CommandParams<'git.checkoutRemote'>): Promise<{ local: string }> {
    const name = branchName((params as Partial<CommandParams<'git.checkoutRemote'>>)?.name);
    await this.requireRepository();
    const slash = name.indexOf('/');
    if (slash <= 0) throw new CommandError('A remote branch (remote/name) is expected.', ErrorCode.invalidParams);
    const local = name.slice(slash + 1);
    // Gibt es den lokalen Branch schon, wird er ausgecheckt; sonst einer angelegt, der dem Remote-Branch folgt.
    const exists = (await this.run(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], { background: true })).code === 0;
    await this.write(exists ? ['checkout', local] : ['checkout', '--track', '-b', local, name]);
    return { local };
  }

  async renameBranch(params: CommandParams<'git.renameBranch'>): Promise<void> {
    const p = params as Partial<CommandParams<'git.renameBranch'>>;
    const name = branchName(p?.name);
    const newName = branchName(p?.newName);
    await this.requireRepository();
    await this.write(['branch', '-m', name, newName]);
  }

  async deleteBranch(params: CommandParams<'git.deleteBranch'>): Promise<void> {
    const p = params as Partial<CommandParams<'git.deleteBranch'>>;
    const name = branchName(p?.name);
    await this.requireRepository();
    if (this.state.branch === name) {
      throw new CommandError(`The current branch “${name}” cannot be deleted. Check out another branch first.`, ErrorCode.gitFailed);
    }
    await this.write(['branch', p.force === true ? '-D' : '-d', name]);
  }

  // ---------- Aufrufe ----------

  /** Eine schreibende Aktion: nacheinander, mit Fehler im Wortlaut von Git, danach neuer Zustand. */
  private async write(args: string[]): Promise<GitRun> {
    const result = await this.run(args, { write: true });
    await this.refresh();
    if (result.code !== 0) throw this.failure(result);
    return result;
  }

  /** Ruft Git im Projektordner auf und schreibt den Aufruf in die Konsole. Für Tests öffentlich. */
  run(args: string[], options: RunOptions = {}): Promise<GitRun> {
    const git = this.options.git;
    if (!git) return Promise.reject(new CommandError('Git not found. Install Git to use Git functions.', ErrorCode.gitNotFound));
    const task = async (): Promise<GitRun> => {
      const entry: GitConsoleEntry = {
        id: this.nextEntryId++,
        time: Date.now(),
        command: ['git', ...args].map(quote).join(' '),
        output: '',
        exitCode: null,
        background: options.background === true,
      };
      this.addEntry(entry);
      let result: GitRun;
      if (this.disposed) return { code: null, stdout: '', stderr: 'The project is closing.' };
      const call = runGit(git, args, { cwd: this.project.path, env: this.options.env });
      this.running.add(call);
      void call.finally(() => this.running.delete(call)).catch(() => {});
      try {
        result = await call;
      } catch (err) {
        result = { code: null, stdout: '', stderr: (err as Error).message };
      }
      entry.output = `${result.stdout}${result.stderr}`.trimEnd();
      entry.exitCode = result.code;
      if (!this.disposed) this.project.emit('git.console', { ...entry });
      return result;
    };
    if (!options.write) return task();
    const next = this.writeChain.then(task, task);
    this.writeChain = next.catch(() => {});
    return next;
  }

  private addEntry(entry: GitConsoleEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.consoleLimit) this.entries.splice(0, this.entries.length - this.consoleLimit);
    if (!this.disposed) this.project.emit('git.console', { ...entry });
  }

  /** Der Fehler eines Aufrufs: die Meldung von Git im Wortlaut; ein verweigerter Wechsel mit den Dateien. */
  private failure(result: GitRun): CommandError {
    const message = gitMessage(result.stderr) || gitMessage(result.stdout) || `git failed with exit code ${result.code}.`;
    if (/not fully merged/i.test(result.stderr)) return new CommandError(message, ErrorCode.gitNotMerged);
    const blocked = /following (?:untracked working tree )?files would be (?:overwritten|removed) by checkout:\s*\n([\s\S]*?)\n(?:Please|Aborting)/i.exec(result.stderr);
    if (blocked) {
      const files = blocked[1]
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((f) => path.join(this.root ?? this.project.path, f));
      return new CommandError(message, ErrorCode.gitCheckoutBlocked, { files });
    }
    return new CommandError(message, ErrorCode.gitFailed);
  }

  private async requireRepository(): Promise<void> {
    if (!this.options.git) throw new CommandError('Git not found. Install Git to use Git functions.', ErrorCode.gitNotFound);
    if (!this.root) await this.refresh();
    if (!this.root) throw new CommandError('Not a Git repository.', ErrorCode.notARepository);
  }

  private async dispose(): Promise<void> {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.watcher?.close();
    this.watcher = null;
    await Promise.allSettled([...this.running]);
  }
}

/** Ein Branchname aus der Oberfläche: nicht leer, ohne führendes „-“ (wäre eine Option für Git). */
function branchName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-') || /[\s~^:?*[\\]|\.\.|@\{/.test(value)) {
    throw new CommandError(`Not a valid branch name: ${String(value)}`, ErrorCode.invalidParams);
  }
  return value.trim();
}

function quote(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function isInside(target: string, dir: string): boolean {
  const t = path.normalize(target).toLowerCase();
  const d = path.normalize(dir).toLowerCase();
  return t === d || t.startsWith(d + path.sep);
}

/** Liest die Ausgabe von `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string, root: string): GitState {
  const state: GitState = { repository: true, root, branch: null, ahead: 0, behind: 0, files: [] };
  let oid = '';
  const fields = output.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i];
    if (line === '') continue;
    if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length);
    else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length);
      state.branch = head === '(detached)' ? null : head;
    } else if (line.startsWith('# branch.upstream ')) state.upstream = line.slice('# branch.upstream '.length);
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        state.ahead = Number(m[1]);
        state.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ')) {
      const parts = line.split(' ');
      state.files.push({ path: path.join(root, parts.slice(8).join(' ')), index: parts[1][0], worktree: parts[1][1] });
    } else if (line.startsWith('2 ')) {
      const parts = line.split(' ');
      // Bei Umbenennungen folgt der alte Pfad als eigenes Feld.
      const origPath = fields[++i];
      state.files.push({
        path: path.join(root, parts.slice(9).join(' ')),
        index: parts[1][0],
        worktree: parts[1][1],
        origPath: path.join(root, origPath),
      });
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ');
      state.files.push({ path: path.join(root, parts.slice(10).join(' ')), index: 'U', worktree: 'U', conflict: true });
    } else if (line.startsWith('? ')) {
      state.files.push({ path: path.join(root, line.slice(2)), index: '?', worktree: '?' });
    }
  }
  if (state.branch === null && oid && oid !== '(initial)') state.detached = oid.slice(0, 8);
  return state;
}
