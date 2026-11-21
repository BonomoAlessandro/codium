// „Clone Repository“: klont mit dem installierten Git in einen Zielordner, mit Fortschritt, und räumt nach einem Fehler
// auf. Das Öffnen des Projekts danach übernimmt der App-Kern. Lädt nie Electron.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ErrorCode } from '../../shared/types';
import { gitMessage, runGit } from './gitProcess';
import type { ProgressReporter } from './progress';
import { CommandError } from './router';

export interface CloneOptions {
  git: string;
  url: string;
  /** Absoluter Zielordner; fehlt er, legt Git ihn (samt fehlender Elternordner) an. Leer darf er schon da sein. */
  directory: string;
  env: NodeJS.ProcessEnv;
  progress: ProgressReporter;
}

/**
 * Klont ein Repository. Ein bestehender, nicht leerer Zielordner wird abgelehnt (`FILE_EXISTS`). Scheitert Git, kommt
 * seine Meldung im Wortlaut (`GIT_FAILED`), und was der Klon angelegt hat, wird entfernt: der Zielordner, wenn es ihn
 * vorher nicht gab, sonst sein Inhalt.
 */
export async function cloneRepository({ git, url, directory, env, progress }: CloneOptions): Promise<void> {
  const existedBefore = await assertUsableTarget(directory);
  const name = path.basename(directory);
  const work = progress.begin(`Cloning ${name}…`);
  try {
    const result = await runGit(git, ['clone', '--progress', '--', url, directory], {
      cwd: existingAncestor(directory),
      env,
      onStderrLine: (line) => {
        const fraction = cloneFraction(line);
        if (fraction !== null) work.report({ fraction });
      },
    });
    if (result.code !== 0) {
      await removeClone(directory, existedBefore);
      throw new CommandError(gitMessage(result.stderr) || `git clone failed with exit code ${result.code}.`, ErrorCode.gitFailed);
    }
  } catch (err) {
    if (err instanceof CommandError) throw err;
    await removeClone(directory, existedBefore);
    throw new CommandError(`Git could not be started: ${(err as Error).message}`, ErrorCode.gitFailed);
  } finally {
    work.end();
  }
}

/** Prüft den Zielordner; liefert, ob es ihn schon gab (dann leer). */
async function assertUsableTarget(directory: string): Promise<boolean> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(directory);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || (await fs.promises.readdir(directory)).length > 0) {
    throw new CommandError(`“${directory}” already exists and is not empty.`, ErrorCode.fileExists, { path: directory });
  }
  return true;
}

/** Der nächste vorhandene Ordner über dem Ziel, als Arbeitsordner für Git. */
function existingAncestor(directory: string): string {
  for (let dir = path.dirname(directory); ; dir = path.dirname(dir)) {
    if (fs.existsSync(dir)) return dir;
    if (path.dirname(dir) === dir) return dir;
  }
}

/** Entfernt einen halb angelegten Klon: den Ordner, wenn es ihn vorher nicht gab, sonst nur seinen Inhalt. */
async function removeClone(directory: string, existedBefore: boolean): Promise<void> {
  try {
    if (!existedBefore) {
      await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3 });
      return;
    }
    for (const entry of await fs.promises.readdir(directory)) {
      await fs.promises.rm(path.join(directory, entry), { recursive: true, force: true, maxRetries: 3 });
    }
  } catch {
    // Was sich nicht entfernen lässt (etwa gesperrt), bleibt; die Meldung von Git ist wichtiger.
  }
}

/** Fortschritt aus einer Zeile von `git clone --progress`: Empfangen bis 90 %, Auflösen der Deltas danach. */
export function cloneFraction(line: string): number | null {
  const match = /(Receiving objects|Resolving deltas):\s+(\d+)%/.exec(line);
  if (!match) return null;
  const percent = Number(match[2]) / 100;
  return match[1] === 'Receiving objects' ? percent * 0.9 : 0.9 + percent * 0.1;
}
