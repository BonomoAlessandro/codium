// Das App-Symbol für die Fenster (Ticket 24), damit Taskleiste und Alt + Tab es auch in der Entwicklungsversion zeigen.
// Im Paket liegt es neben dem App-Archiv (`extraResources`), wie das README, und Windows liest die Datei ohne Umweg über
// das Archiv; unpaketiert kommt es aus assets/icons (erzeugt mit `npm run icons`).

import * as path from 'node:path';

export function appIconPath(appPath: string, isPackaged: boolean, resourcesPath: string): string {
  return isPackaged ? path.join(resourcesPath, 'codium.ico') : path.join(appPath, 'assets', 'icons', 'codium.ico');
}
