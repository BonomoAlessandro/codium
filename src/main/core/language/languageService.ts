// Sprach-Dienst im Projekt-Kern (Ticket 12): startet Sprachserver, meldet ihnen Dokumente und Dateiänderungen und
// bietet typisierte Methoden (Definition, Verwendungen, Implementierungen, Hover, Inhalt schreibgeschützter Ziele).
// Java folgt mit Ticket 14, Vervollständigung und Symbolsuche mit Ticket 13. Lädt nie Electron.
//
// - Höchstens ein Server je Sprache. Er startet beim Öffnen des Projekts, wenn Kennzeichen da sind (tsconfig.json,
//   jsconfig.json, package.json), sonst mit dem ersten passenden Dokument.
// - Stürzt er ab, startet er neu, höchstens dreimal in drei Minuten; danach erscheint ein Fehlerhinweis.
// - Beim Abbau beendet der Dienst alle Server samt Kindprozessen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ErrorCode, type CodeLocation, type CommandParams, type LanguageDiagnostic, type TextRange } from '../../../shared/types';
import { killProcessTree } from '../processTree';
import type { Progress } from '../progress';
import type { ProjectCore } from '../projectCore';
import { CommandError } from '../router';
import { LspConnection } from './lspConnection';
import { TYPESCRIPT_MARKERS, typescriptLanguageId, typescriptLaunch, type BundledTypeScript, type TypeScriptLaunch } from './typescriptServer';

/** Neustarts nach Abstürzen höchstens so oft im Zeitfenster. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 3 * 60_000;
/** So lange nach der letzten Eingabe holt der Dienst die Fehler eines Dokuments neu. */
const DIAGNOSTIC_DELAY_MS = 250;

export interface LanguageServiceOptions {
  /** Mitgelieferte TypeScript-Server; ohne Angabe startet der Dienst keine Server (schnelle Tests ohne Sprachserver). */
  typescript?: BundledTypeScript;
  /** Grundumgebung der Server; ohne Angabe die des Prozesses. */
  env?: NodeJS.ProcessEnv;
  /** Uhr für die Neustart-Regel (Tests). */
  now?: () => number;
  log: (message: string) => void;
}

interface OpenDocument {
  path: string;
  languageId: string;
  text: string;
  version: number;
}

/** Ein laufender Server einer Sprache. */
class Server {
  connection: LspConnection | null = null;
  ready: Promise<boolean> | null = null;
  launch: TypeScriptLaunch | null = null;
  pullDiagnostics = false;
  stopping = false;
  gaveUp = false;
  crashes: number[] = [];
  readonly progress = new Map<string, Progress>();
}

export class LanguageService {
  private readonly typescript = new Server();
  private readonly documents = new Map<string, OpenDocument>();
  /** Dokumente, die der Dienst selbst geöffnet hat (Anfragen auf Dateien, die in der Oberfläche nicht offen sind). */
  private readonly implicit = new Set<string>();
  private readonly diagnosticTimers = new Map<string, NodeJS.Timeout>();
  /** Ziele ausserhalb des Projekts, die ein Server geliefert hat; nur sie liefert `readTarget`. */
  private readonly outsideTargets = new Set<string>();
  private readonly now: () => number;
  private disposed = false;

  constructor(
    private readonly project: ProjectCore,
    private readonly options: LanguageServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
    project.onDispose(() => this.dispose());
    project.subscribe('files.changed', (event) => {
      this.notifyWatched(event.changes.map((c) => ({ path: c.path, type: c.kind === 'created' ? 1 : c.kind === 'changed' ? 2 : 3 })));
    });
    project.subscribe('files.operation', (op) => {
      if (op.kind === 'created') this.notifyWatched([{ path: op.path, type: 1 }]);
      else if (op.kind === 'deleted') this.notifyWatched([{ path: op.path, type: 3 }]);
      else if (op.kind === 'renamed') this.notifyWatched([{ path: op.from, type: 3 }, { path: op.to, type: 1 }]);
      else if (op.kind === 'copied') this.notifyWatched([{ path: op.to, type: 1 }]);
    });
    // Mit Kennzeichen startet der Server gleich.
    if (TYPESCRIPT_MARKERS.some((m) => fs.existsSync(path.join(project.path, m)))) void this.ensure(this.typescript);
  }

  /** Prozessnummer des TypeScript-Servers (Tests); `undefined`, wenn keiner läuft. */
  get typescriptPid(): number | undefined {
    return this.typescript.connection?.running ? this.typescript.connection.pid : undefined;
  }

