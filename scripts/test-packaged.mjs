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

// ripgrep liegt ausserhalb des App-Archivs und lässt sich starten (Dateiliste und Suchen, Ticket 08). Der Pfad muss zu
// src/main/ripgrepPath.ts passen.
const ripgrep = path.join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe');
check(existsSync(ripgrep), 'ripgrep liegt ausserhalb des App-Archivs');
if (existsSync(ripgrep)) {
  const version = execFileSync(ripgrep, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  check(/^ripgrep \d+\.\d+/.test(version), `ripgrep startet (${version.split(/\r?\n/)[0]})`);
}
// Das README für „Open README“ liegt ausserhalb des App-Archivs, mit dem Abschnitt „Voraussetzungen“ (Ticket 09).
const readme = path.join(unpacked, 'resources', 'README.md');
check(existsSync(readme), 'das README liegt ausserhalb des App-Archivs');
if (existsSync(readme)) check(/^## Voraussetzungen\s*$/m.test(readFileSync(readme, 'utf8')), 'das README hat den Abschnitt „Voraussetzungen“');
// node-pty liegt ausserhalb des App-Archivs und startet im Paket eine Shell (Terminal, Ticket 11). Geladen wird es wie
// im Hauptprozess über das Archiv; Electron leitet die nativen Teile nach app.asar.unpacked um.
const ptyDir = path.join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
check(existsSync(path.join(ptyDir, 'prebuilds', 'win32-x64', 'pty.node')), 'node-pty liegt ausserhalb des App-Archivs');
if (existsSync(exe)) {
  const probe = [
    `const pty = require(${JSON.stringify(path.join(unpacked, 'resources', 'app.asar', 'node_modules', 'node-pty'))});`,
    `const p = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo CODIUM_PTY_OK'], { cols: 80, rows: 10, useConpty: true, useConptyDll: true });`,
    `let out = ''; p.onData((d) => { out += d; });`,
    `p.onExit(() => { process.stdout.write(out.includes('CODIUM_PTY_OK') ? 'ok' : 'no output: ' + JSON.stringify(out)); process.exit(0); });`,
    `setTimeout(() => { process.stdout.write('timeout'); process.exit(1); }, 20000);`,
  ].join('\n');
  let result;
  try {
    result = execFileSync(exe, ['-e', probe], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
  } catch (err) {
    result = String(err.stdout ?? err.message).trim();
  }
  check(result === 'ok', `node-pty startet im Paket eine Shell (${result})`);
}
// Die mitgelieferten TypeScript-Sprachserver liegen ausserhalb des App-Archivs und starten (Ticket 12): der native
// Server von TypeScript 7 und typescript-language-server mit Electron als Node. Die Pfade passen zu
// src/main/typescriptPaths.ts.
const unpackedModules = path.join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules');
const nativeTsc = path.join(unpacked, 'resources', 'typescript-native', 'tsc.exe');
check(existsSync(nativeTsc), 'der native TypeScript-Server liegt ausserhalb des App-Archivs');
if (existsSync(nativeTsc)) {
  // Er braucht die lib.*.d.ts neben sich (deshalb extraResources statt node_modules).
  let version;
  try {
    version = execFileSync(nativeTsc, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
  } catch (err) {
    version = String(err.stderr ?? err.message).split(/\r?\n/)[0];
  }
  check(/^Version 7\./.test(version), `der native TypeScript-Server startet (${version})`);
}
const tsLanguageServer = path.join(unpackedModules, 'typescript-language-server', 'lib', 'cli.mjs');
check(existsSync(tsLanguageServer), 'typescript-language-server liegt ausserhalb des App-Archivs');
if (existsSync(exe) && existsSync(tsLanguageServer)) {
  let version;
  try {
    version = execFileSync(exe, [tsLanguageServer, '--version'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
  } catch (err) {
    version = String(err.stdout ?? err.message).trim();
  }
  check(/^\d+\.\d+\.\d+$/.test(version), `typescript-language-server startet mit Electron als Node (${version})`);
}
// Was esbuild bündelt (Monaco, Schrift), gehört nicht noch einmal ins Paket.
const bundledTwice = ['monaco-editor', '@fontsource'].filter((name) => existsSync(path.join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', name)));
check(bundledTwice.length === 0, 'Monaco und die Schrift liegen nur gebündelt im Paket');

if (failures.length > 0) {
  console.error(`\n${failures.length} Prüfung(en) am Paket fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen am Paket bestanden.');
