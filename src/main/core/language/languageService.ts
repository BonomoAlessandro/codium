// Sprach-Dienst im Projekt-Kern (Tickets 12–14): startet Sprachserver (TypeScript/JavaScript, Java), meldet ihnen
// Dokumente und Dateiänderungen und bietet typisierte Methoden (Definition, Verwendungen, Implementierungen, Hover,
// Vervollständigung, semantische Token, Symbolsuche, Inhalt schreibgeschützter Ziele). Lädt nie Electron.
//
// - Höchstens ein Server je Sprache. Er startet beim Öffnen des Projekts, wenn Kennzeichen da sind (TypeScript:
//   tsconfig.json, jsconfig.json, package.json; Java: Maven- oder Gradle-Baudatei), sonst mit dem ersten passenden
//   Dokument. Java startet nur mit einem JDK ab 25; ohne gibt es keinen Java-Server (kein Absturz).
// - Stürzt er ab, startet er neu, höchstens dreimal in drei Minuten; danach erscheint ein Fehlerhinweis.
// - Beim Abbau beendet der Dienst alle Server samt Kindprozessen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ErrorCode,
  LARGE_FILE_BYTES,
  MAX_OPEN_FILE_BYTES,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  type CommandResult,
  type CompletionEntry,
  type JdkInfo,
  type SymbolMatch,
  type CodeLocation, type CommandParams, type LanguageDiagnostic, type TextRange } from '../../../shared/types';
import { descendantsOf, isAlive, killProcessTree } from '../processTree';
import type { Progress } from '../progress';
import type { ProjectCore } from '../projectCore';
import { CommandError } from '../router';
import { JAVA_MARKERS, isJavaFile, javaLaunch, type BundledJava } from './javaServer';
import { LspConnection } from './lspConnection';
import { TYPESCRIPT_MARKERS, typescriptLanguageId, typescriptLaunch, type BundledTypeScript, type TypeScriptLaunch } from './typescriptServer';
export type { BundledJava } from './javaServer';

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
  /** jdtls und Lombok, das JDK und Arbeitsordner; ohne Angabe gibt es keinen Java-Server. */
  java?: {
    bundled: BundledJava;
    /** Das JDK für jdtls (eingestellt oder das neueste ab 25); `null` ohne passendes. */
    jdk: () => JdkInfo | null;
    jdks: () => JdkInfo[];
    /** Ordner für Arbeitsdaten und Konfiguration von jdtls dieses Projekts. */
    dataDir: string;
    mavenUserSettings?: string;
  };
  log: (message: string) => void;
}

type ServerId = 'typescript' | 'java';

/** Wie ein Server startet. */
interface Launch {
  kind: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  initializationOptions?: unknown;
}

interface OpenDocument {
  path: string;
  server: ServerId;
  languageId: string;
  text: string;
  version: number;
}

/** Ein laufender Server einer Sprache. */
class Server {
  constructor(
    readonly id: ServerId,
    /** Name in Meldungen, etwa „TypeScript“. */
    readonly label: string,
  ) {}
  connection: LspConnection | null = null;
  ready: Promise<boolean> | null = null;
  launch: Launch | null = null;
  /** Java: „Importing Java project…“ bis jdtls bereit ist. */
  importing: Progress | null = null;
  pullDiagnostics = false;
  /** Legende der semantischen Token des Servers; `null`, wenn er keine liefert. */
  tokenLegend: { types: string[]; modifiers: string[] } | null = null;
  /** Nach `initialized`: Erst dann gehen Benachrichtigungen an den Server (Review von Ticket 12). */
  initialized = false;
  /** Dokumente, die der Server offen hat (Schlüssel); so geht nie ein zweites `didOpen` hinaus. */
  readonly sent = new Set<string>();
  stopping = false;
  gaveUp = false;
  crashes: number[] = [];
  readonly progress = new Map<string, Progress>();
  /**
   * Dateiänderungen, die kamen, während der Server startete: Vor `initialized` geht nichts an ihn (Spezifikation von LSP;
   * der native TypeScript-Server stürzte daran ab, Ticket 27). Nach `initialized` gehen sie in derselben Reihenfolge
   * hinaus; endet der Server vorher, verfallen sie.
   */
  pendingWatched: Array<{ uri: string; type: number }> = [];
}

export class LanguageService {
  private readonly servers: Record<ServerId, Server> = { typescript: new Server('typescript', 'TypeScript'), java: new Server('java', 'Java') };
  private get typescript(): Server {
    return this.servers.typescript;
  }
  private readonly documents = new Map<string, OpenDocument>();
  /** Dokumente, die der Dienst selbst geöffnet hat (Anfragen auf Dateien, die in der Oberfläche nicht offen sind). */
  private readonly implicit = new Set<string>();
  private readonly diagnosticTimers = new Map<string, NodeJS.Timeout>();
  /** Ziele ausserhalb des Projekts, die ein Server geliefert hat; nur sie liefert `readTarget`. */
  private readonly outsideTargets = new Set<string>();
  private readonly now: () => number;
  private disposed = false;
  /** Rohe Vorschläge der letzten Vervollständigung, für das Nachladen von Details. */
  private completionItems = new Map<number, unknown>();
  private completionConnection: LspConnection | null = null;
  private completionCounter = 0;

