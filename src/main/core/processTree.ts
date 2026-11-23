// Beenden eines Prozesses samt seiner Kindprozesse (Git-Klon, Terminal-Shells). Lädt nie Electron.

import { spawn } from 'node:child_process';

/**
 * Beendet einen Prozess samt Kindern und wartet, bis das erledigt ist. Unter Windows trifft `process.kill` nur den
 * Prozess selbst, nicht etwa `git remote-https`, den Credential Manager oder einen Dev-Server aus der Shell; deshalb
 * `taskkill /T /F`.
 */
export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid);
      } catch {
        // Schon beendet.
      }
      resolve();
      return;
    }
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => resolve());
    killer.on('close', () => resolve());
  });
}

/** Die Konsolen-Hosts (conhost.exe), die ein Prozess gestartet hat; leer, wenn die Abfrage scheitert. */
export function consoleHostsOf(parentPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const query = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid} AND Name='conhost.exe'" | ForEach-Object { $_.ProcessId }`;
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(out.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => n > 0)));
  });
}

/** Ein Prozess aus der Prozesstabelle von Windows. */
export interface ProcessEntry {
  pid: number;
  /** Nummer des Elternprozesses, wie Windows sie beim Start festhielt; der Elternprozess kann längst fort sein. */
  ppid: number;
  /** Startzeit in Millisekunden seit 1970. */
  created: number;
}

/**
 * Die Nachkommen der Wurzeln in einer Prozesstabelle, ohne die Wurzeln selbst. Ein Prozess zählt nur als Kind, wenn
 * er nach seinem Elternprozess gestartet wurde: Windows vergibt Prozessnummern neu, und ein älterer Prozess kann noch
 * die Nummer eines längst beendeten Elternprozesses tragen, die inzwischen ein anderer Prozess hat. `taskkill /T`
 * übersieht das und beendet dann auch ihn.
 */
export function descendantsIn<T extends ProcessEntry>(table: readonly T[], roots: readonly T[]): T[] {
  const children = new Map<number, T[]>();
  for (const p of table) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const seen = new Set(roots.map((r) => r.pid));
  const result: T[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of children.get(parent.pid) ?? []) {
      if (seen.has(child.pid) || child.created < parent.created) continue;
      seen.add(child.pid);
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

/** Die Prozesstabelle (Nummer, Elternprozess, Startzeit) und die Nummer der Abfrage selbst; leer, wenn sie scheitert. */
function processTable(): Promise<{ table: ProcessEntry[]; queryPid?: number }> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ table: [] });
      return;
    }
    const query =
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 })" }';
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', () => resolve({ table: [] }));
    child.on('close', () => {
      const table: ProcessEntry[] = [];
      for (const line of out.split(/\r?\n/)) {
        const [pid, ppid, created] = line.trim().split(' ').map(Number);
        if (pid > 0) table.push({ pid, ppid, created });
      }
      resolve({ table, queryPid: child.pid });
    });
  });
}

/** Alle Nachkommen eines Prozesses (Prozessnummern); leer, wenn die Abfrage scheitert. */
export async function descendantsOf(pid: number): Promise<number[]> {
  const { table } = await processTable();
  const root = table.find((p) => p.pid === pid);
  return root ? descendantsIn(table, [root]).map((p) => p.pid) : [];
}

/**
 * Beendet alle Nachkommen eines Prozesses hart, ihn selbst nicht, und wartet darauf. Einzeln nach Nummer statt mit
 * `taskkill /T` (siehe `descendantsIn`); die Abfrage der Prozesstabelle bleibt aussen vor.
 */
export async function killDescendants(pid: number): Promise<void> {
  const { table, queryPid } = await processTable();
  const root = table.find((p) => p.pid === pid);
  if (!root) return;
  const victims = descendantsIn(
    table.filter((p) => p.pid !== queryPid),
    [root],
  ).map((p) => p.pid);
  if (victims.length === 0) return;
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/F', ...victims.flatMap((v) => ['/PID', String(v)])], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => resolve());
    killer.on('close', () => resolve());
  });
}

/** Ob ein Prozess noch läuft. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