  /** Welcher TypeScript-Server läuft (Tests). */
  get typescriptKind(): TypeScriptLaunch['kind'] | null {
    return this.typescript.connection?.running ? (this.typescript.launch?.kind ?? null) : null;
  }

  // ---------- Dokumente ----------

  async didOpen(params: CommandParams<'language.didOpen'>): Promise<void> {
    const p = params as Partial<CommandParams<'language.didOpen'>>;
    const file = this.project.files.lexicalPath(p?.path);
    if (typeof p.text !== 'string' || typeof p.version !== 'number') throw new CommandError('Text and version are expected.', ErrorCode.invalidParams);
    const languageId = typescriptLanguageId(file);
    if (!languageId) return;
    const doc = { path: file, languageId, text: p.text, version: p.version };
    // Hatte der Dienst die Datei schon selbst geöffnet (für eine Anfrage), gilt jetzt der Text der Oberfläche.
    const wasImplicit = this.implicit.delete(key(file));
    this.documents.set(key(file), doc);
    if (wasImplicit && this.typescript.connection?.running) {
      this.typescript.connection.notify('textDocument/didChange', { textDocument: { uri: uriOf(file), version: doc.version }, contentChanges: [{ text: doc.text }] });
      this.scheduleDiagnostics(file);
      return;
    }
    if (await this.ensure(this.typescript)) {
      this.typescript.connection?.notify('textDocument/didOpen', { textDocument: { uri: uriOf(file), languageId, version: doc.version, text: doc.text } });
      this.scheduleDiagnostics(file);
    }
  }

  didChange(params: CommandParams<'language.didChange'>): void {
    const p = params as Partial<CommandParams<'language.didChange'>>;
    const file = this.project.files.lexicalPath(p?.path);
    const doc = this.documents.get(key(file));
    if (!doc || typeof p.text !== 'string' || typeof p.version !== 'number') return;
    doc.text = p.text;
    doc.version = p.version;
    this.typescript.connection?.notify('textDocument/didChange', {
      textDocument: { uri: uriOf(file), version: doc.version },
      contentChanges: [{ text: doc.text }],
    });
    this.scheduleDiagnostics(file);
  }

  didClose(params: CommandParams<'language.didClose'>): void {
    const file = this.project.files.lexicalPath((params as Partial<CommandParams<'language.didClose'>>)?.path);
    if (!this.documents.delete(key(file))) return;
    clearTimeout(this.diagnosticTimers.get(key(file)));
    this.diagnosticTimers.delete(key(file));
    this.typescript.connection?.notify('textDocument/didClose', { textDocument: { uri: uriOf(file) } });
  }

  // ---------- Typisierte Methoden ----------

  definition(params: CommandParams<'language.definition'>): Promise<CodeLocation[]> {
    return this.locations('textDocument/definition', params);
  }

  implementations(params: CommandParams<'language.implementations'>): Promise<CodeLocation[]> {
    return this.locations('textDocument/implementation', params);
  }

  async references(params: CommandParams<'language.references'>): Promise<CodeLocation[]> {
    const locations = await this.locations('textDocument/references', params, { context: { includeDeclaration: true } });
    // Für das Werkzeugfenster „Find“: die Zeile jedes Ziels, aus dem offenen Dokument oder von der Festplatte.
    const lines = new Map<string, string[]>();
    for (const location of locations) {
      const k = key(location.path);
      if (!lines.has(k)) {
        const open = this.documents.get(k)?.text;
        const text = open ?? (await fs.promises.readFile(location.path, 'utf8').catch(() => ''));
        lines.set(k, text.split(/\r?\n/));
      }
      location.lineText = lines.get(k)?.[location.range.start.line] ?? '';
    }
    return locations;
  }

  async hover(params: CommandParams<'language.hover'>): Promise<{ markdown: string; range?: TextRange } | null> {
    const at = this.position(params);
    const connection = await this.connectionFor(at.file);
    if (!connection) return null;
    const result = await connection
      .request<{ contents?: unknown; range?: TextRange } | null>('textDocument/hover', { textDocument: { uri: uriOf(at.file) }, position: at.position })
      .catch(() => null);
    if (!result?.contents) return null;
    const markdown = hoverMarkdown(result.contents);
    return markdown.trim() === '' ? null : { markdown, ...(result.range ? { range: result.range } : {}) };
  }

