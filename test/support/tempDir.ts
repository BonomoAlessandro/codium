// Temp-Ordner für Tests, die nach jedem Test wieder verschwinden.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach } from 'vitest';

/**
 * Liefert eine Funktion, die Temp-Ordner anlegt. Alle so angelegten Ordner werden nach jedem Test gelöscht.
 * Im Modul oder in einem `describe` aufrufen, nicht im Test selbst.
 */
export function useTempDirs(): (prefix?: string) => string {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) removeDir(dir);
  });
  return (prefix = 'codium-test-') => {
    // realpath: Unter Windows kann os.tmpdir() einen kurzen 8.3-Namen liefern (ALESSA~1); Pfadvergleiche in
    // den Tests sollen mit der langen Form arbeiten, die auch Git und Node zurückgeben.
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    created.push(dir);
    return dir;
  };
}

/** Löscht einen Ordner; unter Windows mit Wiederholungen, falls ein Prozess eine Datei noch kurz hält. */
export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
