// Welche Zugriffe die Seiten der Fenster machen dürfen (Review von Ticket 23): nur auf die eigenen Dateien der
// Oberfläche (dist/renderer) und auf `data:`-Adressen. Die Sicherheitsrichtlinie der Seite reicht dafür nicht: Die Seite
// läuft unter `file://`, und dort deckt `'self'` jede `file:`-Adresse ab, auch Dateien ausserhalb des Projekts oder
// UNC-Pfade (`file://server/share`, ein Zugriff über SMB). Lädt nie Electron.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ob die Seite diese Adresse laden darf. `rendererDir` ist der Ordner mit index.html (auch im App-Archiv). */
export function isAllowedPageRequest(url: string, rendererDir: string): boolean {
  if (url.startsWith('data:') || url.startsWith('devtools:')) return true;
  if (!url.startsWith('file:')) return false;
  let file: string;
  try {
    // Ein Host (`file://server/…`) wird zu einem UNC-Pfad und liegt damit nie im Ordner der Oberfläche.
    file = path.resolve(fileURLToPath(url));
  } catch {
    return false;
  }
  const root = path.resolve(rendererDir);
  return file.toLowerCase().startsWith(root.toLowerCase() + path.sep);
}