  constructor(
    private readonly project: ProjectCore,
    private readonly options: LanguageServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
    project.onDispose(() => this.dispose());
    project.subscribe('files.changed', (event) => {
      // Nach verpassten Ereignissen (etwa einem Branch-Wechsel) sind geänderte Inhalte nicht einzeln gemeldet: Selbst
      // geöffnete Dokumente könnten veraltet sein.
      if (event.rescanned) this.closeImplicit();
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
    if (this.hasJavaMarkers()) void this.ensure(this.servers.java);
  }

  private hasJavaMarkers(): boolean {
    return JAVA_MARKERS.some((m) => fs.existsSync(path.join(this.project.path, m)));
  }

  /** Prozessnummer des Java-Servers (Tests); `undefined`, wenn keiner läuft. */
  get javaPid(): number | undefined {
    const java = this.servers.java;
    return java.connection?.running ? java.connection.pid : undefined;
  }

  /** Ob jdtls fertig importiert hat (Tests). */
  get javaReady(): boolean {
    return this.servers.java.connection?.running === true && this.servers.java.importing === null && this.servers.java.initialized;
  }

  /** Ein anderes JDK in den Einstellungen: laufenden Java-Server neu starten (Ticket 14). */
  async restartJava(): Promise<void> {
    const java = this.servers.java;
    await this.stop(java);
    java.gaveUp = false;
    java.crashes = [];
    this.javaJdkCache = undefined;
    if (this.disposed) return;
    if (this.hasJavaMarkers() || [...this.documents.values()].some((d) => d.server === 'java')) await this.ensure(java);
  }

  /** Prozessnummer des TypeScript-Servers (Tests); `undefined`, wenn keiner läuft. */
  get typescriptPid(): number | undefined {
    return this.typescript.connection?.running ? this.typescript.connection.pid : undefined;
  }

  /** Welcher TypeScript-Server läuft (Tests). */
  get typescriptKind(): TypeScriptLaunch['kind'] | null {
    return this.typescript.connection?.running ? ((this.typescript.launch?.kind as TypeScriptLaunch['kind'] | undefined) ?? null) : null;
  }

  // ---------- Dokumente ----------

  async didOpen(params: CommandParams<'language.didOpen'>): Promise<void> {
    const p = params as Partial<CommandParams<'language.didOpen'>>;
    const file = this.project.files.lexicalPath(p?.path);
    if (typeof p.text !== 'string' || typeof p.version !== 'number') throw new CommandError('Text and version are expected.', ErrorCode.invalidParams);
    const languageId = languageIdOf(file);
    const id = serverIdOf(file);
    if (!languageId || !id) return;
    const doc = { path: file, server: id, languageId, text: p.text, version: p.version };
    // Hatte der Dienst die Datei schon selbst geöffnet (für eine Anfrage), gilt jetzt der Text der Oberfläche.
    this.implicit.delete(key(file));
    this.documents.set(key(file), doc);
    const server = this.servers[id];
    if (server.initialized && server.sent.has(key(file))) {
      server.connection?.notify('textDocument/didChange', { textDocument: { uri: uriOf(file), version: doc.version }, contentChanges: [{ text: doc.text }] });
      this.scheduleAllDiagnostics();
      return;
    }
    // Startet der Server gerade, meldet `start` das Dokument; sonst hier.
    if (await this.ensure(server)) {
      this.sendOpen(server, file);
      this.scheduleDiagnostics(file);
    }
  }

  /** Meldet ein Dokument dem Server, wenn er bereit ist und es noch nicht offen hat. */
  private sendOpen(server: Server, file: string): void {
    const k = key(file);
    const doc = this.documents.get(k);
    if (!doc || !server.initialized || server.sent.has(k) || !server.connection?.running) return;
    server.sent.add(k);
    server.connection.notify('textDocument/didOpen', { textDocument: { uri: uriOf(doc.path), languageId: doc.languageId, version: doc.version, text: doc.text } });
  }

  /** Schliesst ein Dokument beim Server, falls er es offen hat. */
  private sendClose(server: Server, doc: OpenDocument): void {
    const k = key(doc.path);
    if (!server.sent.delete(k)) return;
    server.connection?.notify('textDocument/didClose', { textDocument: { uri: uriOf(doc.path) } });
  }

  didChange(params: CommandParams<'language.didChange'>): void {
    const p = params as Partial<CommandParams<'language.didChange'>>;
    const file = this.project.files.lexicalPath(p?.path);
    const doc = this.documents.get(key(file));
    if (!doc || typeof p.text !== 'string' || typeof p.version !== 'number') return;
    doc.text = p.text;
    doc.version = p.version;
    const server = this.servers[doc.server];
    if (server.initialized && server.sent.has(key(file))) {
      server.connection?.notify('textDocument/didChange', {
        textDocument: { uri: uriOf(file), version: doc.version },
        contentChanges: [{ text: doc.text }],
      });
    }
    // Eine Änderung kann die Fehler aller offenen Dateien ändern (Review von Ticket 12).
    this.scheduleAllDiagnostics();
  }

  didClose(params: CommandParams<'language.didClose'>): void {
    const file = this.project.files.lexicalPath((params as Partial<CommandParams<'language.didClose'>>)?.path);
    const doc = this.documents.get(key(file));
    if (!doc) return;
    this.documents.delete(key(file));
    clearTimeout(this.diagnosticTimers.get(key(file)));
    this.diagnosticTimers.delete(key(file));
    this.sendClose(this.servers[doc.server], doc);
  }

  // ---------- Typisierte Methoden ----------

  definition(params: CommandParams<'language.definition'>): Promise<CodeLocation[]> {
    // Nur hier: ein grobes Ziel in einer Klassendatei wird kurz darauf genau (siehe `hasCoarseClassFileTarget`).
    return this.locations('textDocument/definition', params, {}, true);
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

  // ---------- Ticket 13: Vervollständigung, semantische Token, Symbolsuche ----------

  async completion(params: CommandParams<'language.completion'>): Promise<{ incomplete: boolean; items: CompletionEntry[] }> {
    const at = this.position(params);
    const trigger = (params as { triggerCharacter?: unknown } | undefined)?.triggerCharacter;
    const connection = await this.connectionFor(at.file);
    if (!connection) return { incomplete: false, items: [] };
    const result = await connection
      .request<unknown>('textDocument/completion', {
        textDocument: { uri: uriOf(at.file) },
        position: at.position,
        context: typeof trigger === 'string' && trigger !== '' ? { triggerKind: 2, triggerCharacter: trigger } : { triggerKind: 1 },
      })
      .catch(() => null);
    const list = (Array.isArray(result) ? { isIncomplete: false, items: result } : (result ?? { isIncomplete: false, items: [] })) as {
      isIncomplete?: boolean;
      items?: unknown[];
    };
    this.completionItems = new Map();
    this.completionConnection = connection;
    // Die Server filtern nicht nach dem getippten Wortanfang und liefern oft über tausend Vorschläge (Review von
    // Ticket 13). Codium filtert selbst (wie Monaco: die Buchstaben in dieser Reihenfolge) und begrenzt erst danach.
    const lineText = this.documents.get(key(at.file))?.text.split(/\r?\n/)[at.position.line] ?? '';
    const prefix = /[\p{L}\p{N}_$]*$/u.exec(lineText.slice(0, at.position.character))?.[0] ?? '';
    const candidates = ((list.items ?? []) as RawCompletion[])
      .filter((raw) => matchesPrefix(raw.filterText ?? raw.label ?? '', prefix))
      .sort((a, b) => (a.sortText ?? a.label ?? '').localeCompare(b.sortText ?? b.label ?? ''));
    const items: CompletionEntry[] = [];
    for (const raw of candidates.slice(0, COMPLETION_LIMIT)) {
      const id = ++this.completionCounter;
      this.completionItems.set(id, raw);
      items.push(completionEntry(raw, id));
    }
    // Nur wenn der Server es sagt oder Codium wirklich gekürzt hat, fragt Monaco beim Weitertippen neu.
    return { incomplete: list.isIncomplete === true || candidates.length > COMPLETION_LIMIT, items };
  }

  async resolveCompletion(params: CommandParams<'language.resolveCompletion'>): Promise<CommandResult<'language.resolveCompletion'>> {
    const id = (params as { id?: unknown } | undefined)?.id;
    const raw = typeof id === 'number' ? this.completionItems.get(id) : undefined;
    const connection = this.completionConnection;
    if (!raw || !connection?.running) return {};
    const resolved = await connection.request<RawCompletion | null>('completionItem/resolve', raw).catch(() => null);
    if (!resolved) return {};
    const documentation = markdownOf(resolved.documentation);
    // Automatischer Import: Der native Server liefert ihn hier als zusätzliche Änderung (Review von Ticket 13).
    const edits = textEdits(resolved.additionalTextEdits);
    return {
      ...(resolved.detail ? { detail: resolved.detail } : {}),
      ...(documentation ? { documentation } : {}),
      ...(edits.length > 0 ? { additionalTextEdits: edits } : {}),
    };
  }

  async semanticTokens(params: CommandParams<'language.semanticTokens'>): Promise<{ data: number[] } | null> {
    // Auch in Bibliothekszielen ausserhalb des Projekts (wie die anderen Anfragen).
    const file = this.position({ ...(params as object), line: 0, character: 0 }).file;
    const connection = await this.connectionFor(file);
    const id = serverIdOf(file);
    const legend = id ? this.servers[id].tokenLegend : null;
    if (!connection || !legend) return null;
    const result = await connection
      .request<{ data?: number[] } | null>('textDocument/semanticTokens/full', { textDocument: { uri: uriOf(file) } })
      .catch(() => null);
    if (!result?.data) return null;
    return { data: remapTokens(result.data, legend) };
  }

  async symbols(params: CommandParams<'language.symbols'>): Promise<SymbolMatch[]> {
    const p = params as Partial<CommandParams<'language.symbols'>> | undefined;
    if (typeof p?.query !== 'string' || (p.kinds !== 'types' && p.kinds !== 'all')) {
      throw new CommandError('A query and kinds are expected.', ErrorCode.invalidParams);
    }
    // Über alle Sprachserver des Projekts; einer, der nicht läuft, startet dafür nicht.
    const results = await Promise.all(
      Object.values(this.servers).map(async (server) => {
        if (!server.connection?.running) return [];
        // Ein Server, der noch importiert (jdtls), hält die Treffer der anderen nicht auf (Review von Ticket 14).
        const answer = (async () => {
          if (!(await server.ready) || !server.initialized) return [];
          return (await server.connection?.request<unknown[] | null>('workspace/symbol', { query: p.query }).catch(() => null)) ?? [];
        })();
        return Promise.race([answer, new Promise<unknown[]>((resolve) => setTimeout(() => resolve([]), SYMBOL_WAIT_MS))]);
      }),
    );
    const result = results.flat();
    const out: SymbolMatch[] = [];
    for (const raw of (result ?? []) as Array<{ name?: string; kind?: number; containerName?: string; location?: { uri?: string; range?: TextRange } }>) {
      if (typeof raw.name !== 'string' || typeof raw.kind !== 'number' || !raw.location?.uri?.startsWith('file:')) continue;
      if (p.kinds === 'types' && !TYPE_KINDS.has(raw.kind)) continue;
      const file = pathOf(raw.location.uri);
      // Nur Symbole im Projekt, ohne node_modules (wie die Symbolsuche von IntelliJ ohne Bibliotheken).
      if (this.isLibrary(file)) continue;
      const range = raw.location.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
      out.push({
        name: raw.name,
        kind: raw.kind,
        ...(raw.containerName ? { container: raw.containerName } : {}),
        path: file,
        range: await this.atName(file, range, raw.name),
      });
      if (out.length >= 500) break;
    }
    return out;
  }

  /**
   * Der Bereich eines Symbols an seinem Namen: TypeScript 6 meldet die ganze Deklaration ab Zeilenanfang
   * (`export type …`), Enter soll aber am Namen landen (Review von Ticket 13).
   */
  private async atName(file: string, range: TextRange, name: string): Promise<TextRange> {
    const text = this.documents.get(key(file))?.text ?? (await fs.promises.readFile(file, 'utf8').catch(() => null));
    const line = text?.split(/\r?\n/)[range.start.line];
    if (line === undefined) return range;
    const at = line.indexOf(name, range.start.character);
    if (at < 0 || (range.end.line === range.start.line && at > range.end.character)) return range;
    return { start: { line: range.start.line, character: at }, end: { line: range.start.line, character: at + name.length } };
  }

  /** Inhalt eines schreibgeschützten Ziels: unter node_modules im Projekt oder ein vom Server geliefertes Ziel. */
  async readTarget(params: CommandParams<'language.readTarget'>): Promise<{ text: string }> {
    const value = (params as Partial<CommandParams<'language.readTarget'>>)?.path;
    if (typeof value !== 'string' || (!path.isAbsolute(value) && !isJdtUri(value))) throw new CommandError('An absolute path is expected.', ErrorCode.invalidParams);
    // Klassendateien (JDK, Bibliotheken) über die Erweiterung von jdtls für Klasseninhalte (Ticket 14).
    if (isJdtUri(value)) {
      const java = this.servers.java;
      const notTarget = () => new CommandError(`Not a target of the language server: ${value}`, ErrorCode.pathOutsideProject, { path: value });
      if (!this.outsideTargets.has(key(value))) throw notTarget();
      // Startet jdtls gerade neu, erst nach `initialized` (wie jede Anfrage, siehe `pendingWatched`).
      const connection = (await this.ensure(java)) && java.initialized ? java.connection : null;
      if (!connection?.running) throw notTarget();
      const text = await connection.request<string | null>('java/classFileContents', { uri: value }).catch(() => null);
      if (typeof text !== 'string') throw new CommandError(`The class file could not be read: ${value}`, ErrorCode.fileNotFound, { path: value });
      return { text };
    }
    const file = path.normalize(value);
    let allowed = this.outsideTargets.has(key(file));
    if (!allowed && file.toLowerCase().includes(`${path.sep}node_modules${path.sep}`)) {
      // Unter node_modules im Projekt, auch nach dem Auflösen von Junctions und Links.
      const [real, root] = await Promise.all([fs.promises.realpath(file).catch(() => null), fs.promises.realpath(this.project.path).catch(() => null)]);
      allowed = this.isInsideProject(file) && real !== null && root !== null && key(real).startsWith(key(root) + path.sep);
    }
    if (!allowed) throw new CommandError(`Not a target of the language server: ${file}`, ErrorCode.pathOutsideProject, { path: file });
    const size = (await fs.promises.stat(file).catch(() => null))?.size ?? 0;
    if (size >= MAX_OPEN_FILE_BYTES) throw new CommandError(`The file is too large to open: ${file}`, ErrorCode.fileTooLarge, { path: file });
    try {
      return { text: await fs.promises.readFile(file, 'utf8') };
    } catch {
      throw new CommandError(`The file could not be read: ${file}`, ErrorCode.fileNotFound, { path: file });
    }
  }

  private position(params: unknown): { file: string; position: { line: number; character: number } } {
    const p = params as Partial<{ path: unknown; line: unknown; character: unknown }> | undefined;
    // Auch in Bibliothekszielen ausserhalb des Projekts (etwa lib.dom.d.ts) gehen weitere Sprünge (Review von Ticket 12).
    const jdt = typeof p?.path === 'string' && isJdtUri(p.path) && this.outsideTargets.has(key(p.path));
    const outside = !jdt && typeof p?.path === 'string' && path.isAbsolute(p.path) && this.outsideTargets.has(key(path.normalize(p.path)));
    const file = jdt ? (p!.path as string) : outside ? path.normalize(p!.path as string) : this.project.files.lexicalPath(p?.path);
    if (!isCount(p?.line) || !isCount(p?.character)) throw new CommandError('A position is expected.', ErrorCode.invalidParams);
    return { file, position: { line: p.line, character: p.character } };
  }

  private async locations(method: string, params: unknown, extra: Record<string, unknown> = {}, refineCoarse = false): Promise<CodeLocation[]> {
    const at = this.position(params);
    const connection = await this.connectionFor(at.file);
    if (!connection) return [];
    const ask = () => connection.request<unknown>(method, { textDocument: { uri: uriOf(at.file) }, position: at.position, ...extra }).catch(() => null);
    const result = refineCoarse
      ? await askUntilPrecise(ask, hasCoarseClassFileTarget, {
          windowMs: COARSE_TARGET_WINDOW_MS,
          delayMs: COARSE_TARGET_DELAY_MS,
          stop: () => this.disposed || !connection.running,
        })
      : await ask();
    const out: CodeLocation[] = [];
    for (const item of locationItems(result)) {
      const uri = item.targetUri ?? item.uri;
      const range = item.targetSelectionRange ?? item.range ?? item.targetRange;
      if (!uri || !range || (!uri.startsWith('file:') && !isJdtUri(uri))) continue;
      const file = pathOf(uri);
      const readOnly = this.isLibrary(file);
      if (readOnly && !this.isInsideProject(file)) this.outsideTargets.add(key(file));
      out.push({ path: file, range, ...(readOnly ? { readOnly: true as const } : {}) });
    }
    return out;
  }

  private isInsideProject(file: string): boolean {
    if (isJdtUri(file)) return false;
    const root = key(this.project.path);
    return key(file).startsWith(root + path.sep) || key(file) === root;
  }

  private isLibrary(file: string): boolean {
    return !this.isInsideProject(file) || key(file).includes(`${path.sep}node_modules${path.sep}`);
  }

  /** Der Server für eine Datei, gestartet und bereit; `null`, wenn es keinen gibt. */
  private async connectionFor(file: string): Promise<LspConnection | null> {
    const languageId = languageIdOf(file);
    const id = serverIdOf(file);
    if (!languageId || !id || !(await this.ensure(this.servers[id]))) return null;
    // Ist der Server inzwischen abgestürzt und startet neu, bekommt er vor `initialized` nichts (siehe `pendingWatched`).
    if (!this.servers[id].initialized) return null;
    const connection = this.servers[id].connection;
    if (isJdtUri(file)) return connection;
    // tsserver (TypeScript bis 6) beantwortet Anfragen nur für offene Dokumente: sonst mit dem Text von der Festplatte.
    // Dateien ab 5 MB meldet die Oberfläche bewusst nicht; dann auch hier nicht.
    if (connection && !this.documents.has(key(file))) {
      const size = (await fs.promises.stat(file).catch(() => null))?.size ?? LARGE_FILE_BYTES;
      const text = size < LARGE_FILE_BYTES ? await fs.promises.readFile(file, 'utf8').catch(() => null) : null;
      if (text !== null && !this.documents.has(key(file))) {
        this.documents.set(key(file), { path: file, server: id, languageId, text, version: 0 });
        this.implicit.add(key(file));
        this.sendOpen(this.servers[id], file);
      }
    }
    return connection;
  }

  // ---------- Fehler und Warnungen ----------

  private scheduleAllDiagnostics(): void {
    for (const doc of this.documents.values()) if (!this.implicit.has(key(doc.path))) this.scheduleDiagnostics(doc.path);
  }

  private scheduleDiagnostics(file: string): void {
    const doc = this.documents.get(key(file));
    if (!doc || !this.servers[doc.server].pullDiagnostics) return;
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
    const doc = this.documents.get(key(file));
    const server = doc ? this.servers[doc.server] : null;
    // Ein Server, der gerade (neu) startet, bekommt nichts vor `initialized` (Spezifikation von LSP); der native
    // TypeScript-Server stürzte daran ab (Ticket 27). `start` holt die Fehler danach ohnehin.
    const connection = server?.initialized && server.connection?.running ? server.connection : null;
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
    const servers = Object.values(this.servers).filter((s) => s.connection?.running === true);
    if (servers.length === 0 || changes.length === 0) return;
    // Selbst geöffnete Dokumente (siehe `connectionFor`) stimmen nach einer Änderung auf der Festplatte nicht mehr:
    // schliessen, dann liest der Server die Datei selbst (oder weiss, dass sie fehlt).
    for (const change of changes) {
      const k = key(change.path);
      this.closeImplicit((d) => d === k || d.startsWith(k + path.sep));
    }
    const events = changes.map((c) => ({ uri: uriOf(c.path), type: c.type }));
    for (const server of servers) {
      // Ein startender Server bekommt sie nach `initialized` (siehe `pendingWatched`).
      if (server.initialized) server.connection!.notify('workspace/didChangeWatchedFiles', { changes: events });
      else server.pendingWatched.push(...events);
    }
    // Andere Dateien können die Fehler der offenen ändern.
    this.scheduleAllDiagnostics();
  }

  /** Schliesst selbst geöffnete Dokumente (alle oder die passenden). */
  private closeImplicit(match: (k: string) => boolean = () => true): void {
    for (const k of [...this.implicit].filter(match)) {
      const doc = this.documents.get(k);
      this.implicit.delete(k);
      this.documents.delete(k);
      if (doc) this.sendClose(this.servers[doc.server], doc);
    }
  }

  // ---------- Lebenszyklus ----------

  /** Startet den Server, falls nötig, und wartet, bis er bereit ist. `false`, wenn es keinen gibt. */
  private ensure(server: Server): Promise<boolean> {
    if (this.disposed || server.gaveUp || !this.available(server)) return Promise.resolve(false);
    if (server.connection?.running && server.ready) return server.ready;
    server.ready = this.start(server);
    return server.ready;
  }

  /** Ob es für einen Server alles Nötige gibt; Java ohne JDK ab 25 oder ohne jdtls nicht (das ist kein Absturz). */
  private available(server: Server): boolean {
    if (server.id === 'typescript') return this.options.typescript !== undefined;
    const java = this.options.java;
    return java !== undefined && fs.existsSync(java.bundled.jdtls) && this.javaJdk() !== null;
  }

  /**
   * Das JDK für jdtls, einmal ermittelt: Die JDK-Erkennung liest Ordner und Dateien und soll nicht bei jeder Anfrage
   * laufen (Review von Ticket 14). `restartJava` ermittelt es neu.
   */
  private javaJdkCache: JdkInfo | null | undefined = undefined;
  private javaJdk(): JdkInfo | null {
    if (this.javaJdkCache === undefined) this.javaJdkCache = this.options.java?.jdk() ?? null;
    return this.javaJdkCache;
  }

  private launchFor(server: Server): Launch | null {
    if (server.id === 'typescript') return typescriptLaunch(this.project.path, this.options.typescript!);
    const java = this.options.java!;
    const jdk = this.javaJdk();
    if (!jdk) return null;
    const mavenHome = this.options.env?.MAVEN_HOME ?? this.options.env?.M2_HOME ?? process.env.MAVEN_HOME ?? process.env.M2_HOME;
    const globalSettings = mavenHome ? path.join(mavenHome, 'conf', 'settings.xml') : null;
    return javaLaunch(this.project.path, {
      bundled: java.bundled,
      jdk,
      jdks: java.jdks(),
      dataDir: java.dataDir,
      ...(java.mavenUserSettings ? { mavenUserSettings: java.mavenUserSettings } : {}),
      // Globale Maven-Einstellungen (etwa ein Firmen-Mirror); nicht, wenn eigene vorgegeben sind (Tests).
      ...(!java.mavenUserSettings && globalSettings && fs.existsSync(globalSettings) ? { mavenGlobalSettings: globalSettings } : {}),
    });
  }

  private async start(server: Server): Promise<boolean> {
    let launch: Launch | null;
    try {
      launch = this.launchFor(server);
    } catch (err) {
      this.options.log(`${server.label}-Sprachserver lässt sich nicht starten: ${(err as Error).message}`);
      return false;
    }
    if (!launch) return false;
    server.launch = launch;
    server.stopping = false;
    server.initialized = false;
    server.sent.clear();
    server.pendingWatched = [];
    const work = this.project.progress.begin(server.id === 'java' ? 'Importing Java project…' : 'Starting TypeScript language server…');
    // Java: Der Import läuft nach `initialize` weiter, bis jdtls „ServiceReady“ meldet.
    if (server.id === 'java') server.importing = work;
    let connection: LspConnection;
    try {
      connection = new LspConnection({
        command: launch.command,
        args: launch.args,
        cwd: this.project.path,
        env: { ...(this.options.env ?? process.env), ...launch.env },
        log: this.options.log,
        onRequest: (method, params) => this.answer(method, params),
        onNotification: (method, params) => this.onNotification(server, method, params),
        onExit: (code) => this.onExit(server, connection, code),
      });
    } catch (err) {
      // Ein Programm, das sich gar nicht starten lässt (etwa ein kaputtes java.exe), wirft schon beim Start.
      this.options.log(`${server.label}-Sprachserver startet nicht: ${(err as Error).message}`);
      work.end();
      if (server.importing === work) server.importing = null;
      return false;
    }
    server.connection = connection;
    try {
      const init = await connection.request<{
        capabilities?: { diagnosticProvider?: unknown; semanticTokensProvider?: { legend?: { tokenTypes?: string[]; tokenModifiers?: string[] } } };
      }>(
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
      const legend = init?.capabilities?.semanticTokensProvider?.legend;
      server.tokenLegend = legend ? { types: legend.tokenTypes ?? [], modifiers: legend.tokenModifiers ?? [] } : null;
      connection.notify('initialized', {});
      server.initialized = true;
      if (server.pendingWatched.length > 0) {
        connection.notify('workspace/didChangeWatchedFiles', { changes: server.pendingWatched });
        server.pendingWatched = [];
      }
      // Die offenen Dokumente melden (auch die, die während des Starts kamen, und nach einem Neustart).
      for (const doc of this.documents.values()) this.sendOpen(server, doc.path);
      this.scheduleAllDiagnostics();
      return !this.disposed;
    } catch (err) {
      this.options.log(`${server.label}-Sprachserver startet nicht: ${(err as Error).message}`);
      // Hängt er oder lehnt er ab, läuft er womöglich weiter: beenden, das zählt wie ein Absturz (Review von Ticket 12).
      if (connection.running && connection.pid !== undefined) await killProcessTree(connection.pid);
      return false;
    } finally {
      if (server.id !== 'java' || !server.initialized) {
        work.end();
        if (server.importing === work) server.importing = null;
      }
    }
  }

  private answer(method: string, params: unknown): unknown {
    if (method === 'workspace/configuration') {
      const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
      return items.map(() => ({}));
    }
    if (method === 'workspace/workspaceFolders') return [{ uri: uriOf(this.project.path), name: this.project.name }];
    if (method === 'workspace/diagnostic/refresh') this.scheduleAllDiagnostics();
    return null;
  }

  private onNotification(server: Server, method: string, params: unknown): void {
    if (method === 'textDocument/publishDiagnostics') {
      const p = params as { uri?: string; diagnostics?: unknown[] };
      if (p.uri?.startsWith('file:')) this.emitDiagnostics(pathOf(p.uri), p.diagnostics ?? []);
      return;
    }
    // jdtls: Stand des Imports; danach ist der Server bereit.
    if (method === 'language/status') {
      const type = (params as { type?: string } | undefined)?.type;
      if ((type === 'ServiceReady' || type === 'Error') && server.importing) {
        server.importing.end();
        server.importing = null;
      }
      return;
    }
    if (method === '$/progress') {
      const p = params as { token?: string | number; value?: { kind?: string; title?: string; message?: string; percentage?: number } };
      const token = String(p.token);
      const value = p.value ?? {};
      if (value.kind === 'begin') {
        server.progress.get(token)?.end();
        server.progress.set(token, this.project.progress.begin(value.title ?? server.label, percent(value.percentage)));
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
    server.importing?.end();
    server.importing = null;
    server.connection = null;
    server.ready = null;
    server.initialized = false;
    server.sent.clear();
    server.pendingWatched = [];
    // Selbst geöffnete Dokumente öffnet der neue Server bei Bedarf wieder, mit dem dann aktuellen Text.
    for (const k of [...this.implicit]) {
      if (this.documents.get(k)?.server !== server.id) continue;
      this.documents.delete(k);
      this.implicit.delete(k);
    }
    if (server.stopping || this.disposed) return;
    // Abgestürzt: neu starten, höchstens dreimal in drei Minuten.
    const now = this.now();
    server.crashes = server.crashes.filter((t) => now - t < RESTART_WINDOW_MS);
    this.options.log(`${server.label}-Sprachserver abgestürzt (Exit-Code ${code}).`);
    if (server.crashes.length >= MAX_RESTARTS) {
      server.gaveUp = true;
      this.project.notify({
        level: 'error',
        text: `The ${server.label} language server stopped ${MAX_RESTARTS + 1} times within three minutes and was not restarted. Reopen the project to try again.`,
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
    await Promise.all(Object.values(this.servers).map((server) => this.stop(server)));
  }

  /** Beendet einen Server geordnet (shutdown, exit), nach kurzer Frist samt Kindprozessen hart. */
  private async stop(server: Server): Promise<void> {
    const connection = server.connection;
    if (!connection) return;
    server.stopping = true;
    server.importing?.end();
    server.importing = null;
    const pid = connection.pid;
    // typescript-language-server startet tsserver als Kinder; sie enden mit ihm, aber erst einen Augenblick später und
    // halten bis dahin den Projektordner (Review von Ticket 13). Vorher erfassen, nachher auf sie warten.
    const children = server.launch?.kind === 'project-tsserver' && pid !== undefined ? await descendantsOf(pid) : [];
    // Ohne `params`: Der native Server lehnt `params: null` ab und endet dann nicht (Review von Ticket 12).
    await connection.request('shutdown', undefined, 1500).catch(() => {});
    connection.notify('exit', undefined);
    let timer: NodeJS.Timeout | undefined;
    const exited = await Promise.race([connection.exit.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), 1000)))]);
    clearTimeout(timer);
    // Nur einen Server, der nicht endet, samt Kindern hart beenden. Endet er selbst, ist seine Prozessnummer frei und
    // könnte schon zu einem fremden Prozess gehören; seine Kinder (tsserver) enden mit ihm.
    if (!exited) {
      this.options.log(`${server.label}-Sprachserver hart beendet (keine Antwort auf shutdown/exit).`);
      if (pid !== undefined) await killProcessTree(pid);
      await connection.exit;
    }
    const until = Date.now() + 2000;
    while (children.some(isAlive) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    for (const child of children.filter(isAlive)) await killProcessTree(child);
  }
}

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  window: { workDoneProgress: true },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    didChangeWatchedFiles: { dynamicRegistration: false },
    diagnostics: { refreshSupport: true },
    symbol: {},
  },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: false, willSave: false },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        insertReplaceSupport: false,
        resolveSupport: { properties: ['documentation', 'detail'] },
      },
    },
    semanticTokens: {
      requests: { full: true },
      tokenTypes: [...SEMANTIC_TOKEN_TYPES],
      tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
      formats: ['relative'],
    },
    publishDiagnostics: { relatedInformation: false, tagSupport: { valueSet: [1, 2] } },
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
  },
};

