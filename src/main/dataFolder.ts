// Datenordner der App. Lädt nie Electron, damit die Tests ihn ohne Fenster prüfen können.

import * as path from 'node:path';

/**
 * Datenordner unter `appData` (%APPDATA%): `Codium`, unpaketiert (`npm start`) `Codium-dev`, damit die
 * Entwicklung eine installierte App nie berührt.
 */
export function dataFolder(appData: string, packaged: boolean): string {
  return path.join(appData, packaged ? 'Codium' : 'Codium-dev');
}
