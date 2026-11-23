// Baut einen neuen Installer (npm run dist) und zählt dafür die Version hoch: 0.1.0 → 0.2.0 usw., solange Codium bei
// 0.x ist. Die neue Version steht danach in package.json und package-lock.json und gehört committet. Scheitert das
// Bauen, kommt die alte Version zurück, damit keine Nummer verloren geht.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { nextInstallerVersion, replaceVersion } from './version.mjs';

const root = path.resolve(import.meta.dirname, '..');
const files = { package: path.join(root, 'package.json'), lock: path.join(root, 'package-lock.json') };
const original = { package: readFileSync(files.package, 'utf8'), lock: readFileSync(files.lock, 'utf8') };

const from = JSON.parse(original.package).version;
const to = nextInstallerVersion(from);
writeFileSync(files.package, replaceVersion(original.package, from, to, 'package'));
writeFileSync(files.lock, replaceVersion(original.lock, from, to, 'lock'));
console.log(`Version ${from} → ${to}`);

try {
  execFileSync(process.execPath, [path.join(root, 'build.mjs')], { cwd: root, stdio: 'inherit' });
  const builderCli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
  execFileSync(process.execPath, [builderCli, '--win'], { cwd: root, stdio: 'inherit' });
} catch (err) {
  writeFileSync(files.package, original.package);
  writeFileSync(files.lock, original.lock);
  console.error(`\nBauen fehlgeschlagen; die Version bleibt ${from}.`);
  process.exit(typeof err?.status === 'number' && err.status !== 0 ? err.status : 1);
}

console.log(`\nInstaller: release\\Codium Setup ${to}.exe`);
console.log('Die neue Version steht in package.json und package-lock.json; bitte committen.');
