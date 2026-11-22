// Wo jdtls und Lombok liegen (Ticket 14): beim Entwickeln im Zwischenspeicher von scripts/fetch-java-tools.mjs
// (`.cache/java-tools`), im gebauten Paket ausserhalb des App-Archivs unter `resources/jdtls` und
// `resources/lombok.jar` (`extraResources` in package.json). Lädt nie Electron; auch die Tests nutzen es.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BundledJava } from './core/language/javaServer';

/** jdtls und Lombok; `null`, wenn sie fehlen (etwa ohne Netz beim Bauen). */
export function javaTools(appPath: string, packaged: boolean): BundledJava | null {
  if (packaged) {
    const resources = path.dirname(appPath);
    const tools = { jdtls: path.join(resources, 'jdtls'), lombok: path.join(resources, 'lombok.jar') };
    return fs.existsSync(tools.jdtls) && fs.existsSync(tools.lombok) ? tools : null;
  }
  // Feste Namen ohne Version (scripts/fetch-java-tools.mjs); fertig ausgepackt erst mit dem Stempel.
  const cache = path.join(appPath, '.cache', 'java-tools');
  const tools = { jdtls: path.join(cache, 'jdtls'), lombok: path.join(cache, 'lombok.jar') };
  return fs.existsSync(path.join(tools.jdtls, '.codium-extracted')) && fs.existsSync(tools.lombok) ? tools : null;
}