/** Klassen, Interfaces, Enums und Structs (`SymbolKind`) für Ctrl + N. */
const TYPE_KINDS = new Set([5, 10, 11, 23]);

/** So lange wartet die Symbolsuche höchstens auf einen einzelnen Server. */
const SYMBOL_WAIT_MS = 5000;

/** So viele Vorschläge gehen nach dem Filtern höchstens an die Oberfläche. */
const COMPLETION_LIMIT = 1000;

/**
 * Ein grobes Ziel in einer Klassendatei (siehe `hasCoarseClassFileTarget`) fragt der Dienst in diesem Abstand neu,
 * höchstens so lange nach der ersten Antwort; danach gilt die letzte. Gemessen lieferte jdtls weniger als eine Sekunde
 * nach der groben Antwort den Namen. Bleibt ein Ziel grob (eine Bibliothek ohne Quellen), kostet der Sprung so höchstens
 * 4 s und acht weitere Anfragen.
 */
const COARSE_TARGET_WINDOW_MS = 4000;
const COARSE_TARGET_DELAY_MS = 500;

/** Ob ein Vorschlag zum getippten Wortanfang passt: dessen Buchstaben in dieser Reihenfolge, ohne Gross/Klein. */
export function matchesPrefix(text: string, prefix: string): boolean {
  if (prefix === '') return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of prefix.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

function textEdits(value: unknown): Array<{ range: TextRange; newText: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is { range: TextRange; newText: string } => typeof e?.newText === 'string' && e?.range?.start !== undefined);
}

