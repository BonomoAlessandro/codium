// Test-Zwischenspeicher: ein von Git ausgenommener Ordner im Projekt für Dinge, die zwischen Testläufen bleiben
// dürfen und teuer zu beschaffen sind (etwa ein lokales Maven-Repository oder Gradle-Verteilungen, Ticket 14).

import * as fs from 'node:fs';
import * as path from 'node:path';

const CACHE_ROOT = path.resolve(__dirname, '..', '..', '.test-cache');

/** Liefert einen Unterordner des Test-Zwischenspeichers und legt ihn bei Bedarf an. */
export function testCacheDir(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Ungültiger Name für den Test-Zwischenspeicher: ${name}`);
  const dir = path.join(CACHE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
