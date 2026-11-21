// „Clone Repository“: klont mit dem installierten Git in einen Zielordner, mit Fortschritt; das Öffnen des Projekts
// danach übernimmt der App-Kern. Lädt nie Electron.
//
// Aufräumen nach einem Fehler oder Abbruch (Review von Ticket 10): Codium legt den Zielordner und fehlende Elternordner
// selbst an und entfernt bei einem Fehler nur, was dieser Aufruf nachweislich angelegt hat. Einen Ordner, den es vorher
// gab (leer) oder den ein anderer Vorgang angelegt hat, rührt es nicht an; was Git darin anlegt, räumt Git selbst weg.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ErrorCode } from '../../shared/types';
import { gitMessage, startGit, type GitProcess } from './gitProcess';
import type { ProgressReporter } from './progress';
import { CommandError } from './router';

export interface CloneOptions {
  git: string;
  url: string;
  /** Absoluter Zielordner; fehlt er, legt der Klon ihn (samt fehlender Elternordner) an. Leer darf er schon da sein. */
  directory: string;
  env: NodeJS.ProcessEnv;
  progress: ProgressReporter;
}

/** Ein laufender Klon. */
export interface CloneJob {
  done: Promise<void>;
  /** Bricht den Klon ab (beendet Git samt Kindprozessen) und wartet, bis aufgeräumt ist. */
  cancel(): Promise<void>;
}

/**
 * Startet einen Klon. Ein bestehender, nicht leerer Zielordner oder eine Datei dort wird abgelehnt (`FILE_EXISTS`).
 * Scheitert Git, kommt seine Meldung im Wortlaut (`GIT_FAILED`); nach einem Abbruch „Cloning was cancelled.“
 */
export function startClone(options: CloneOptions): CloneJob {
  let process: GitProcess | null = null;
  let cancelled = false;
  const done = (async () => {
    const created = await prepareTarget(options.directory);
    const work = options.progress.begin(`Cloning ${path.basename(options.directory)}…`);
    try {
      if (cancelled) throw cancelledError();
      process = startGit(options.git, ['clone', '--progress', '--', options.url, options.directory], {
        cwd: path.dirname(options.directory),
        env: options.env,
        onStderrLine: (line) => {
          const fraction = cloneFraction(line);
          if (fraction !== null) work.report({ fraction });
        },
      });
      let result;
      try {
        result = await process.done;
      } catch (err) {
        throw new CommandError(`Git could not be started: ${(err as Error).message}`, ErrorCode.gitFailed);
      }
      if (cancelled) throw cancelledError();
      if (result.code !== 0) {
        throw new CommandError(gitMessage(result.stderr) || `git clone failed with exit code ${result.code}.`, ErrorCode.gitFailed);
      }
    } catch (err) {
      await removeCreated(created);
      throw err;
    } finally {
      work.end();
    }
  })();
  return {
    done,
    cancel: async () => {
      cancelled = true;
      await process?.kill();
      await done.catch(() => {});
    },
  };
}

const cancelledError = () => new CommandError('Cloning was cancelled.', ErrorCode.gitFailed);

/**
 * Prüft den Zielordner und legt fehlt er ihn samt Elternordnern an. Liefert die Ordner, die dieser Aufruf angelegt hat,
 * vom innersten nach aussen. Der Zielordner selbst entsteht mit `mkdir` ohne `recursive`: Legt ihn gleichzeitig ein
 * anderer Vorgang an, gehört er diesem.
 */
async function prepareTarget(directory: string): Promise<string[]> {
  const stat = await fs.promises.stat(directory).catch(() => null);
  if (stat) {
    if (!stat.isDirectory()) throw new CommandError(`“${directory}” exists and is not a folder.`, ErrorCode.fileExists, { path: directory });
    if ((await fs.promises.readdir(directory)).length > 0) {
      throw new CommandError(`“${directory}” already exists and is not empty.`, ErrorCode.fileExists, { path: directory });
    }
    return [];
  }
  const created: string[] = [];
  const missing: string[] = [];
  for (let dir = path.dirname(directory); !fs.existsSync(dir) && path.dirname(dir) !== dir; dir = path.dirname(dir)) missing.unshift(dir);
  try {
    for (const dir of [...missing, directory]) {
      await fs.promises.mkdir(dir);
      created.unshift(dir);
    }
  } catch (err) {
    await removeCreated(created);
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CommandError(`“${directory}” already exists.`, ErrorCode.fileExists, { path: directory });
    }
    throw new CommandError(`Could not create “${directory}”: ${(err as Error).message}`, ErrorCode.fileOperationFailed, { path: directory });
  }
  return created;
}

/**
 * Entfernt Ordner, die der Klon angelegt hat, vom innersten nach aussen. Den Zielordner samt dem, was Git darin
 * angelegt hat; Elternordner nur, solange sie leer sind.
 */
async function removeCreated(created: readonly string[]): Promise<void> {
  for (const [i, dir] of created.entries()) {
    try {
      if (i === 0) await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      else await fs.promises.rmdir(dir);
    } catch {
      // Nicht leer oder gesperrt: bleibt stehen; die Meldung von Git ist wichtiger.
      return;
    }
  }
}

/** Fortschritt aus einer Zeile von `git clone --progress`: Empfangen bis 90 %, Auflösen der Deltas danach. */
export function cloneFraction(line: string): number | null {
  const match = /(Receiving objects|Resolving deltas):\s+(\d+)%/.exec(line);
  if (!match) return null;
  const percent = Number(match[2]) / 100;
  return match[1] === 'Receiving objects' ? percent * 0.9 : 0.9 + percent * 0.1;
}