interface RawCompletion {
  label?: string;
  kind?: number;
  detail?: string;
  documentation?: unknown;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { newText?: string; range?: TextRange; replace?: TextRange };
  sortText?: string;
  filterText?: string;
  commitCharacters?: string[];
  additionalTextEdits?: unknown;
}

function completionEntry(raw: RawCompletion, id: number): CompletionEntry {
  const label = typeof raw.label === 'string' ? raw.label : '';
  const documentation = markdownOf(raw.documentation);
  const range = raw.textEdit?.range ?? raw.textEdit?.replace;
  return {
    id,
    label,
    kind: typeof raw.kind === 'number' ? raw.kind : 1,
    ...(raw.detail ? { detail: raw.detail } : {}),
    ...(documentation ? { documentation } : {}),
    insertText: raw.textEdit?.newText ?? raw.insertText ?? label,
    ...(raw.insertTextFormat === 2 ? { snippet: true as const } : {}),
    ...(range ? { range } : {}),
    ...(raw.sortText ? { sortText: raw.sortText } : {}),
    ...(raw.filterText ? { filterText: raw.filterText } : {}),
    ...(raw.commitCharacters ? { commitCharacters: raw.commitCharacters } : {}),
    ...(textEdits(raw.additionalTextEdits).length > 0 ? { additionalTextEdits: textEdits(raw.additionalTextEdits) } : {}),
  };
}