  /** Inhalt eines schreibgeschützten Ziels: unter node_modules im Projekt oder ein vom Server geliefertes Ziel. */
  async readTarget(params: CommandParams<'language.readTarget'>): Promise<{ text: string }> {
    const value = (params as Partial<CommandParams<'language.readTarget'>>)?.path;
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new CommandError('An absolute path is expected.', ErrorCode.invalidParams);
    const file = path.normalize(value);
    let allowed = this.outsideTargets.has(key(file));
    if (!allowed && file.toLowerCase().includes(`${path.sep}node_modules${path.sep}`)) {
      // Unter node_modules im Projekt, auch nach dem Auflösen von Junctions und Links.
      const [real, root] = await Promise.all([fs.promises.realpath(file).catch(() => null), fs.promises.realpath(this.project.path).catch(() => null)]);
      allowed = this.isInsideProject(file) && real !== null && root !== null && key(real).startsWith(key(root) + path.sep);
    }
    if (!allowed) throw new CommandError(`Not a target of the language server: ${file}`, ErrorCode.pathOutsideProject, { path: file });
    try {
      return { text: await fs.promises.readFile(file, 'utf8') };
    } catch {
      throw new CommandError(`The file could not be read: ${file}`, ErrorCode.fileNotFound, { path: file });
    }
  }

  private position(params: unknown): { file: string; position: { line: number; character: number } } {
    const p = params as Partial<{ path: unknown; line: unknown; character: unknown }> | undefined;
    const file = this.project.files.lexicalPath(p?.path);
    if (!isCount(p?.line) || !isCount(p?.character)) throw new CommandError('A position is expected.', ErrorCode.invalidParams);
    return { file, position: { line: p.line, character: p.character } };
  }

  private async locations(method: string, params: unknown, extra: Record<string, unknown> = {}): Promise<CodeLocation[]> {
    const at = this.position(params);
    const connection = await this.connectionFor(at.file);
    if (!connection) return [];
    const result = await connection.request<unknown>(method, { textDocument: { uri: uriOf(at.file) }, position: at.position, ...extra }).catch(() => null);
    const list = Array.isArray(result) ? result : result ? [result] : [];
    const out: CodeLocation[] = [];
    for (const item of list as Array<{ uri?: string; range?: TextRange; targetUri?: string; targetSelectionRange?: TextRange; targetRange?: TextRange }>) {
      const uri = item.targetUri ?? item.uri;
      const range = item.targetSelectionRange ?? item.range ?? item.targetRange;
      if (!uri || !range || !uri.startsWith('file:')) continue;
      const file = pathOf(uri);
      const readOnly = this.isLibrary(file);
      if (readOnly && !this.isInsideProject(file)) this.outsideTargets.add(key(file));
      out.push({ path: file, range, ...(readOnly ? { readOnly: true as const } : {}) });
    }
    return out;
  }

  private isInsideProject(file: string): boolean {
    const root = key(this.project.path);
    return key(file).startsWith(root + path.sep) || key(file) === root;
  }

  private isLibrary(file: string): boolean {
    return !this.isInsideProject(file) || key(file).includes(`${path.sep}node_modules${path.sep}`);
  }

  /** Der Server für eine Datei, gestartet und bereit; `null`, wenn es keinen gibt. */
  private async connectionFor(file: string): Promise<LspConnection | null> {
    const languageId = typescriptLanguageId(file);
    if (!languageId || !(await this.ensure(this.typescript))) return null;
    const connection = this.typescript.connection;
    // tsserver (TypeScript bis 6) beantwortet Anfragen nur für offene Dokumente: sonst mit dem Text von der Festplatte.
    if (connection && !this.documents.has(key(file))) {
      const text = await fs.promises.readFile(file, 'utf8').catch(() => null);
      if (text !== null && !this.documents.has(key(file))) {
        this.documents.set(key(file), { path: file, languageId, text, version: 0 });
        this.implicit.add(key(file));
        connection.notify('textDocument/didOpen', { textDocument: { uri: uriOf(file), languageId, version: 0, text } });
      }
    }
    return connection;
  }

  // ---------- Fehler und Warnungen ----------

  private scheduleDiagnostics(file: string): void {
    if (!this.typescript.pullDiagnostics) return;
    const k = key(file);
    clearTimeout(this.diagnosticTimers.get(k));
    this.diagnosticTimers.set(
      k,
      setTimeout(() => {
        this.diagnosticTimers.delete(k);
        void this.pullDiagnostics(file);
      }, DIAGNOSTIC_DELAY_MS),
    );
  }

