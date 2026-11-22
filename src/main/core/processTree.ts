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
