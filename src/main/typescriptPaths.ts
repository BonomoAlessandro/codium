// Wo die mitgelieferten TypeScript-Sprachserver liegen (Ticket 12): der native Server von TypeScript 7 im Plattformpaket
// und typescript-language-server, im gebauten Paket ausserhalb des App-Archivs (`app.asar.unpacked`, siehe
// `build.asarUnpack` in package.json). typescript-language-server läuft mit der Node-Laufzeit von Electron. Lädt nie
// Electron; auch die Tests und das Prüfskript für das Paket nutzen es.

import * as path from 'node:path';
import type { BundledTypeScript } from './core/language/typescriptServer';

export const NATIVE_TSC_RELATIVE = path.join('node_modules', '@typescript', 'typescript-win32-x64', 'lib', 'tsc.exe');
export const TS_LANGUAGE_SERVER_RELATIVE = path.join('node_modules', 'typescript-language-server', 'lib', 'cli.mjs');

/**
 * Die mitgelieferten Server. `appPath` wie bei `ripgrepPath`; `node` ist die Laufzeit für typescript-language-server:
 * im Betrieb Electron als Node, im Test Node selbst (ohne Zusatz).
 */
export function bundledTypeScript(appPath: string, packaged: boolean, node: BundledTypeScript['node']): BundledTypeScript {
  const base = packaged ? `${appPath}.unpacked` : appPath;
  return {
    nativeTsc: path.join(base, NATIVE_TSC_RELATIVE),
    languageServerCli: path.join(base, TS_LANGUAGE_SERVER_RELATIVE),
    node,
  };
}
