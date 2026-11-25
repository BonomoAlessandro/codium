// Nachgemachter Sprachserver für Teststelle 1 (Ticket 27). Er verhält sich beim Start wie der native TypeScript-Server
// (tsgo): Kommt vor `initialized` etwas anderes als `initialize`, stürzt er ab (Exit-Code 2; tsgo endet mit einer
// Go-Panic, weil seine Sitzung noch fehlt). Er beantwortet `initialize` nach einer Verzögerung, bietet Fehler zum Abholen
// an und schreibt jede Nachricht in eine Protokolldatei, bei Dateiänderungen mit den Dateinamen.
//
// Umgebung: FAKE_LSP_LOG (Protokolldatei), FAKE_LSP_INIT_DELAY_MS (Verzögerung der Antwort auf `initialize`).
//
// Abstürze auf Bestellung (Ticket 30): Solange die Datei FAKE_LSP_CRASH_FILE existiert, schreibt der Server nach einer
// Nachricht mit der Methode FAKE_LSP_CRASH_ON (Standard `textDocument/didOpen`) etwas auf stderr und endet mit dem
// Exit-Code FAKE_LSP_EXIT_CODE (Standard 2). Auf stderr kommen FAKE_LSP_STDERR_LINES nummerierte Zeilen (Standard 3)
// und zum Schluss eine Zeile wie bei einer Go-Panic. Ohne die Datei beantwortet er `textDocument/definition` mit einem
// Ziel am Anfang des Dokuments. Mit FAKE_LSP_HOLD_STDERR_MS hält ein Hilfsprozess stderr nach dem Absturz so lange offen
// (wie ein Kindprozess eines echten Servers); Codium sieht dann das Ende des Servers vor dem Ende von stderr.
// Node startet die Datei direkt (siehe processes.ts).

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

const log = process.env.FAKE_LSP_LOG ?? '';
const initDelay = Number(process.env.FAKE_LSP_INIT_DELAY_MS ?? '0');
const crashFile = process.env.FAKE_LSP_CRASH_FILE ?? '';
const crashOn = process.env.FAKE_LSP_CRASH_ON ?? 'textDocument/didOpen';
const exitCode = Number(process.env.FAKE_LSP_EXIT_CODE ?? '2');
const stderrLines = Number(process.env.FAKE_LSP_STDERR_LINES ?? '3');
const holdStderrMs = Number(process.env.FAKE_LSP_HOLD_STDERR_MS ?? '0');
const NL = String.fromCharCode(10);
const HEADER_END = String.fromCharCode(13, 10, 13, 10);

function note(line: string): void {
  if (log) fs.appendFileSync(log, `${process.pid} ${line}${NL}`);
}

function send(message: Record<string, unknown>): void {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_END}`, 'ascii'), body]));
}

/** Schreibt die bestellten Zeilen auf stderr und endet erst, wenn sie draussen sind. */
function crash(method: string): void {
  note(`absturz ${method}`);
  const lines: string[] = [];
  for (let i = 1; i <= stderrLines; i++) lines.push(`stderr line ${String(i).padStart(6, '0')} of ${stderrLines}`);
  lines.push(`panic: fake crash after ${method} [pid ${process.pid}]`);
  if (holdStderrMs > 0) {
    // Der Hilfsprozess erbt stderr und endet von selbst; sein Arbeitsordner ist nicht der Projektordner (Löschen im Test).
    spawn(process.execPath, ['-e', `setTimeout(() => {}, ${holdStderrMs})`], { stdio: ['ignore', 'ignore', 'inherit'], cwd: os.tmpdir(), windowsHide: true }).unref();
  }
  process.stderr.write(lines.join(NL) + NL, () => process.exit(exitCode));
}

let initialized = false;

function handle(message: { id?: number; method?: string; params?: { changes?: Array<{ uri: string }>; textDocument?: { uri: string } } }): void {
  if (message.method === undefined) return;
  // Bei Dateiänderungen auch die Dateinamen, in der gemeldeten Reihenfolge.
  const names = message.method === 'workspace/didChangeWatchedFiles' ? (message.params?.changes ?? []).map((c) => c.uri.split('/').pop()).join(',') : '';
  note(names ? `${message.method} ${names}` : message.method);
  if (message.method === 'initialize') {
    setTimeout(() => send({ id: message.id, result: { capabilities: { textDocumentSync: 1, definitionProvider: true, diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } } } }), initDelay);
    return;
  }
  if (message.method === 'initialized') {
    initialized = true;
    return;
  }
  if (!initialized && message.method !== 'exit' && message.method !== 'shutdown') {
    note(`verfrüht ${message.method}`);
    process.exit(2);
  }
  if (message.method === 'exit') process.exit(0);
  if (crashFile && message.method === crashOn && fs.existsSync(crashFile)) {
    crash(message.method);
    return;
  }
  if (message.id === undefined) return;
  if (message.method === 'textDocument/definition' && message.params?.textDocument) {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    send({ id: message.id, result: [{ uri: message.params.textDocument.uri, range }] });
    return;
  }
  send({ id: message.id, result: message.method === 'textDocument/diagnostic' ? { kind: 'full', items: [] } : null });
}

// Schliesst Codium die Verbindung, endet der Server wie ein echter.
process.stdin.on('end', () => process.exit(0));

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf(HEADER_END);
    if (end < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))?.[1] ?? '0');
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
    buffer = buffer.subarray(end + 4 + length);
    handle(JSON.parse(body) as Parameters<typeof handle>[0]);
  }
});
