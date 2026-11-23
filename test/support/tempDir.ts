// Temp-Ordner für Tests, die nach jedem Test wieder verschwinden.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach } from 'vitest';
import { tempPrefix } from './testRun';

const beforeRemoval: Array<() => void | Promise<void>> = [];

/**
 * Meldet eine Arbeit an, die nach jedem Test vor dem Löschen der Temp-Ordner läuft, etwa das Beenden von Kernen,
 * die sonst noch entprellt in einen schon gelöschten Ordner schreiben und ihn dabei neu anlegen.
 */
export function beforeTempDirRemoval(work: () => void | Promise<void>): void {
  beforeRemoval.push(work);
}

/**
 * Liefert eine Funktion, die Temp-Ordner anlegt. Alle so angelegten Ordner werden nach jedem Test gelöscht.
 * Im Modul oder in einem `describe` aufrufen, nicht im Test selbst.
 */
export function useTempDirs(): (prefix?: string) => string {
  const created: string[] = [];
  afterEach(async () => {
    for (const work of beforeRemoval) await work();
    for (const dir of created.splice(0)) removeDir(dir);
  });
  // Der Name trägt die Kennung des Testlaufs; bleibt ein Ordner liegen, entfernt ihn die Schlussprüfung (finalCheck.ts).
  return (prefix = tempPrefix('test')) => {
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
