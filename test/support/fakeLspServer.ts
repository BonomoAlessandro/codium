// Nachgemachter Sprachserver für Teststelle 1 (Ticket 27). Er verhält sich beim Start wie der native TypeScript-Server
// (tsgo): Kommt vor `initialized` etwas anderes als `initialize`, stürzt er ab (Exit-Code 2; tsgo endet mit einer
// Go-Panic, weil seine Sitzung noch fehlt). Er beantwortet `initialize` nach einer Verzögerung, bietet Fehler zum Abholen
// an und schreibt jede Nachricht in eine Protokolldatei, bei Dateiänderungen mit den Dateinamen.
//
// Umgebung: FAKE_LSP_LOG (Protokolldatei), FAKE_LSP_INIT_DELAY_MS (Verzögerung der Antwort auf `initialize`).
// Node startet die Datei direkt (siehe processes.ts).

import * as fs from 'node:fs';

const log = process.env.FAKE_LSP_LOG ?? '';
const initDelay = Number(process.env.FAKE_LSP_INIT_DELAY_MS ?? '0');
const NL = String.fromCharCode(10);
const HEADER_END = String.fromCharCode(13, 10, 13, 10);

function note(line: string): void {
  if (log) fs.appendFileSync(log, `${process.pid} ${line}${NL}`);
}

function send(message: Record<string, unknown>): void {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_END}`, 'ascii'), body]));
}

let initialized = false;

function handle(message: { id?: number; method?: string; params?: { changes?: Array<{ uri: string }> } }): void {
  if (message.method === undefined) return;
  // Bei Dateiänderungen auch die Dateinamen, in der gemeldeten Reihenfolge.
  const names = message.method === 'workspace/didChangeWatchedFiles' ? (message.params?.changes ?? []).map((c) => c.uri.split('/').pop()).join(',') : '';
  note(names ? `${message.method} ${names}` : message.method);
  if (message.method === 'initialize') {
    setTimeout(() => send({ id: message.id, result: { capabilities: { textDocumentSync: 1, diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } } } }), initDelay);
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
  if (message.id === undefined) return;
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