  private async pullDiagnostics(file: string): Promise<void> {
    const connection = this.typescript.connection;
    const doc = this.documents.get(key(file));
    if (!connection || !doc) return;
    const version = doc.version;
    const report = await connection
      .request<{ kind?: string; items?: unknown[] } | null>('textDocument/diagnostic', { textDocument: { uri: uriOf(file) } })
      .catch(() => null);
    // Eine ältere Antwort für einen inzwischen geänderten oder geschlossenen Text zählt nicht.
    if (!report || report.kind !== 'full' || this.documents.get(key(file))?.version !== version) return;
    this.emitDiagnostics(file, report.items ?? []);
  }

  private emitDiagnostics(file: string, items: unknown[]): void {
    if (this.disposed) return;
    const diagnostics: LanguageDiagnostic[] = [];
    for (const raw of items as Array<{ range?: TextRange; severity?: number; message?: string; source?: string; code?: unknown; tags?: number[] }>) {
      if (!raw.range || typeof raw.message !== 'string') continue;
      const tags = (raw.tags ?? []).map((t) => (t === 1 ? 'unnecessary' : t === 2 ? 'deprecated' : null)).filter((t): t is 'unnecessary' | 'deprecated' => t !== null);
      diagnostics.push({
        range: raw.range,
        severity: raw.severity === 2 ? 'warning' : raw.severity === 3 ? 'info' : raw.severity === 4 ? 'hint' : 'error',
        message: raw.message,
        ...(raw.source ? { source: raw.source } : {}),
        ...(raw.code !== undefined ? { code: String(raw.code) } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      });
    }
    this.project.emit('language.diagnostics', { path: file, diagnostics });
  }

  // ---------- Dateiänderungen ----------

  private notifyWatched(changes: Array<{ path: string; type: number }>): void {
    const connection = this.typescript.connection;
    if (!connection?.running || changes.length === 0) return;
    connection.notify('workspace/didChangeWatchedFiles', { changes: changes.map((c) => ({ uri: uriOf(c.path), type: c.type })) });
    // Andere Dateien können die Fehler der offenen ändern.
    for (const doc of this.documents.values()) this.scheduleDiagnostics(doc.path);
  }

  // ---------- Lebenszyklus ----------

  /** Startet den Server, falls nötig, und wartet, bis er bereit ist. `false`, wenn es keinen gibt. */
  private ensure(server: Server): Promise<boolean> {
    if (this.disposed || server.gaveUp || !this.options.typescript) return Promise.resolve(false);
    if (server.connection?.running && server.ready) return server.ready;
    server.ready = this.start(server);
    return server.ready;
  }

  private async start(server: Server): Promise<boolean> {
    const launch = typescriptLaunch(this.project.path, this.options.typescript!);
    server.launch = launch;
    server.stopping = false;
    const work = this.project.progress.begin('Starting TypeScript language server…');
    const connection = new LspConnection({
      command: launch.command,
      args: launch.args,
      cwd: this.project.path,
      env: { ...(this.options.env ?? process.env), ...launch.env },
      log: this.options.log,
      onRequest: (method, params) => this.answer(method, params),
      onNotification: (method, params) => this.onNotification(server, method, params),
      onExit: (code) => this.onExit(server, connection, code),
    });
    server.connection = connection;
    try {
      const init = await connection.request<{ capabilities?: { diagnosticProvider?: unknown } }>(
        'initialize',
        {
          processId: process.pid,
          clientInfo: { name: 'Codium' },
          rootUri: uriOf(this.project.path),
          workspaceFolders: [{ uri: uriOf(this.project.path), name: this.project.name }],
          capabilities: CLIENT_CAPABILITIES,
          ...(launch.initializationOptions ? { initializationOptions: launch.initializationOptions } : {}),
        },
        60_000,
      );
      server.pullDiagnostics = init?.capabilities?.diagnosticProvider !== undefined && init.capabilities.diagnosticProvider !== null;
      connection.notify('initialized', {});
      // Nach einem Neustart: die offenen Dokumente erneut melden.
      for (const doc of this.documents.values()) {
        connection.notify('textDocument/didOpen', { textDocument: { uri: uriOf(doc.path), languageId: doc.languageId, version: doc.version, text: doc.text } });
        this.scheduleDiagnostics(doc.path);
      }
      return !this.disposed;
    } catch (err) {
      this.options.log(`TypeScript-Sprachserver startet nicht: ${(err as Error).message}`);
      return false;
    } finally {
      work.end();
    }
  }

  private answer(method: string, params: unknown): unknown {
    if (method === 'workspace/configuration') {
      const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
      return items.map(() => ({}));
    }
    if (method === 'workspace/workspaceFolders') return [{ uri: uriOf(this.project.path), name: this.project.name }];
    return null;
  }

  private onNotification(server: Server, method: string, params: unknown): void {
    if (method === 'textDocument/publishDiagnostics') {
      const p = params as { uri?: string; diagnostics?: unknown[] };
      if (p.uri?.startsWith('file:')) this.emitDiagnostics(pathOf(p.uri), p.diagnostics ?? []);
      return;
    }
    if (method === '$/progress') {
      const p = params as { token?: string | number; value?: { kind?: string; title?: string; message?: string; percentage?: number } };
      const token = String(p.token);
      const value = p.value ?? {};
      if (value.kind === 'begin') {
        server.progress.get(token)?.end();
        server.progress.set(token, this.project.progress.begin(value.title ?? 'TypeScript', percent(value.percentage)));
      } else if (value.kind === 'report') {
        server.progress.get(token)?.report({ ...(value.percentage !== undefined ? { fraction: percent(value.percentage) } : {}) });
      } else if (value.kind === 'end') {
        server.progress.get(token)?.end();
        server.progress.delete(token);
      }
    }
  }

  private onExit(server: Server, connection: LspConnection, code: number | null): void {
    for (const p of server.progress.values()) p.end();
    server.progress.clear();
    if (server.connection !== connection) return;
    server.connection = null;
    server.ready = null;
    if (server.stopping || this.disposed) return;
    // Abgestürzt: neu starten, höchstens dreimal in drei Minuten.
    const now = this.now();
    server.crashes = server.crashes.filter((t) => now - t < RESTART_WINDOW_MS);
    this.options.log(`TypeScript-Sprachserver abgestürzt (Exit-Code ${code}).`);
    if (server.crashes.length >= MAX_RESTARTS) {
      server.gaveUp = true;
      this.project.notify({
        level: 'error',
        text: `The TypeScript language server stopped ${MAX_RESTARTS + 1} times within three minutes and was not restarted. Reopen the project to try again.`,
      });
      return;
    }
    server.crashes.push(now);
    void this.ensure(server);
  }

  private async dispose(): Promise<void> {
    this.disposed = true;
    for (const timer of this.diagnosticTimers.values()) clearTimeout(timer);
    this.diagnosticTimers.clear();
    await this.stop(this.typescript);
  }

  /** Beendet einen Server geordnet (shutdown, exit), nach kurzer Frist samt Kindprozessen hart. */
  private async stop(server: Server): Promise<void> {
    const connection = server.connection;
    if (!connection) return;
    server.stopping = true;
    const pid = connection.pid;
    await connection.request('shutdown', null, 1500).catch(() => {});
    connection.notify('exit', null);
    let timer: NodeJS.Timeout | undefined;
    const exited = await Promise.race([connection.exit.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), 1000)))]);
    clearTimeout(timer);
    // Auch wenn der Server selbst endet, können Kindprozesse (tsserver von typescript-language-server) bleiben.
    if (pid !== undefined) await killProcessTree(pid);
    if (!exited) await connection.exit;
  }
}

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  window: { workDoneProgress: true },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    didChangeWatchedFiles: { dynamicRegistration: false },
  },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: false, willSave: false },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
    publishDiagnostics: { relatedInformation: false, tagSupport: { valueSet: [1, 2] } },
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
  },
};

function hoverMarkdown(contents: unknown): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverMarkdown).filter(Boolean).join('\n\n');
  const c = contents as { kind?: string; value?: string; language?: string };
  if (typeof c.value !== 'string') return '';
  if (c.language) return `\`\`\`${c.language}\n${c.value}\n\`\`\``;
  return c.value;
}

function percent(value: number | undefined): number | undefined {
  return typeof value === 'number' ? Math.max(0, Math.min(1, value / 100)) : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function key(file: string): string {
  return path.normalize(file).toLowerCase();
}

export function uriOf(file: string): string {
  return pathToFileURL(file).href;
}

/** Pfad einer file:-Adresse in der Schreibweise von Windows (Laufwerksbuchstabe gross). */
export function pathOf(uri: string): string {
  const file = path.normalize(fileURLToPath(uri));
  return /^[a-z]:/.test(file) ? file[0].toUpperCase() + file.slice(1) : file;
}
