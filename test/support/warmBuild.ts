// Liest die frisch gebauten Dateien in dist/ einmal, bevor die Oberflächentests beginnen (Ticket 27, `globalSetup` des
// UI-Laufs). Der Virenscanner hält eine neu geschriebene Datei beim ersten Zugriff fest, bis er sie geprüft hat; für
// dist/renderer/mermaid.js (5 MB) dauerte das gemessen 12 bis 19 s, beim zweiten Lesen wenige Millisekunden. Ohne
// dieses Vorlesen fiel die Wartezeit in den ersten Test, der Mermaid zeichnet, und riss dort sein Zeitlimit von 15 s.

import * as fs from 'node:fs';
import * as path from 'node:path';

const DIST = path.resolve(__dirname, '..', '..', 'dist');

/** Alle Dateien unter einem Ordner. */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

/** Liest jede Datei unter `dir` einmal und liefert die, deren erstes Lesen länger als `slowMs` dauerte. */
export function warmFiles(dir: string, slowMs = 2000): Array<{ file: string; ms: number }> {
  const slow: Array<{ file: string; ms: number }> = [];
  for (const file of filesUnder(dir)) {
    const start = Date.now();
    fs.readFileSync(file);
    const ms = Date.now() - start;
    if (ms > slowMs) slow.push({ file, ms });
  }
  return slow;
}

export default function setup(): void {
  if (!fs.existsSync(DIST)) return;
  for (const { file, ms } of warmFiles(DIST)) {
    console.warn(`Vorlesen der gebauten App: ${path.relative(DIST, file)} brauchte beim ersten Lesen ${(ms / 1000).toFixed(1)} s (Virenscanner).`);
  }
}
