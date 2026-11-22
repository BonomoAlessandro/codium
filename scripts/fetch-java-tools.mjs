// Beschafft jdtls und Lombok in den festen Versionen aus scripts/java-tools.json (Ticket 14): lädt sie von
// download.eclipse.org bzw. Maven Central nach .cache/java-tools (von Git ausgenommen), prüft die SHA-256-Prüfsumme und
// packt jdtls aus. Ist schon alles da, passiert nichts. `node build.mjs` ruft es auf.
//
// - Weicht eine Prüfsumme ab, bricht es mit Exit-Code 1 ab und behält nichts davon.
// - Ohne Netz meldet es das und endet mit Exit-Code 0: Das Bauen geht weiter, der langsame Testlauf überspringt die
//   Java-Tests mit einer Meldung.
// - `--manifest <datei>` und `--cache <ordner>` für Tests (etwa mit einer absichtlich falschen Prüfsumme).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const manifest = JSON.parse(readFileSync(arg('--manifest') ?? path.join(root, 'scripts', 'java-tools.json'), 'utf8'));
const cache = path.resolve(arg('--cache') ?? path.join(root, '.cache', 'java-tools'));

class ChecksumError extends Error {}

async function sha256(file) {
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Lädt eine Datei in den Zwischenspeicher und prüft sie; liefert ihren Pfad. Eine vorhandene, passende bleibt. */
async function fetchChecked(name, entry) {
  const file = path.join(cache, path.basename(new URL(entry.url).pathname));
  if (existsSync(file) && (await sha256(file)) === entry.sha256) return file;
  mkdirSync(cache, { recursive: true });
  const partial = `${file}.part`;
  console.log(`${name} ${entry.version}: lade ${entry.url}`);
  const response = await fetch(entry.url);
  if (!response.ok || !response.body) throw new Error(`${entry.url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const actual = await sha256(partial);
  if (actual !== entry.sha256) {
    rmSync(partial, { force: true });
    throw new ChecksumError(`${name}: Prüfsumme weicht ab (erwartet ${entry.sha256}, erhalten ${actual}).`);
  }
  renameSync(partial, file);
  return file;
}

try {
  const lombok = await fetchChecked('Lombok', manifest.lombok);
  const lombokTarget = path.join(cache, `lombok-${manifest.lombok.version}.jar`);
  if (!existsSync(lombokTarget)) writeFileSync(lombokTarget, readFileSync(lombok));

  const archive = await fetchChecked('jdtls', manifest.jdtls);
  const jdtls = path.join(cache, `jdtls-${manifest.jdtls.version}`);
  const marker = path.join(jdtls, '.codium-extracted');
  if (!existsSync(marker)) {
    rmSync(jdtls, { recursive: true, force: true });
    mkdirSync(jdtls, { recursive: true });
    // Das tar von Windows (bsdtar, seit Windows 10); ein GNU-tar etwa aus Git Bash läse „C:“ als Rechnernamen.
    const windowsTar = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : null;
    execFileSync(windowsTar && existsSync(windowsTar) ? windowsTar : 'tar', ['-xzf', archive, '-C', jdtls], { stdio: 'inherit' });
    writeFileSync(marker, manifest.jdtls.sha256);
  }
  console.log(`jdtls ${manifest.jdtls.version} und Lombok ${manifest.lombok.version} liegen in ${cache}`);
} catch (err) {
  // Nur fehlendes Netz ist kein Abbruch (fetch scheitert mit TypeError, der Server mit einem HTTP-Fehler).
  const offline = err instanceof TypeError || /HTTP \d+/.test(err.message);
  if (err instanceof ChecksumError || !offline) {
    console.error(err.message);
    process.exit(1);
  }
  // Ohne Netz (oder Server nicht erreichbar): weiterbauen, die Java-Tests überspringen sich.
  console.warn(`jdtls/Lombok nicht beschafft: ${err.message}`);
}
