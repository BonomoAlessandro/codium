// Wo ripgrep liegt: im npm-Paket, das VS Code verwendet (@vscode/ripgrep mit dem Paket für Windows x64). Im gebauten
// Paket ausserhalb des App-Archivs (`app.asar.unpacked`, siehe `build.asarUnpack` in package.json), damit es sich
// starten lässt. Lädt nie Electron; auch die Tests und das Prüfskript für das Paket nutzen es.

import * as path from 'node:path';

/** Pfad von ripgrep relativ zum App-Ordner. */
export const RIPGREP_RELATIVE = path.join('node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe');

/**
 * Der Pfad zu ripgrep. `appPath` ist der App-Ordner: unpaketiert das Projekt, gepackt `resources/app.asar`, dessen
 * entpackte Teile daneben unter `app.asar.unpacked` liegen.
 */
export function ripgrepPath(appPath: string, packaged: boolean): string {
  return path.join(packaged ? `${appPath}.unpacked` : appPath, RIPGREP_RELATIVE);
}
