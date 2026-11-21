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
