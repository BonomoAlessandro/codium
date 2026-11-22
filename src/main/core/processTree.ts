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

/** Alle Nachkommen eines Prozesses (Prozessnummern); leer, wenn die Abfrage scheitert. */
export function descendantsOf(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const query = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const children = new Map<number, number[]>();
      for (const line of out.split(/\r?\n/)) {
        const [id, parent] = line.trim().split(' ').map(Number);
        if (id > 0) children.set(parent, [...(children.get(parent) ?? []), id]);
      }
      const result: number[] = [];
      const queue = [pid];
      while (queue.length > 0) {
        for (const c of children.get(queue.shift()!) ?? []) {
          if (result.includes(c)) continue;
          result.push(c);
          queue.push(c);
        }
      }
      resolve(result);
    });
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
