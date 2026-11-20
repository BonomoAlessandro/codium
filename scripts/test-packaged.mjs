// Prüfungen am gepackten Paket (release/win-unpacked), ohne Fenster. Läuft nach `electron-builder --dir`
// (npm run test:packaged). Spätere Tickets ergänzen Prüfungen für mitgelieferte Programme.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const failures = [];

function check(condition, message) {
  console.log(`${condition ? 'ok  ' : 'FEHL'} ${message}`);
  if (!condition) failures.push(message);
}

const exe = path.join(unpacked, 'Codium.exe');
check(existsSync(exe), 'Codium.exe ist im Paket');
check(existsSync(path.join(unpacked, 'resources', 'app.asar')), 'die App liegt als app.asar im Paket');

if (existsSync(exe)) {
  // Ohne Fenster: Electron läuft als Node und meldet nur seine Version.
  const expected = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  // Der erste Start einer frisch gebauten, unsignierten exe kann lange dauern, weil Windows sie zuerst prüft.
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
