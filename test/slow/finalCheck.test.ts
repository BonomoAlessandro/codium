// Langsamer Testlauf (Ticket 27): Auswahl der Schlussprüfung an der echten Prozesstabelle. Zwei harmlose Node-Prozesse
// tragen in ihrer Befehlszeile den typescript-language-server des Checkouts (wie ein Sprachserver im langsamen Lauf);
// einer ist verwaist, der andere hat einen lebenden Elternprozess. Nur der verwaiste wird ausgewählt.

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { killProcesses, listProcesses, listProcessesAsync, strayProcesses } from '../support/processes';

const CHECKOUT = path.resolve(__dirname, '..', '..');
const MARKER = path.join(CHECKOUT, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
/** Läuft, bis er beendet wird; die Datei des Sprachservers steht nur als Argument da und wird nicht ausgeführt. */
const IDLE = ['-e', 'setInterval(() => {}, 60000)', MARKER];

describe('Schlussprüfung an der echten Prozesstabelle (Ticket 27)', () => {
  it('wählt einen verwaisten Prozess aus diesem Checkout, nicht aber einen mit lebendem Elternprozess', async () => {
    // Ein Zwischenprozess startet den späteren Waisen abgekoppelt und endet; der zweite Prozess ist Kind dieses Tests.
    const orphanPid = await new Promise<number>((resolve, reject) => {
      const starter = spawn(
        process.execPath,
        ['-e', `const c = require('node:child_process').spawn(process.execPath, ${JSON.stringify(IDLE)}, { detached: true, stdio: 'ignore', windowsHide: true }); console.log(c.pid); c.unref();`],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let out = '';
      starter.stdout!.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      starter.once('exit', () => (Number(out.trim()) > 0 ? resolve(Number(out.trim())) : reject(new Error(`Keine Prozessnummer: ${out}`))));
    });
    const child = spawn(process.execPath, IDLE, { windowsHide: true, stdio: 'ignore' });
    try {
      await expect
        .poll(async () => (await listProcessesAsync(['node.exe'])).some((p) => p.pid === child.pid), { timeout: 10_000 })
        .toBe(true);
      const stray = strayProcesses(listProcesses(), CHECKOUT).map((p) => p.pid);
      expect(stray).toContain(orphanPid);
      expect(stray).not.toContain(child.pid);
      expect(stray).not.toContain(process.pid);
    } finally {
      child.kill();
      killProcesses([orphanPid]);
    }
  });
});
