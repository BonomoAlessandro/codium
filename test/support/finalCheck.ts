// Schlussprüfung je Testlauf (Ticket 27), als `globalSetup` aller drei Vitest-Läufe. Nach dem letzten Test beendet sie
// verwaiste Prozesse aus diesem Checkout (Codium-Testinstanzen und ihre Hilfsprozesse, PostgreSQL aus
// embedded-postgres, Sprachserver, jdtls und Gradle-Daemons des Test-Zwischenspeichers) und entfernt liegengebliebene
// Temp-Ordner dieses Laufs, jeweils mit deutlicher Meldung. Prozesse mit lebendem Elternprozess, Prozesse aus anderen
// Ordnern und das installierte Codium fasst sie nie an (Auswahl in processes.ts). Läuft gleichzeitig ein anderer
// Testlauf in diesem Checkout, meldet sie verwaiste Prozesse nur (`planStrayCleanup`).

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { killProcesses, listProcesses, planStrayCleanup, type ProcessInfo } from './processes';
import { RUN_ENV } from './testRun';

const CHECKOUT = path.resolve(__dirname, '..', '..');

export default function setup(): () => void {
  const run = randomBytes(4).toString('hex');
  process.env[RUN_ENV] = run;
  return () => finalCheck(run);
}

/** Die Temp-Ordner eines Laufs unter `root`: `codium-<Art>-<Lauf>-…` (siehe testRun.ts). */
export function leftoverTempDirs(root: string, run: string): string[] {
  if (!/^[0-9a-f]+$/.test(run)) throw new Error(`Ungültige Kennung des Testlaufs: ${run}`);
  const pattern = new RegExp(`^codium-[a-z]+-${run}-`);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => path.join(root, entry.name));
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function describe(p: ProcessInfo): string {
  const cmd = p.cmd.length > 240 ? `${p.cmd.slice(0, 240)}…` : p.cmd;
  return `  ${p.name} (PID ${p.pid}, Elternprozess ${p.ppid}): ${cmd || p.exe}`;
}

/** Löscht einen Ordner; hält Windows noch Dateien darin (EPERM, EBUSY), mit einigen Versuchen. */
function removeWithRetries(dir: string): Error | undefined {
  let last: Error | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return undefined;
    } catch (err) {
      last = err as Error;
      sleep(500);
    }
  }
  return last;
}

export function finalCheck(run: string): void {
  if (process.platform !== 'win32') return;
  const plan = planStrayCleanup(listProcesses(), CHECKOUT, process.pid);
  if (plan.kill.length > 0) {
    console.warn(`\nSchlussprüfung: verwaiste Prozesse aus diesem Checkout (Elternprozess beendet), samt Nachkommen; sie werden beendet:\n${plan.kill.map(describe).join('\n')}`);
    killProcesses(plan.kill.map((p) => p.pid));
  }
  if (plan.reportOnly.length > 0) {
    const others = plan.otherRuns.map((p) => `PID ${p.pid}`).join(', ');
    console.warn(
      `\nSchlussprüfung: verwaiste Prozesse aus diesem Checkout, samt Nachkommen; nicht beendet, weil gleichzeitig ein anderer Testlauf in diesem Checkout läuft (${others}):\n${plan.reportOnly.map(describe).join('\n')}`,
    );
  }

  const dirs = leftoverTempDirs(os.tmpdir(), run);
  if (dirs.length === 0) return;
  const failed = dirs.map((dir) => ({ dir, error: removeWithRetries(dir) })).filter((r) => r.error);
  console.warn(`\nSchlussprüfung: ${dirs.length} liegengebliebene Temp-Ordner dieses Laufs entfernt${failed.length > 0 ? `, ${failed.length} davon nicht` : ''}:\n${dirs.map((d) => `  ${d}`).join('\n')}`);
  for (const { dir, error } of failed) console.warn(`Schlussprüfung: ${dir} liess sich nicht entfernen: ${error!.message}`);
}
