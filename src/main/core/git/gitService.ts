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
import { ErrorCode, type ChangeBlock, type CommandParams, type CommandResult, type TextEncoding, type GitBranches, type GitCommitDetails, type GitConsoleEntry, type GitLogCommit, type GitLogFilter, type GitLogPage, type GitRefLabel, type GitFileStatus, type GitState } from '../../../shared/types';
import { gitMessage, runGit, type GitRun } from '../gitProcess';
import { decodeAs, decodeText } from '../fileContent';
import { changeBlocks } from './lineDiff';
import { LogGraph } from './logGraph';
import { LogReader } from './logReader';
import { recentBranches, reflogMessages } from './recentBranches';
import type { ProjectCore } from '../projectCore';
import { CommandError } from '../router';

/** So viele Einträge hält die Git-Konsole pro Projektfenster. */
export const CONSOLE_LIMIT = 1000;
/** So lange bündelt der Dienst Ereignisse, bevor er den Zustand neu liest, höchstens aber so lange. */
const REFRESH_DELAY_MS = 300;
const REFRESH_MAX_DELAY_MS = 2000;
/** So viel Ausgabe hält ein Eintrag der Git-Konsole höchstens. */
const OUTPUT_LIMIT = 16 * 1024;

export interface GitServiceOptions {
  /** Pfad zum installierten Git; `null` ohne Git (dann sind alle Git-Funktionen aus). */
  git: string | null;
  /** Umgebung für Git; ohne Angabe die des Prozesses. */
  env?: NodeJS.ProcessEnv;
  /** In den Papierkorb (Port „Shell-Aktionen“), für Rollback hinzugefügter Dateien. */
  trash: (file: string) => Promise<void>;
  /** In die Zwischenablage (Port „Shell-Aktionen“; im Testmodus nur aufgezeichnet), für „Copy Revision Number“. */
  writeClipboard: (text: string) => Promise<void>;
  log: (message: string) => void;
}

interface RunOptions {
  /** Hintergrundabfrage (nicht vom Nutzer ausgelöst, nicht schreibend, ohne Netz). */
  background?: boolean;
  /** Schreibende Aktion: läuft nach allen anderen schreibenden dieses Projekts. */
  write?: boolean;
  /** Pfade für `--pathspec-from-file=- --pathspec-file-nul` (über stdin, ohne Grenze der Befehlszeile). */
  pathspecs?: string[];
}

/** So viele Commits liest der Log je Seite. */
const LOG_PAGE = 500;

/**
 * So viel vom Ende des Reflogs von HEAD liest der Dienst für die zuletzt benutzten Branches (Ticket 31): 512 KB, je
 * nach Länge der Nachrichten 2'500 bis 4'000 Einträge, in wenigen Millisekunden. Ältere Wechsel zählen nicht mehr.
 */
export const REFLOG_TAIL_BYTES = 512 * 1024;
/** Ebenso viele Einträge, wenn Git den Reflog liefern muss (Ref-Speicher „reftable“). */
const REFLOG_ENTRIES = 3000;

