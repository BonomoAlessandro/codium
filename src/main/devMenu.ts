// Menü der Entwicklungsversion (npm start): Neu laden, Entwicklerwerkzeuge und Vollbild.
// Die installierte App hat kein Menü.

import type { MenuItemConstructorOptions } from 'electron';

export const DEV_MENU: MenuItemConstructorOptions[] = [
  {
    label: 'Entwicklung',
    submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
  },
];
