// Prozesstabelle von Windows für Testhilfen (Ticket 27): Abfrage, Herkunft aus diesem Checkout, verwaiste Prozesse.
// Auch der Wächter des Test-PostgreSQL lädt dieses Modul, und den startet Node direkt (ohne Vitest). Deshalb nur
// Node-Module, nur Typangaben, die Node beim Laden entfernen kann, und relative Importe mit Endung `.ts`.

import { execFile, execFileSync } from 'node:child_process';
import { descendantsIn, type ProcessEntry } from '../../src/main/core/processTree.ts';

/** Was einen Prozess eindeutig macht: Nummer und Startzeit (Windows vergibt Nummern neu). */
export type ProcessIdentity = Pick<ProcessEntry, 'pid' | 'created'>;

export interface ProcessInfo extends ProcessEntry {
  name: string;
  /** Pfad des Programms; leer, wenn Windows ihn nicht nennt (Systemprozesse, fremde Rechte). */
  exe: string;
  /** Befehlszeile; leer, wenn Windows sie nicht nennt. */
  cmd: string;
}

/** PowerShell-Abfrage der Prozesstabelle als JSON, auf Wunsch nur Prozesse mit diesen Programmnamen. */
function query(names: readonly string[]): string {
  for (const name of names) if (!/^[\w.-]+$/.test(name)) throw new Error(`Ungültiger Programmname: ${name}`);
  const filter = names.length > 0 ? ` -Filter "${names.map((n) => `Name='${n}'`).join(' OR ')}"` : '';
  return [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$rows = @(Get-CimInstance Win32_Process${filter} | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; exe = $_.ExecutablePath; cmd = $_.CommandLine; created = $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }) } })`,
    'ConvertTo-Json -InputObject $rows -Compress -Depth 2',
  ].join('; ');
}

function parse(json: string): ProcessInfo[] {
  const rows = JSON.parse(json.trim() || '[]') as Array<Partial<Record<keyof ProcessInfo, unknown>>>;
  return rows.map((r) => ({
    pid: Number(r.pid),
    ppid: Number(r.ppid),
    created: Number(r.created),
    name: String(r.name ?? ''),
    exe: typeof r.exe === 'string' ? r.exe : '',
    cmd: typeof r.cmd === 'string' ? r.cmd : '',
  }));
}

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];

/** Die laufenden Prozesse, auf Wunsch nur die mit diesen Programmnamen (etwa `postgres.exe`). Nur lesend. */
export function listProcesses(names: readonly string[] = []): ProcessInfo[] {
  if (process.platform !== 'win32') throw new Error('Die Prozesstabelle gibt es hier nur unter Windows.');
  const out = execFileSync('powershell.exe', [...POWERSHELL_ARGS, query(names)], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return parse(out);
}

/** Wie `listProcesses`, ohne den Prozess währenddessen anzuhalten. */
export function listProcessesAsync(names: readonly string[] = []): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Die Prozesstabelle gibt es hier nur unter Windows.'));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [...POWERSHELL_ARGS, query(names)], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) reject(err);
      else resolve(parse(out));
    });
  });
}

/** Ob ein Prozess noch läuft: dieselbe Nummer mit derselben Startzeit (eine neu vergebene Nummer zählt nicht). */
export function stillRunning(p: ProcessIdentity, table: readonly ProcessIdentity[]): boolean {
  return table.some((q) => q.pid === p.pid && q.created === p.created);
}

/**
 * Ob der Elternprozess eines Prozesses nicht mehr läuft. Trägt inzwischen ein jüngerer Prozess die Nummer des
 * Elternprozesses, ist der echte fort.
 */
export function isOrphan(p: ProcessEntry, table: readonly ProcessEntry[]): boolean {
  const parent = table.find((q) => q.pid === p.ppid);
  return parent === undefined || parent.created > p.created;
}

function normalized(file: string): string {
  return file.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Das Programm eines Prozesses: der Pfad, den Windows nennt, sonst der erste Teil der Befehlszeile. Für die Kindprozesse
 * von PostgreSQL nennt Windows keinen Pfad, ihre Befehlszeile beginnt aber mit dem Programm (Ticket 27: ein verwaister
 * „io_worker“ fiel deshalb durch die Schlussprüfung).
 */
export function programOf(p: Pick<ProcessInfo, 'exe' | 'cmd'>): string {
  if (p.exe) return p.exe;
  const cmd = p.cmd.trimStart();
  if (cmd.startsWith('"')) {
    const end = cmd.indexOf('"', 1);
    return end > 0 ? cmd.slice(1, end) : '';
  }
  return cmd.split(/\s+/)[0] ?? '';
}

/**
 * Ob ein Prozess aus diesem Checkout stammt: Sein Programm liegt darin (Electron und damit die Codium-Testinstanzen,
 * PostgreSQL aus embedded-postgres, ripgrep, die native TypeScript-Version, die ConPTY von node-pty), oder seine
 * Befehlszeile startet typescript-language-server aus dem Checkout (mit Node, im langsamen Lauf) oder Java mit den
 * Java-Werkzeugen bzw. dem Test-Zwischenspeicher des Checkouts (jdtls, Gradle-Daemons). Das installierte Codium und
 * seine Sprachserver liegen woanders.
 */
export function fromCheckout(p: ProcessInfo, checkoutRoot: string): boolean {
  const root = `${normalized(checkoutRoot)}\\`;
  const program = programOf(p);
  if (program && normalized(program).startsWith(root)) return true;
  const cmd = p.cmd.replace(/\//g, '\\').toLowerCase();
  if (cmd.includes(`${root}node_modules\\typescript-language-server\\`)) return true;
  return /^java(w)?\.exe$/i.test(p.name) && (cmd.includes(`${root}.cache\\java-tools\\`) || cmd.includes(`${root}.test-cache\\`));
}

/** Verwaiste Prozesse aus diesem Checkout: Ihr Elternprozess läuft nicht mehr. Nie einer mit lebendem Elternprozess. */
export function strayProcesses(table: readonly ProcessInfo[], checkoutRoot: string): ProcessInfo[] {
  return table.filter((p) => fromCheckout(p, checkoutRoot) && isOrphan(p, table));
}

/** Die Prozesse samt ihren Nachkommen (siehe `descendantsIn`), jeder einmal. */
export function withDescendants<T extends ProcessEntry>(table: readonly T[], roots: readonly T[]): T[] {
  const all = [...roots, ...descendantsIn(table, roots)];
  return all.filter((p, i) => all.findIndex((q) => q.pid === p.pid) === i);
}

/** Beendet Prozesse hart, einzeln nach Nummer (ohne `/T`, siehe `descendantsIn`). Schon beendete stören nicht. */
export function killProcesses(pids: readonly number[]): void {
  for (let i = 0; i < pids.length; i += 50) {
    const chunk = pids.slice(i, i + 50);
    try {
      execFileSync('taskkill.exe', ['/F', ...chunk.flatMap((pid) => ['/PID', String(pid)])], { stdio: 'ignore', windowsHide: true });
    } catch {
      // Einzelne waren schon beendet; taskkill meldet das mit einem Fehlercode, die übrigen sind trotzdem beendet.
    }
  }
}