interface LogSession {
  key: string;
  version: number;
  reader: LogReader;
  /** `null` mit Text- oder Autorfilter (dann gibt es keinen Graph). */
  graph: LogGraph | null;
  commits: GitLogCommit[];
  remotes: string[];
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
  private readonly watchers = new Map<string, fs.FSWatcher>();
  /** Umbenennungen, deren Ziel schon weiter umbenannt war: neues Ziel → ursprünglicher Pfad. */
  private readonly pendingRenames = new Map<string, string>();
  private lastRepositoryError: string | null = null;
  /** Bis zur ersten Abfrage ist der Zustand unbekannt; `git.state` wartet dann auf sie (Review von Ticket 15). */
  private firstRead: Promise<GitState> | null = null;
  private disposed = false;
  /** Laufende Aufrufe; der Abbau wartet auf sie (sie halten den Projektordner als Arbeitsordner). */
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly project: ProjectCore,
    private readonly options: GitServiceOptions,
  ) {
    project.onDispose(() => this.dispose());
    project.subscribe('git.dataChanged', () => {
      // HEAD oder Index haben sich geändert: Der Vergleichsstand der Änderungsbalken gilt nicht mehr.
      this.baseCache.clear();
      this.scheduleRefresh();
    });
    project.subscribe('files.changed', () => this.scheduleRefresh());
    project.subscribe('files.operation', (op) => {
      // Umbenennen im Dateibaum: bei einer versionierten Datei im Index vormerken, damit Git die Umbenennung sieht.
      if (op.kind === 'renamed') void this.recordRename(op.from, op.to);
      this.scheduleRefresh();
    });
    if (options.git) this.firstRead = this.refresh();
  }

  /** Der Zustand; vor der ersten Abfrage wartet er auf sie (sonst zeigte die Oberfläche kurz „kein Repository“). */
  async current(): Promise<GitState> {
    if (this.firstRead) await this.firstRead.catch(() => {});
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

  private firstPending: number | null = null;

  private scheduleRefresh(): void {
    if (!this.options.git || this.disposed) return;
    const now = Date.now();
    this.firstPending ??= now;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // Bei andauernden Ereignissen (etwa ein langer Fetch) spätestens nach REFRESH_MAX_DELAY_MS.
    const delay = Math.max(0, Math.min(REFRESH_DELAY_MS, this.firstPending + REFRESH_MAX_DELAY_MS - now));
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.firstPending = null;
      void this.refresh();
    }, delay);
  }

  private async readState(): Promise<GitState> {
    if (!this.options.git) return this.publish(NO_REPOSITORY);
    const top = await this.run(['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'], { background: true });
    if (top.code !== 0) {
      this.root = null;
      this.gitDir = null;
      this.watchGitDir([]);
      // Ein kaputtes Repository oder eines, dem Git nicht traut („dubious ownership“), ist nicht dasselbe wie keines:
      // die Meldung von Git zeigen, einmal je Meldung (Review von Ticket 15).
      const message = gitMessage(top.stderr);
      if (message && !/not a git repository/i.test(message) && message !== this.lastRepositoryError) {
        this.lastRepositoryError = message;
        this.project.notify({ level: 'error', text: message });
      }
      return this.publish(NO_REPOSITORY);
    }
    this.lastRepositoryError = null;
    const [root, gitDir, commonRaw] = top.stdout.split(/\r?\n/).map((l) => l.trim());
    const common = path.resolve(this.project.path, commonRaw);
    this.root = path.normalize(root);
    this.gitDir = path.normalize(gitDir);
    // Worktrees: HEAD und Index im eigenen Git-Verzeichnis, Refs im gemeinsamen des Haupt-Repositorys.
    this.watchGitDir([...new Set([this.gitDir, path.normalize(common)])]);
    // Mit ignorierten Dateien (für die Farben im Dateibaum; ein ignorierter Ordner wie node_modules als ein Eintrag, nicht jede Datei darin).
    const status = await this.run(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=matching', '--', '.'], {
      background: true,
    });
    if (status.code !== 0) return this.publish({ ...NO_REPOSITORY, repository: true, root: this.root });
    await this.checkRefs();
    return this.publish({ ...parseStatus(status.stdout, this.root), ...(this.operation() ? { operation: this.operation()! } : {}) });
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
    // Jede Änderung des Zustands (etwa nach einem Commit, auch ausserhalb des Projekts) kann HEAD betreffen.
    if (changed) this.baseCache.clear();
    this.state = state;
    if (changed && !this.disposed) this.project.emit('git.stateChanged', state);
    return state;
  }

  /**
   * Liegt das Git-Verzeichnis ausserhalb des Projekts (Worktree, Submodul, Projekt als Unterordner eines Repositorys),
   * meldet die Dateiüberwachung des Projekts keine „Git-Daten geändert“: Dann beobachtet der Dienst HEAD, Index und Refs
   * dort selbst (Hinweis aus dem Review von Ticket 04).
   */
  private watchGitDir(dirs: string[]): void {
    // Ein Git-Verzeichnis im Projekt meldet die Dateiüberwachung des Projekts selbst.
    const wanted = dirs.filter((d) => !isInside(d, this.project.path));
    for (const [dir, watcher] of this.watchers) {
      if (wanted.includes(dir)) continue;
      watcher.close();
      this.watchers.delete(dir);
    }
    if (this.disposed) return;
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue;
      try {
        const watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
          const name = String(file ?? '').replace(/\\/g, '/');
          if (name === '' || /^(HEAD|index|packed-refs|MERGE_HEAD|ORIG_HEAD|refs\/|rebase-|worktrees\/[^/]+\/(HEAD|index))/.test(name)) this.scheduleRefresh();
        });
        watcher.on('error', () => {});
        this.watchers.set(dir, watcher);
      } catch (err) {
        this.options.log(`Git-Verzeichnis ${dir} lässt sich nicht beobachten: ${(err as Error).message}`);
      }
    }
  }

  // ---------- Branches ----------

  async branches(): Promise<GitBranches> {
    await this.requireRepository();
    const [result, reflog] = await Promise.all([
      this.run(['for-each-ref', '--format=%(refname)%00%(upstream:short)%00%(HEAD)%00%(symref)%00%(upstream:track,nobracket)', 'refs/heads', 'refs/remotes'], {
        background: true,
      }),
      this.headReflog(),
    ]);
    if (result.code !== 0) throw this.failure(result);
    const local: GitBranches['local'] = [];
    const remote: GitBranches['remote'] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line === '') continue;
      const [ref, upstream, head, symref, track] = line.split('\0');
      if (ref.startsWith('refs/heads/')) {
        const ahead = Number(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0);
        const behind = Number(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0);
        local.push({
          name: ref.slice('refs/heads/'.length),
          ...(upstream ? { upstream } : {}),
          current: head === '*',
          ...(ahead ? { ahead } : {}),
          ...(behind ? { behind } : {}),
        });
      } else if (ref.startsWith('refs/remotes/') && !symref) {
        const name = ref.slice('refs/remotes/'.length);
        remote.push({ name, remote: name.split('/')[0] });
      }
    }
    // Ein Repository ohne Commits: Der aktuelle Branch ist noch ungeboren und steht nicht in den Refs.
    if (this.state.branch && !local.some((b) => b.current)) local.unshift({ name: this.state.branch, current: true });
    const current = local.find((b) => b.current)?.name ?? null;
    return { local, remote, recent: recentBranches(reflog, local.map((b) => b.name), current) };
  }

  /**
   * Die Nachrichten im Reflog von HEAD, die neueste zuerst (Ticket 31). Git liest für `git log -g` immer den ganzen
   * Reflog, auch mit `-n` (gemessen mit 200'000 Einträgen, 28 MB: 0,7 bis 1,7 s); deshalb liest der Dienst nur das Ende
   * der Datei selbst. Ohne Datei (etwa mit dem Ref-Speicher „reftable“) fragt er Git nach den neuesten Einträgen.
   */
  private async headReflog(): Promise<string[]> {
    const dir = this.gitDir;
    if (!dir) return [];
    try {
      return await readReflogTail(path.join(dir, 'logs', 'HEAD'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return [];
    }
    // Ohne Datei gibt es entweder noch keinen Eintrag (etwa ohne Commit) oder die Refs liegen in „reftable“.
    if (!fs.existsSync(path.join(dir, 'reftable'))) return [];
    const result = await this.run(['--no-optional-locks', 'log', '-g', '--format=%gs', `-n${REFLOG_ENTRIES}`, 'HEAD', '--'], { background: true });
    return result.code === 0 ? result.stdout.split(/\r?\n/).filter((line) => line !== '') : [];
  }

  async createBranch(params: CommandParams<'git.createBranch'>): Promise<void> {
    const p = params as Partial<CommandParams<'git.createBranch'>>;
    const name = branchName(p?.name);
    const from = p?.from === undefined ? undefined : branchName(p.from);
    await this.requireRepository();
    // `switch` fasst nie Pfade an (anders als `checkout`, bei dem ein Name wie „docs“ oder „.“ lokale Änderungen
    // verwerfen kann; Review von Ticket 15).
    const args = p.checkout === true ? ['switch', '-c', name, ...(from ? [from] : [])] : ['branch', name, ...(from ? [from] : [])];
    await this.write(args);
  }

  async checkout(params: CommandParams<'git.checkout'>): Promise<void> {
    const name = branchName((params as Partial<CommandParams<'git.checkout'>>)?.name);
    await this.requireRepository();
    await this.write(['switch', '--no-guess', name]);
  }

  async checkoutRemote(params: CommandParams<'git.checkoutRemote'>): Promise<{ local: string }> {
    const name = branchName((params as Partial<CommandParams<'git.checkoutRemote'>>)?.name);
    await this.requireRepository();
    const slash = name.indexOf('/');
    if (slash <= 0) throw new CommandError('A remote branch (remote/name) is expected.', ErrorCode.invalidParams);
    const local = name.slice(slash + 1);
    // Gibt es den lokalen Branch schon, wird er ausgecheckt; sonst einer angelegt, der dem Remote-Branch folgt.
    // Prüfung und Wechsel zusammen in der Schreibreihe: Zwei gleichzeitige Aufrufe sehen sonst beide „nicht da“.
    await this.serial(async () => {
      const exists = (await this.run(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], { background: true })).code === 0;
      const result = await this.run(exists ? ['switch', '--no-guess', local] : ['switch', '--track', '-c', local, name]);
      await this.refresh();
      if (result.code !== 0) throw this.failure(result);
    });
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
    // „Nicht gemergt“ selbst prüfen (Git meldet es übersetzt, je nach Sprache): gemergt heisst, der Branch ist in HEAD
    // oder in seinem Upstream enthalten, wie bei `git branch -d`.
    if (p.force !== true && !(await this.isMerged(name))) {
      throw new CommandError(`The branch '${name}' is not fully merged.`, ErrorCode.gitNotMerged);
    }
    await this.write(['branch', '-D', name]);
  }

  private async isMerged(name: string): Promise<boolean> {
    const upstream = (await this.run(['rev-parse', '--abbrev-ref', `${name}@{upstream}`], { background: true })).stdout.trim();
    for (const base of ['HEAD', ...(upstream ? [upstream] : [])]) {
      if ((await this.run(['merge-base', '--is-ancestor', `refs/heads/${name}`, base], { background: true })).code === 0) return true;
    }
    return false;
  }

  // ---------- Vergleich und Änderungsblöcke (Ticket 17) ----------

  /**
   * Inhalt einer Datei in einem Commit, so wie Git ihn auschecken würde (`cat-file --filters`: Zeilenende, Filter),
   * mit der erkannten Kodierung dekodiert (Windows-1252, UTF-16 …).
   */
  async fileAtCommit(params: CommandParams<'git.fileAtCommit'>): Promise<CommandResult<'git.fileAtCommit'>> {
    const p = params as Partial<CommandParams<'git.fileAtCommit'>>;
    const file = this.project.files.lexicalPath(p?.path);
    const commit = p.commit ?? 'HEAD';
    if (typeof commit !== 'string' || commit.startsWith('-') || /[\s:]/.test(commit)) throw new CommandError('Not a valid commit.', ErrorCode.invalidParams);
    const encoding = validEncoding(p.encoding);
    await this.requireRepository();
    const bytes = await this.bytesAtCommit(file, commit);
    if (bytes === null) return { exists: false, text: '' };
    const text = decodeContent(bytes, encoding);
    return text === null ? { exists: true, text: '', binary: true } : { exists: true, text };
  }

  /** Die Bytes einer Datei in einem Commit, wie Git sie auschecken würde; `null`, wenn es sie dort nicht gibt. */
  private async bytesAtCommit(file: string, commit: string): Promise<Buffer | null> {
    // „./“: relativ zum Arbeitsordner (dem Projekt), nicht zur Wurzel des Repositorys.
    const result = await this.run(['cat-file', '--filters', `${commit}:./${this.relative(file)}`], { background: true });
    return result.code === 0 ? result.stdoutBytes : null;
  }

  /**
   * Stand im letzten Commit je Datei (als Bytes; dekodiert wird je Anfrage mit der Kodierung der Arbeitsdatei), bis
   * sich HEAD oder der Index ändern. `null`: nicht versioniert; leerer Puffer: neu im Index.
   */
  private readonly baseCache = new Map<string, Promise<Buffer | null>>();

  /** Änderungsblöcke eines aktuellen Texts gegenüber dem letzten Commit, ohne Git-Aufruf pro Anfrage. */
  async changes(params: CommandParams<'git.changes'>): Promise<ChangeBlock[]> {
    const p = params as Partial<CommandParams<'git.changes'>>;
    const file = this.project.files.lexicalPath(p?.path);
    if (typeof p.text !== 'string') throw new CommandError('A text is expected.', ErrorCode.invalidParams);
    const encoding = validEncoding(p.encoding);
    if (!this.options.git) return [];
    if (!this.root) await this.current();
    if (!this.root) return [];
    const k = file.toLowerCase();
    let base = this.baseCache.get(k);
    if (!base) {
      base = (async () => {
        const atHead = await this.bytesAtCommit(file, 'HEAD');
        if (atHead !== null) return atHead;
        // Nicht im letzten Commit: nicht versioniert (keine Blöcke) oder neu im Index (alles hinzugefügt).
        const tracked = await this.run(['ls-files', '--', this.relative(file)], { background: true });
        return tracked.code === 0 && tracked.stdout.trim() !== '' ? Buffer.alloc(0) : null;
      })();
      this.baseCache.set(k, base);
    }
    const bytes = await base;
    if (bytes === null) return [];
    const old = decodeContent(bytes, encoding);
    // Im letzten Commit binär: keine sinnvollen Blöcke.
    if (old === null) return [];
    return changeBlocks(old, p.text);
  }

  // ---------- Log mit Graph (Ticket 19) ----------

  /** Der laufende Log dieses Fensters: ein Git-Prozess, seitenweise gelesen. */
  private logSession: LogSession | null = null;
  private logVersion = 0;
  /** Die Log-Aufrufe nacheinander (eine Seite nach der anderen aus demselben Prozess). */
  private logChain: Promise<unknown> = Promise.resolve();
  /** Gestartete Log-Prozesse; für Tests. */
  logProcessesStarted = 0;
  /** Zähler der Log-Anfragen; eine lange Suche bricht ab, sobald eine neuere wartet. */
  private logRequests = 0;
  /** Stand der Refs beim letzten Lesen des Zustands; ändert er sich, meldet der Dienst „git.refsChanged“. */
  private refsSignature: string | null = null;

  /** Eine Seite des Logs; ein anderer Filter oder andere Refs beginnen einen neuen Log (neue \`version\`). */
  log(params: CommandParams<'git.log'>): Promise<GitLogPage> {
    const p = params as Partial<CommandParams<'git.log'>>;
    const filter = logFilter(p?.filter);
    const offset = p?.offset ?? 0;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) throw new CommandError('A page offset is expected.', ErrorCode.invalidParams);
    const request = ++this.logRequests;
    const work = async (): Promise<GitLogPage> => {
      await this.requireRepository();
      const key = JSON.stringify([filter, await this.refsSignatureNow()]);
      if (!this.logSession || this.logSession.key !== key) await this.startLog(filter, key);
      const session = this.logSession!;
      while (session.commits.length < offset + LOG_PAGE && !session.reader.done) {
        // Eine neuere Anfrage wartet (etwa ein geänderter Filter): Diese lange Suche nicht zu Ende führen (Review).
        if (request !== this.logRequests || this.disposed) break;
        let records: string[][];
        try {
          records = await session.reader.take(LOG_PAGE);
        } catch (err) {
          // Gescheitert: Die Sitzung gilt nicht mehr, die nächste Anfrage beginnt neu (statt eines leeren Logs).
          if (this.logSession === session) this.logSession = null;
          await session.reader.dispose();
          throw new CommandError((err as Error).message, ErrorCode.gitFailed);
        }
        if (records.length === 0) break;
        for (const fields of records) {
          const commit = parseLogRecord(fields, session.remotes);
          if (!commit) continue;
          if (session.graph) commit.graph = session.graph.next(commit.hash, commit.parents);
          else if (!matchesLog(commit, fields[7] ?? '', filter)) continue;
          session.commits.push(commit);
        }
      }
      return {
        version: session.version,
        commits: session.commits.slice(offset, offset + LOG_PAGE),
        done: session.reader.done && session.commits.length <= offset + LOG_PAGE,
        graph: session.graph !== null,
      };
    };
    const next = this.logChain.then(work, work);
    this.logChain = next.catch(() => {});
    return next;
  }

  private async startLog(filter: GitLogFilter, key: string): Promise<void> {
    await this.logSession?.reader.dispose();
    this.logSession = null;
    const withGraph = !filter.text && !filter.author;
    const state = await this.current();
    // Die Spur des aktuellen Branches beginnt in Spalte 0 (nur, wenn er im Log vorkommt). Abgekoppelt (etwa nach
    // „Checkout Revision“ weit unten) nicht: Sonst bliebe Spalte 0 über tausende Zeilen leer (Review).
    let head: string | undefined;
    if (withGraph && state.branch && (!filter.branch || filter.branch === state.branch)) {
      const r = await this.run(['rev-parse', '--verify', '--quiet', 'HEAD'], { background: true });
      if (r.code === 0) head = r.stdout.trim();
    }
    const remotesRun = await this.run(['remote'], { background: true });
    const remotes = remotesRun.code === 0 ? remotesRun.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    const format = ['%H', '%P', '%D', '%an', '%ae', '%at', '%s', ...(filter.text ? ['%B'] : [])].join('%x00') + '%x1e';
    const args = ['--no-optional-locks', 'log', '--topo-order', '--decorate=full', `--format=${format}`, ...(filter.branch ? [filter.branch, '--'] : ['--branches', '--remotes', '--tags', 'HEAD', '--'])];
    // Schliesst das Fenster während der Vorbereitung, startet kein Prozess mehr (er bliebe sonst stehen; Review).
    if (this.disposed) throw new CommandError('The project is closing.', ErrorCode.gitFailed);
    this.logProcessesStarted++;
    // In der Konsole wie jeder Aufruf (ohne Ausgabe: die ist der Log selbst); Exit-Code und Fehler, sobald er endet.
    const entry: GitConsoleEntry = { id: this.nextEntryId++, time: Date.now(), command: ['git', ...args].map(quote).join(' '), output: '', exitCode: null, background: true };
    this.addEntry(entry);
    const reader = new LogReader(this.options.git!, args, { cwd: this.project.path, env: { ...(this.options.env ?? process.env), GIT_LITERAL_PATHSPECS: '1' } });
    void reader.exited.then(({ code, stderr }) => {
      entry.exitCode = code;
      entry.output = stderr.trim();
      if (!this.disposed) this.project.emit('git.console', { ...entry });
    });
    this.logSession = { key, version: ++this.logVersion, reader, graph: withGraph ? new LogGraph(head) : null, commits: [], remotes };
  }

  /** Details eines Commits und seine geänderten Dateien (bei einem Merge gegen den ersten Elterncommit). */
  async commitDetails(params: CommandParams<'git.commitDetails'>): Promise<GitCommitDetails> {
    const hash = commitHash((params as Partial<CommandParams<'git.commitDetails'>>)?.hash);
    await this.requireRepository();
    const meta = await this.run(['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ct%x00%B', hash, '--'], { background: true });
    if (meta.code !== 0) throw this.failure(meta);
    const [full, parentList, author, email, at, committer, ct, ...rest] = meta.stdout.split('\0');
    const parents = parentList.split(' ').filter(Boolean);
    const diff = await this.run(
      parents.length > 0 ? ['diff-tree', '-r', '-z', '--name-status', '-M', parents[0], full, '--'] : ['diff-tree', '-r', '-z', '--root', '--no-commit-id', '--name-status', '-M', full, '--'],
      { background: true },
    );
    if (diff.code !== 0) throw this.failure(diff);
    const root = this.root!;
    const files: GitCommitDetails['files'] = [];
    const parts = diff.stdout.split('\0');
    for (let i = 0; i + 1 < parts.length; ) {
      const status = parts[i];
      if (!/^[A-Z]/.test(status)) {
        i++;
        continue;
      }
      if (/^[RC]/.test(status)) {
        files.push({ status: status[0], origRepoPath: parts[i + 1], repoPath: parts[i + 2], path: path.join(root, parts[i + 2]) });
        i += 3;
      } else {
        files.push({ status: status[0], repoPath: parts[i + 1], path: path.join(root, parts[i + 1]) });
        i += 2;
      }
    }
    return {
      hash: full,
      parents,
      author,
      email,
      date: Number(at) * 1000,
      committer,
      commitDate: Number(ct) * 1000,
      message: rest.join('\0').replace(/\s+$/, ''),
      files,
    };
  }

  /** Inhalt einer Datei (relativ zur Wurzel des Repositorys) in einem Commit, für Vergleiche aus der Historie. */
  async commitFile(params: CommandParams<'git.commitFile'>): Promise<CommandResult<'git.commitFile'>> {
    const p = params as Partial<CommandParams<'git.commitFile'>>;
    const hash = commitHash(p?.hash);
    const repoPath = p?.repoPath;
    if (typeof repoPath !== 'string' || repoPath === '' || repoPath.startsWith('/') || /\0/.test(repoPath) || repoPath.split('/').includes('..')) {
      throw new CommandError('A path in the repository is expected.', ErrorCode.invalidParams);
    }
    await this.requireRepository();
    const result = await this.run(['cat-file', '--filters', `${hash}:${repoPath}`], { background: true });
    if (result.code !== 0) return { exists: false, text: '' };
    const text = decodeContent(result.stdoutBytes, undefined);
    return text === null ? { exists: true, text: '', binary: true } : { exists: true, text };
  }

  /** „Checkout Revision“: abgekoppelter Zustand; \`switch --detach\` fasst keine Pfade an. */
  async checkoutRevision(params: CommandParams<'git.checkoutRevision'>): Promise<void> {
    const hash = commitHash((params as Partial<CommandParams<'git.checkoutRevision'>>)?.hash);
    await this.requireRepository();
    await this.write(['switch', '--detach', hash]);
  }

  /** „Copy Revision Number“: der volle Hash in die Zwischenablage (über den Port). */
  async copyRevision(params: CommandParams<'git.copyRevision'>): Promise<void> {
    const hash = commitHash((params as Partial<CommandParams<'git.copyRevision'>>)?.hash);
    await this.requireRepository();
    const full = await this.run(['rev-parse', '--verify', '--quiet', `${hash}^{commit}`], { background: true });
    if (full.code !== 0) throw new CommandError(`Unknown revision: ${hash}`, ErrorCode.gitFailed);
    await this.options.writeClipboard(full.stdout.trim());
  }

  /** Meldet geänderte Refs (auch nach einem Fetch, der den Zustand des Branches nicht ändert). */
  /**
   * Stand der Refs für den Log: Branches, Remotes, Tags und HEAD mit seinem Ziel. Das Ziel gehört dazu, sonst bliebe
   * der Log nach einem Wechsel auf einen Branch desselben Commits stehen; Stash und Notes nicht (Review).
   */
  private async refsSignatureNow(): Promise<string> {
    const refs = await this.run(['show-ref', '--head'], { background: true });
    const lines = refs.stdout.split(/\r?\n/).filter((l) => / (HEAD|refs\/(heads|remotes|tags)\/.*)$/.test(l));
    const head = this.gitDir ? await fs.promises.readFile(path.join(this.gitDir, 'HEAD'), 'utf8').catch(() => '') : '';
    return `${head.trim()}\n${lines.join('\n')}`;
  }

  private async checkRefs(): Promise<void> {
    const signature = await this.refsSignatureNow();
    if (this.refsSignature !== null && signature !== this.refsSignature && !this.disposed) this.project.emit('git.refsChanged', {});
    this.refsSignature = signature;
  }

  // ---------- Fetch, Pull, Push und Konflikte (Ticket 18) ----------

  /** Fetch von allen Remotes, verschwundene Remote-Branches fort. Kein automatischer Fetch. */
  async fetch(): Promise<void> {
    await this.requireRepository();
    await this.project.progress.run('Fetching…', () => this.serial(() => this.networkWrite(['fetch', '--all', '--prune', '--progress'])));
  }

  /** Pull nach der Konfiguration des Nutzers; Konflikte sind kein Fehler, sondern ein laufender Merge oder Rebase. */
  async pull(): Promise<{ conflicts: boolean }> {
    await this.requireRepository();
    return this.project.progress.run('Pulling…', () =>
      this.serial(async () => {
        // Ein schon laufender Merge oder Rebase ist kein neuer Konflikt dieses Pulls (Review von Ticket 18).
        const before = await this.readState();
        if (before.operation) {
          throw new CommandError(`A ${before.operation} is in progress. Finish or abort it first.`, ErrorCode.gitFailed);
        }
        const result = await this.run(['pull', '--progress']);
        const state = await this.refresh();
        if (result.code === 0) return { conflicts: false };
        if (state.operation && state.files.some((f) => f.conflict)) return { conflicts: true };
        throw this.failure(result);
      }),
    );
  }

  /** Push des aktuellen Branches nach den Regeln oben; nie erzwungen. */
  async push(): Promise<{ remote: string; branch: string; upstreamSet: boolean }> {
    await this.requireRepository();
    return this.project.progress.run('Pushing…', () =>
      this.serial(async () => {
        const state = await this.readState();
        const branch = state.branch;
        if (!branch) throw new CommandError('Check out a branch to push.', ErrorCode.gitFailed);
        const configured = async (key: string) => {
          const r = await this.run(['config', '--get', key], { background: true });
          return r.code === 0 ? r.stdout.trim() : '';
        };
        const upstreamRemote = await configured(`branch.${branch}.remote`);
        const upstreamMerge = await configured(`branch.${branch}.merge`);
        // Immer unter demselben Namen: Ein Branch, der „origin/main“ folgt (etwa „New Branch from 'origin/main'“),
        // landete sonst auf main (Review von Ticket 18).
        const target = `refs/heads/${branch}`;
        const matching = upstreamRemote !== '' && upstreamRemote !== '.' && upstreamMerge === target;
        // Ein eigenes Push-Ziel des Nutzers (Fork: holen von „upstream“, schieben nach „origin“) geht vor.
        const pushRemote = (await configured(`branch.${branch}.pushRemote`)) || (await configured('remote.pushDefault'));
        let remote: string;
        let upstreamSet = false;
        if (pushRemote) {
          remote = pushRemote;
          upstreamSet = upstreamRemote === '';
        } else if (matching) {
          remote = upstreamRemote;
        } else {
          const list = await this.run(['remote'], { background: true });
          const remotes = list.code === 0 ? list.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
          if (remotes.length === 0) throw new CommandError('No remote is configured for this repository.', ErrorCode.gitFailed);
          const chosen = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
          if (!chosen) throw new CommandError(`There are several remotes and none is called 'origin': ${remotes.join(', ')}.`, ErrorCode.gitFailed);
          remote = chosen;
          upstreamSet = true;
        }
        if (remote.startsWith('-')) throw new CommandError(`Not a valid remote: ${remote}`, ErrorCode.gitFailed);
        const args = ['push', '--progress', ...(upstreamSet ? ['--set-upstream'] : []), remote, `refs/heads/${branch}:${target}`];
        const result = await this.run(args);
        await this.refresh();
        if (result.code !== 0) {
          // Abgelehnt, weil der Remote Commits hat, die hier fehlen (in jeder Sprache an der Kennung in Klammern).
          if (/\[rejected\]|\[remote rejected\]/.test(result.stderr) && /\((fetch first|non-fast-forward)\)/.test(result.stderr)) {
            throw new CommandError(gitMessage(result.stderr) || 'The push was rejected because the remote has changes you do not have.', ErrorCode.gitPushRejected);
          }
          throw this.failure(result);
        }
        return { remote, branch: target.slice('refs/heads/'.length), upstreamSet };
      }),
    );
  }

  /** Bricht den laufenden Merge oder Rebase ab (auch Cherry-Pick und Revert). */
  async abort(): Promise<void> {
    await this.requireRepository();
    await this.serial(async () => {
      const operation = this.operation();
      if (!operation) throw new CommandError('Nothing to abort.', ErrorCode.gitFailed);
      const result = await this.run([operation, '--abort']);
      await this.refresh();
      if (result.code !== 0) throw this.failure(result);
    });
  }

  /** Rebase fortsetzen: `add -u` (alle versionierten Änderungen), dann `rebase --continue` ohne Editor. */
  async continueRebase(): Promise<{ conflicts: boolean }> {
    await this.requireRepository();
    return this.serial(async () => {
      if (this.operation() !== 'rebase') throw new CommandError('No rebase is in progress.', ErrorCode.gitFailed);
      const added = await this.run(['add', '-u']);
      if (added.code !== 0) {
        await this.refresh();
        throw this.failure(added);
      }
      const result = await this.run(['rebase', '--continue']);
      const state = await this.refresh();
      if (result.code === 0) return { conflicts: false };
      if (state.operation === 'rebase' && state.files.some((f) => f.conflict)) return { conflicts: true };
      throw this.failure(result);
    });
  }

  /** Die vorbereitete Merge-Nachricht aus MERGE_MSG, ohne Kommentarzeilen. */
  async mergeMessage(): Promise<string | null> {
    await this.requireRepository();
    if (!this.gitDir || this.operation() !== 'merge') return null;
    try {
      const text = await fs.promises.readFile(path.join(this.gitDir, 'MERGE_MSG'), 'utf8');
      return text
        .split(/\r?\n/)
        .filter((l) => !l.startsWith('#'))
        .join('\n')
        .trim();
    } catch {
      return null;
    }
  }

  /** Konfliktdateien mit verbliebenen Markierungen (`<<<<<<<`, `=======`, `>>>>>>>` am Zeilenanfang). */
  async conflictMarkers(): Promise<string[]> {
    await this.requireRepository();
    const state = await this.readState();
    const found: string[] = [];
    for (const f of state.files) {
      if (!f.conflict) continue;
      const data = await fs.promises.readFile(f.path).catch(() => Buffer.alloc(0));
      if (data.subarray(0, 8000).includes(0)) continue;
      // Nur „<<<<<<<“ und „>>>>>>>“: Eine Zeile „=======“ ist auch eine Überschrift in Markdown (Review).
      const text = data.toString('utf8');
      if (/^<{7}(\s|$)/m.test(text) && /^>{7}(\s|$)/m.test(text)) found.push(f.path);
    }
    return found;
  }

  /** Ein Aufruf mit Netz, der Refs schreibt; Fehler im Wortlaut von Git, danach neuer Zustand. */
  private async networkWrite(args: string[]): Promise<void> {
    const result = await this.run(args);
    await this.refresh();
    if (result.code !== 0) throw this.failure(result);
  }

  // ---------- Commit, Rollback, .gitignore (Ticket 16) ----------

  async commit(params: CommandParams<'git.commit'>): Promise<void> {
    const p = params as Partial<CommandParams<'git.commit'>>;
    if (typeof p?.message !== 'string' || !Array.isArray(p.paths) || p.paths.some((x) => typeof x !== 'string')) {
      throw new CommandError('Paths and a message are expected.', ErrorCode.invalidParams);
    }
    const message = p.message.trim();
    if (message === '') throw new CommandError('Enter a commit message.', ErrorCode.invalidParams);
    await this.requireRepository();
    const paths = p.paths.map((x) => this.project.files.lexicalPath(x));
    if (paths.length === 0 && p.amend !== true && !this.state.operation) throw new CommandError('Select the files to commit.', ErrorCode.invalidParams);
    await this.serial(async () => {
      const status = await this.readState();
      if (status.operation === 'rebase') throw new CommandError('A rebase is in progress: use Continue.', ErrorCode.gitFailed);
      if (status.operation === 'merge') {
        // Merge abschliessen: alle Änderungen an versionierten Dateien (auch die aufgelösten Konflikte) in den Index,
        // dann ein Commit ohne Pfade (`--only` geht während eines Merges nicht).
        const added = await this.run(['add', '-u']);
        const result = added.code === 0 ? await this.run(['commit', '-m', message]) : added;
        await this.refresh();
        if (result.code !== 0) throw this.failure(result);
        return;
      }
      const byKey = filesByKey(status.files);
      // Nicht versionierte zuerst in den Index; zu Umbenennungen gehört der alte Pfad dazu.
      const untracked = paths.filter((x) => byKey.get(x.toLowerCase())?.index === '?');
      const all = new Set(paths);
      for (const x of paths) {
        const orig = byKey.get(x.toLowerCase())?.origPath;
        if (orig) all.add(orig);
      }
      if (untracked.length > 0) {
        const added = await this.run(['add'], { pathspecs: untracked.map((x) => this.relative(x)) });
        if (added.code !== 0) throw this.failure(added);
      }
      // `--only`: nur diese Pfade, vorbereitete Einträge anderer Dateien bleiben im Index.
      const result = await this.run(['commit', '--only', '-m', message, ...(p.amend === true ? ['--amend'] : [])], {
        ...(all.size > 0 ? { pathspecs: [...all].map((x) => this.relative(x)) } : {}),
      });
      if (result.code !== 0 && untracked.length > 0) {
        // Abgelehnt (etwa von einem Hook): die eben aufgenommenen Dateien wieder unversioniert, wie in IntelliJ.
        await this.run(['rm', '--cached', '--quiet', '-r'], { pathspecs: untracked.map((x) => this.relative(x)) });
      }
      await this.refresh();
      if (result.code !== 0) throw this.failure(result);
    });
  }

  async lastMessage(): Promise<string | null> {
    await this.requireRepository();
    const result = await this.run(['log', '-1', '--format=%B'], { background: true });
    return result.code === 0 ? result.stdout.replace(/\s+$/, '') : null;
  }

  async rollback(params: CommandParams<'git.rollback'>): Promise<void> {
    const p = params as Partial<CommandParams<'git.rollback'>>;
    if (!Array.isArray(p?.paths) || p.paths.length === 0) throw new CommandError('Paths are expected.', ErrorCode.invalidParams);
    await this.requireRepository();
    const paths = p.paths.map((x) => this.project.files.lexicalPath(x));
    await this.serial(async () => {
      const status = await this.readState();
      const byKey = filesByKey(status.files);
      const restore = new Set<string>();
      const removeAdded: string[] = [];
      for (const x of paths) {
        const file = byKey.get(x.toLowerCase());
        if (!file || file.index === '?' || file.index === '!') continue;
        if (file.origPath) {
          // Umbenennung rückgängig: der alte Pfad aus dem letzten Commit, der neue fort.
          restore.add(file.origPath);
          removeAdded.push(file.path);
        } else if (file.index === 'A') {
          removeAdded.push(file.path);
        } else {
          restore.add(file.path);
        }
      }
      if (removeAdded.length > 0) {
        const removed = await this.run(['rm', '--cached', '--quiet', '-r'], { pathspecs: removeAdded.map((x) => this.relative(x)) });
        if (removed.code !== 0) throw this.failure(removed);
        for (const file of removeAdded) {
          if (fs.existsSync(file)) await this.options.trash(file);
        }
      }
      if (restore.size > 0) {
        const restored = await this.run(['restore', '--source=HEAD', '--staged', '--worktree'], { pathspecs: [...restore].map((x) => this.relative(x)) });
        if (restored.code !== 0) throw this.failure(restored);
      }
      await this.refresh();
    });
  }

  async addToGitignore(params: CommandParams<'git.addToGitignore'>): Promise<void> {
    await this.requireRepository();
    const target = this.project.files.lexicalPath((params as { path?: unknown } | undefined)?.path);
    const root = this.root!;
    const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
    // Zeichen, die in .gitignore ein Muster bilden, wörtlich nehmen (Review von Ticket 16: „[ab].txt“ ignorierte sonst
    // „b.txt“); „#“ und „!“ am Anfang entschärft der führende „/“.
    const relative = path.relative(root, target).split(path.sep).join('/').replace(/[[\]*?\\]/g, (c) => `\\${c}`).replace(/ $/, '\\ ');
    const entry = `/${relative}${isDir ? '/' : ''}`;
    const file = path.join(root, '.gitignore');
    await this.serial(async () => {
      const current = fs.existsSync(file) ? await fs.promises.readFile(file, 'utf8') : '';
      if (current.split(/\r?\n/).includes(entry)) return;
      const newline = current.includes('\r\n') ? '\r\n' : '\n';
      const prefix = current === '' || current.endsWith('\n') ? '' : newline;
      await fs.promises.writeFile(file, `${current}${prefix}${entry}${newline}`, 'utf8');
    });
    await this.refresh();
  }

  /** Merkt eine Umbenennung einer versionierten Datei im Index vor (Ticket 16). */
  private recordRename(from: string, to: string): Promise<void> {
    if (!this.root || this.disposed) return Promise.resolve();
    // In der Schreibreihe (Review von Ticket 16): Mehrere schnelle Umbenennungen und ein Commit danach sehen jeweils
    // den Stand der vorigen.
    return this.serial(async () => {
      // Schnell hintereinander umbenannt (a → b → c): Lief das Vormerken für a → b erst, als b schon c hiess, gilt die
      // Kette a → c (Review von Ticket 16).
      const origin = this.pendingRenames.get(from.toLowerCase()) ?? from;
      this.pendingRenames.delete(from.toLowerCase());
      // Nur die versionierten Dateien übertragen; nicht versionierte in einem umbenannten Ordner bleiben es.
      // ls-files kennt --pathspec-from-file nicht; ein Pfad passt auf die Befehlszeile.
      const listed = await this.run(['ls-files', '-z', '--', this.relative(origin)], { background: true });
      if (listed.code !== 0) return;
      const tracked = listed.stdout.split('\0').filter(Boolean);
      if (tracked.length === 0) return;
      if (!fs.existsSync(to)) {
        this.pendingRenames.set(to.toLowerCase(), origin);
        return;
      }
      const originRel = this.relative(origin);
      const toRel = this.relative(to);
      const moved = tracked.map((t) => toRel + t.slice(originRel.length));
      // Erst die neuen aufnehmen; geht das nicht (etwa ein ignorierter Name), bleibt der Index, wie er war.
      const added = await this.run(['add'], { pathspecs: moved });
      if (added.code !== 0) return;
      await this.run(['rm', '--cached', '--quiet', '-r'], { pathspecs: tracked });
    }).then(() => this.scheduleRefresh());
  }

  /** Pfad relativ zum Projektordner (dem Arbeitsordner von Git), mit „/“. */
  private relative(file: string): string {
    return path.relative(this.project.path, file).split(path.sep).join('/') || '.';
  }

  // ---------- Aufrufe ----------

  /** Eine schreibende Aktion: nacheinander, mit Fehler im Wortlaut von Git, danach neuer Zustand. */
  private async write(args: string[]): Promise<GitRun> {
    const result = await this.run(args, { write: true });
    await this.refresh();
    if (result.code !== 0) throw this.failure(result);
    return result;
  }

  /** Mehrere Schritte als eine schreibende Aktion in der Reihe. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(work, work);
    this.writeChain = next.catch(() => {});
    return next;
  }

  /** Ruft Git im Projektordner auf und schreibt den Aufruf in die Konsole. Für Tests öffentlich. */
  run(args: string[], options: RunOptions = {}): Promise<GitRun> {
    const git = this.options.git;
    if (!git) return Promise.reject(new CommandError('Git not found. Install Git to use Git functions.', ErrorCode.gitNotFound));
    const task = async (): Promise<GitRun> => {
      const entry: GitConsoleEntry = {
        id: this.nextEntryId++,
        time: Date.now(),
        command: ['git', ...args, ...(options.pathspecs ? [`-- ${options.pathspecs.length === 1 ? options.pathspecs[0] : `(${options.pathspecs.length} paths)`}`] : [])]
          .map(quote)
          .join(' '),
        output: '',
        exitCode: null,
        background: options.background === true,
      };
      this.addEntry(entry);
      let result: GitRun;
      if (this.disposed) return { code: null, stdout: '', stdoutBytes: Buffer.alloc(0), stderr: 'The project is closing.' };
      // Pfade immer wörtlich: Ein Name wie „[id].tsx“ ist sonst ein Muster und träfe andere Dateien (Review von
      // Ticket 16). Viele Pfade kommen über stdin statt über die Befehlszeile (Grenze von Windows).
      const env = { ...(this.options.env ?? process.env), GIT_LITERAL_PATHSPECS: '1' };
      const call = runGit(git, options.pathspecs ? [...args, '--pathspec-from-file=-', '--pathspec-file-nul'] : args, {
        cwd: this.project.path,
        env,
        ...(options.pathspecs ? { input: options.pathspecs.join('\0') } : {}),
      });
      this.running.add(call);
      void call.finally(() => this.running.delete(call)).catch(() => {});
      try {
        result = await call;
      } catch (err) {
        result = { code: null, stdout: '', stdoutBytes: Buffer.alloc(0), stderr: (err as Error).message };
      }
      // Gekürzt und lesbar: `-z`-Ausgaben trennen mit NUL; sehr grosse Ausgaben (status in grossen Repositorys)
      // füllten sonst den Speicher (Review von Ticket 15).
      const output = `${result.stdout}${result.stderr}`.replace(/\0/g, '\n').trimEnd();
      entry.output = output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n… (${output.length - OUTPUT_LIMIT} more characters)` : output;
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
    // Ein verweigerter Wechsel: Git listet die Dateien mit einem Tab eingerückt (in jeder Sprache gleich).
    const files = result.stderr
      .split(/\r?\n/)
      .filter((l) => l.startsWith('\t'))
      .map((l) => path.join(this.root ?? this.project.path, l.trim()));
    if (files.length > 0 && /^error:/m.test(result.stderr)) return new CommandError(message, ErrorCode.gitCheckoutBlocked, { files });
    return new CommandError(message, ErrorCode.gitFailed);
  }

  private async requireRepository(): Promise<void> {
    if (!this.options.git) throw new CommandError('Git not found. Install Git to use Git functions.', ErrorCode.gitNotFound);
    if (!this.root) await this.refresh();
    if (!this.root) throw new CommandError('Not a Git repository.', ErrorCode.notARepository);
  }

  private async dispose(): Promise<void> {
    this.disposed = true;
    // Der Log-Prozess endet mit dem Fenster.
    await this.logSession?.reader.dispose();
    this.logSession = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    await Promise.allSettled([...this.running]);
  }
}

/** Die Dateizustände nach Pfad; gibt es für einen Pfad zwei (etwa „D“ und „?“), gilt der versionierte. */
function filesByKey(files: GitFileStatus[]): Map<string, GitFileStatus> {
  const map = new Map<string, GitFileStatus>();
  for (const f of files) {
    const k = f.path.toLowerCase();
    const known = map.get(k);
    if (!known || known.index === '?') map.set(k, f);
  }
  return map;
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
    } else if (line.startsWith('! ')) {
      // Ignoriert, getrennt von den Änderungen (Review von Ticket 16); ein Ordner endet mit „/“.
      const name = line.slice(2);
      (state.ignored ??= []).push({ path: path.join(root, name.replace(/\/$/, '')), ...(name.endsWith('/') ? { directory: true as const } : {}) });
    }
  }
  if (state.branch === null && oid && oid !== '(initial)') state.detached = oid.slice(0, 8);
  return state;
}

const ENCODINGS: readonly TextEncoding[] = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252'];

function validEncoding(value: unknown): TextEncoding | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ENCODINGS.includes(value as TextEncoding)) throw new CommandError('Not a known encoding.', ErrorCode.invalidParams);
  return value as TextEncoding;
}

/** Inhalt aus einem Commit als Text, mit der Kodierung der Arbeitsdatei, sonst erkannt; `null` für Binärinhalt. */
function decodeContent(bytes: Buffer, encoding: TextEncoding | undefined): string | null {
  if (bytes.length === 0) return '';
  return encoding ? decodeAs(bytes, encoding) : (decodeText(bytes)?.text ?? null);
}

/** Der Filter des Logs, geprüft; leere Felder entfallen. */
function logFilter(value: unknown): GitLogFilter {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) throw new CommandError('A log filter is expected.', ErrorCode.invalidParams);
  const v = value as Record<string, unknown>;
  const text = (key: string) => {
    if (v[key] === undefined) return undefined;
    if (typeof v[key] !== 'string') throw new CommandError(`The filter field ${key} must be a text.`, ErrorCode.invalidParams);
    return (v[key] as string).trim() || undefined;
  };
  const result: GitLogFilter = {};
  const t = text('text');
  const author = text('author');
  const branch = text('branch');
  if (t) result.text = t;
  if (author) result.author = author;
  if (branch) result.branch = branchName(branch);
  return result;
}

/** Ein Commit-Hash (auch gekürzt); nichts, was Git als Option oder Ausdruck lesen könnte. */
function commitHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{4,64}$/i.test(value)) throw new CommandError('A commit hash is expected.', ErrorCode.invalidParams);
  return value;
}

/** Ein Datensatz des Logs: Hash, Eltern, Refs, Autor, E-Mail, Datum, Betreff (und mit Textfilter die Nachricht). */
function parseLogRecord(fields: string[], remotes: readonly string[]): GitLogCommit | null {
  const [hash, parents, decoration, author, email, at, subject] = fields;
  if (!hash || !/^[0-9a-f]{40,64}$/.test(hash)) return null;
  return { hash, parents: (parents ?? '').split(' ').filter(Boolean), refs: parseRefs(decoration ?? '', remotes), author: author ?? '', email: email ?? '', date: Number(at) * 1000, subject: subject ?? '' };
}

/** Etiketten aus \`%D\` mit \`--decorate=full\`: „HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main“. */
function parseRefs(decoration: string, remotes: readonly string[]): GitRefLabel[] {
  const labels: GitRefLabel[] = [];
  for (const raw of decoration.split(', ').map((d) => d.trim()).filter(Boolean)) {
    if (raw === 'HEAD') labels.push({ name: 'HEAD', kind: 'head' });
    else if (raw.startsWith('HEAD -> refs/heads/')) labels.push({ name: raw.slice('HEAD -> refs/heads/'.length), kind: 'head' });
    else if (raw.startsWith('tag: refs/tags/')) labels.push({ name: raw.slice('tag: refs/tags/'.length), kind: 'tag' });
    else if (raw.startsWith('refs/heads/')) labels.push({ name: raw.slice('refs/heads/'.length), kind: 'local' });
    else if (raw.startsWith('refs/remotes/')) {
      const name = raw.slice('refs/remotes/'.length);
      // „origin/HEAD“ zeigt nur, wohin der Remote zeigt; IntelliJ blendet es aus.
      if (remotes.some((r) => name === `${r}/HEAD`)) continue;
      labels.push({ name, kind: 'remote' });
    }
  }
  return labels;
}

/** Text- und Autorfilter: Teil der Nachricht oder Anfang des Hashs; Teil von Name oder E-Mail. */
function matchesLog(commit: GitLogCommit, message: string, filter: GitLogFilter): boolean {
  if (filter.author) {
    const a = filter.author.toLowerCase();
    if (!commit.author.toLowerCase().includes(a) && !commit.email.toLowerCase().includes(a)) return false;
  }
  if (filter.text) {
    const t = filter.text.toLowerCase();
    const hashMatch = /^[0-9a-f]+$/.test(t) && commit.hash.startsWith(t);
    if (!hashMatch && !(message || commit.subject).toLowerCase().includes(t)) return false;
  }
  return true;
}

/**
 * Die Nachrichten vom Ende eines Reflogs, die neueste zuerst: höchstens die letzten `maxBytes` der Datei, ab der ersten
 * vollständigen Zeile darin (geschnitten wird am Zeilenende, nie mitten in einem Zeichen).
 */
export async function readReflogTail(file: string, maxBytes = REFLOG_TAIL_BYTES): Promise<string[]> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const from = start === 0 ? 0 : buffer.indexOf(0x0a) + 1;
    if (from === 0 && start > 0) return [];
    return reflogMessages(buffer.subarray(from, bytesRead).toString('utf8'));
  } finally {
    await handle.close();
  }
}