/**
 * Andere Namen derselben Art in den Legenden der Server: typescript-language-server sagt `member` für Methoden, jdtls
 * hat eigene Arten für Records und Attribute von Annotationen (Ticket 14).
 */
const TOKEN_TYPE_ALIASES: Record<string, string> = { member: 'method', record: 'class', recordComponent: 'property', annotationMember: 'method' };

function markdownOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  const v = value as { kind?: string; value?: string } | undefined;
  return typeof v?.value === 'string' && v.value !== '' ? v.value : undefined;
}

/**
 * Rechnet semantische Token von der Legende des Servers auf die gemeinsame Legende um. Token mit einer Art, die die
 * gemeinsame Legende nicht kennt, fallen weg; die relativen Positionen werden dafür neu berechnet.
 */
export function remapTokens(data: readonly number[], legend: { types: readonly string[]; modifiers: readonly string[] }): number[] {
  const typeIndex = legend.types.map((t) => (SEMANTIC_TOKEN_TYPES as readonly string[]).indexOf(TOKEN_TYPE_ALIASES[t] ?? t));
  const modifierBit = legend.modifiers.map((m) => (SEMANTIC_TOKEN_MODIFIERS as readonly string[]).indexOf(m));
  const out: number[] = [];
  let line = 0;
  let char = 0;
  let lastLine = 0;
  let lastChar = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i];
    line += deltaLine;
    char = deltaLine === 0 ? char + data[i + 1] : data[i + 1];
    const type = typeIndex[data[i + 3]] ?? -1;
    if (type < 0) continue;
    let modifiers = 0;
    for (let bit = 0; bit < modifierBit.length; bit++) {
      if ((data[i + 4] & (1 << bit)) !== 0 && modifierBit[bit] >= 0) modifiers |= 1 << modifierBit[bit];
    }
    out.push(line - lastLine, line === lastLine ? char - lastChar : char, data[i + 2], type, modifiers);
    lastLine = line;
    lastChar = char;
  }
  return out;
}

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

