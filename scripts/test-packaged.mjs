// Baut das ungepackte Paket (release/win-unpacked) und prüft es ohne Fenster (npm run test:packaged, nach
// `node build.mjs`). Spätere Tickets ergänzen Prüfungen für mitgelieferte Programme.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const startedAt = Date.now();
const failures = [];

function check(condition, message) {
  console.log(`${condition ? 'ok  ' : 'FEHL'} ${message}`);
  if (!condition) failures.push(message);
}

/**
 * electron-builder hinterlässt bei jedem Lauf leere Ordner `electron-download-*` im Temp-Ordner. Entfernt werden
 * nur leere, die während dieses Laufs entstanden sind.
 */
function removeDownloadLeftovers() {
  const tmp = os.tmpdir();
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith('electron-download-')) continue;
    const dir = path.join(tmp, name);
    try {
      if (statSync(dir).birthtimeMs >= startedAt - 1000 && readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // Nicht unser Ordner oder schon weg.
    }
  }
}

try {
  const builderCli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
  execFileSync(process.execPath, [builderCli, '--win', '--dir'], { cwd: root, stdio: 'inherit' });
} finally {
  removeDownloadLeftovers();
}

const exe = path.join(unpacked, 'Codium.exe');
check(existsSync(exe), 'Codium.exe ist im Paket');
check(existsSync(path.join(unpacked, 'resources', 'app.asar')), 'die App liegt als app.asar im Paket');

if (existsSync(exe)) {
  // Ohne Fenster: Electron läuft als Node und meldet nur seine Version. Der erste Start einer frisch gebauten,
  // unsignierten exe kann lange dauern, weil Windows sie zuerst prüft.
  const expected = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const actual = execFileSync(exe, ['-e', 'process.stdout.write(process.versions.electron)'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  }).trim();
  check(actual === expected, `das Paket startet mit Electron ${expected} (gemeldet: ${actual})`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} Prüfung(en) am Paket fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen am Paket bestanden.');
