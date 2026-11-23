// Erzeugt die App-Symbole aus der SVG-Quelle des Logos (Ticket 24): `npm run icons`.
//
// Quelle:   assets/logo/codium.svg (Hauptfassung) und assets/logo/codium-16.svg (vereinfacht für kleine Grössen)
// Ergebnis: assets/icons/codium.ico (16 bis 256 px) und assets/icons/png/codium-<grösse>.png (16 bis 512 px)
//
// Gerastert wird mit resvg (@resvg/resvg-js), den ICO-Container schreibt scripts/iconFormat.mjs. Zweimal ausgeführt
// entstehen byte-gleiche Dateien; ein Einheitstest vergleicht die eingecheckten Dateien mit einer frischen Erzeugung.
// Nach einer Änderung an der Quelle: `npm run icons` und die geänderten Dateien committen.

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeIco } from './iconFormat.mjs';

/** Grössen im ICO: was Windows für Explorer, Taskleiste, Alt + Tab und Verknüpfungen bei 100 % bis 200 % braucht. */
export const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
/** Grössen der einzelnen PNG-Dateien. */
export const PNG_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512];
/** Bis zu dieser Grösse stammt das Bild aus der 16-px-Fassung: dickerer Ring, schärfer als die verkleinerte Hauptfassung. */
export const SMALL_SOURCE_MAX = 24;

export const LOGO_FILE = 'assets/logo/codium.svg';
export const LOGO_SMALL_FILE = 'assets/logo/codium-16.svg';
export const ICO_FILE = 'assets/icons/codium.ico';
export const PNG_DIR = 'assets/icons/png';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Rastert ein SVG quadratisch auf `size` Pixel: PNG und RGBA mit geradem Alpha. */
export function rasterize(svg, size) {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render();
  if (image.width !== size || image.height !== size) throw new Error(`Logo ist nicht quadratisch: ${image.width}×${image.height}`);
  return { size, png: image.asPng(), rgba: unpremultiply(image.pixels) };
}

/** resvg liefert vormultipliziertes RGBA; ICO-Bitmaps erwarten gerades Alpha. */
function unpremultiply(pixels) {
  const out = Buffer.from(pixels);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) out.fill(0, i, i + 3);
    else if (a < 255) for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round((out[i + c] * 255) / a));
  }
  return out;
}

/**
 * Erzeugt alle Symbole im Speicher: Schlüssel ist der Pfad relativ zum Projekt (mit `/`), Wert der Inhalt.
 * @param {string} [root] Projektordner mit assets/logo
 */
export function buildIcons(root = ROOT) {
  const main = readFileSync(path.join(root, LOGO_FILE), 'utf8');
  const small = readFileSync(path.join(root, LOGO_SMALL_FILE), 'utf8');
  const sizes = [...new Set([...ICO_SIZES, ...PNG_SIZES])].sort((a, b) => a - b);
  const images = new Map(sizes.map((size) => [size, rasterize(size <= SMALL_SOURCE_MAX ? small : main, size)]));
  const files = new Map();
  files.set(ICO_FILE, encodeIco(ICO_SIZES.map((size) => images.get(size))));
  for (const size of PNG_SIZES) files.set(`${PNG_DIR}/codium-${size}.png`, images.get(size).png);
  return files;
}

/** Schreibt die Symbole; alte PNG-Dateien, die nicht mehr dazugehören, verschwinden. */
export function writeIcons(root = ROOT) {
  const files = buildIcons(root);
  rmSync(path.join(root, PNG_DIR), { recursive: true, force: true });
  for (const [file, content] of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = writeIcons();
  for (const [file, content] of files) console.log(`${file} (${content.length} Bytes)`);
  console.log(`${readdirSync(path.join(ROOT, PNG_DIR)).length} PNG-Dateien und ${ICO_FILE} erzeugt.`);
}