/** Klassendateien liefert jdtls als `jdt://contents/…`; sie sind keine Pfade (Ticket 14). */
export function isJdtUri(value: string): boolean {
  return value.startsWith('jdt:');
}

/** Ein Ziel, wie die Server es liefern: `Location` oder `LocationLink`. */
interface LocationItem {
  uri?: string;
  range?: TextRange;
  targetUri?: string;
  targetSelectionRange?: TextRange;
  targetRange?: TextRange;
}

/** Die Ziele einer Antwort auf definition oder implementation: eines, eine Liste oder keines. */
function locationItems(result: unknown): LocationItem[] {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  return list.filter((item): item is LocationItem => typeof item === 'object' && item !== null);
}

/**
 * Ob ein Ziel in einer Klassendatei (`jdt://…`) nur grob ist: ein Bereich über mehrere Zeilen statt des Namens. jdtls
 * liefert kurz nach dem Import, solange die Quellen des JDK im Projekt noch nicht eingebunden sind, die ganze Datei als
 * Bereich (etwa 0:0 bis 4917:0 für String); Monaco nimmt dessen Anfang, und der Sprung landete auf Zeile 1 statt auf der
 * Deklaration (Ticket 27). Ein Name steht immer auf einer Zeile.
 */
export function hasCoarseClassFileTarget(result: unknown): boolean {
  return locationItems(result).some((item) => {
    const uri = item.targetUri ?? item.uri;
    const range = item.targetSelectionRange ?? item.range ?? item.targetRange;
    return typeof uri === 'string' && isJdtUri(uri) && range !== undefined && range.end.line > range.start.line;
  });
}

/**
 * Fragt neu, solange die Antwort grob ist, mit `delayMs` Pause dazwischen, aber höchstens `windowMs` nach der ersten
 * Antwort; eine Anfrage, die dann noch läuft, wartet der Aufruf nicht ab. Bleibt die Antwort grob (etwa eine Bibliothek
 * ganz ohne Quellen), gilt die letzte.
 */
export async function askUntilPrecise<T>(
  ask: () => Promise<T>,
  coarse: (answer: T) => boolean,
  options: { windowMs: number; delayMs: number; stop?: () => boolean },
): Promise<T> {
  const sleep = (ms: number) => new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms));
  let answer: T = await ask();
  const deadline = Date.now() + options.windowMs;
  while (coarse(answer) && !options.stop?.()) {
    if (deadline - Date.now() <= 0) break;
    await sleep(Math.min(options.delayMs, deadline - Date.now()));
    const left = deadline - Date.now();
    if (left <= 0 || options.stop?.()) break;
    const next: { value: T } | 'timeout' = await Promise.race([ask().then((value): { value: T } => ({ value })), sleep(left)]);
    if (next === 'timeout') break;
    answer = next.value;
  }
  return answer;
}

function serverIdOf(file: string): ServerId | null {
  if (typescriptLanguageId(file)) return 'typescript';
  if (isJavaFile(file) || isJdtUri(file)) return 'java';
  return null;
}

function languageIdOf(file: string): string | null {
  return typescriptLanguageId(file) ?? (isJavaFile(file) || isJdtUri(file) ? 'java' : null);
}

function key(file: string): string {
  if (isJdtUri(file)) return file.toLowerCase();
  return path.normalize(file).toLowerCase();
}

export function uriOf(file: string): string {
  if (isJdtUri(file)) return file;
  return pathToFileURL(file).href;
}

/** Pfad einer file:-Adresse in der Schreibweise von Windows (Laufwerksbuchstabe gross). */
export function pathOf(uri: string): string {
  if (isJdtUri(uri)) return uri;
  const file = path.normalize(fileURLToPath(uri));
  return /^[a-z]:/.test(file) ? file[0].toUpperCase() + file.slice(1) : file;
}
