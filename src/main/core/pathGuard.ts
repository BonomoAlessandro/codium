// Prüft die Pfade aus Befehlen des Datei-Dienstes: absolut, innerhalb des Projekts und, wo der Befehl die Festplatte
// berührt, vorhanden und auch nach dem Auflösen von `..`, Junctions und symbolischen Links innerhalb des Projekts.
// Die Oberfläche ist eigener Code, aber der Datei-Dienst ist die Stelle, an der Pfade auf die Festplatte treffen
// (Review von Ticket 01). Lädt nie Electron.
//
// Weitergearbeitet wird immer mit dem geprüften, normalisierten Pfad, nie mit dem übergebenen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ErrorCode } from '../../shared/types';
import { isAbsoluteCommandPath, isKeyWithin, lexicalProjectKey, normalizeProjectPath } from './projectPath';
import { CommandError } from './router';

/** Führt einen Dateizugriff aus, etwa über eine Warteschlange mit begrenzt vielen gleichzeitigen Zugriffen. */
export type RunIo = <T>(work: () => Promise<T>) => Promise<T>;

/** Fehlercodes von Node, die heissen: Den Pfad gibt es nicht. */
export function isMissingError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function outsideProject(target: string): CommandError {
  return new CommandError(`The path is outside the project: ${target}`, ErrorCode.pathOutsideProject, { path: target });
}

export function notFound(target: string): CommandError {
  return new CommandError(`Not found: ${target}`, ErrorCode.fileNotFound, { path: target });
}

export function alreadyExists(target: string): CommandError {
  return new CommandError(`“${path.basename(target)}” already exists.`, ErrorCode.fileExists, { path: target });
}

/** Englische Gründe für häufige Fehler des Dateisystems. */
const REASONS: Record<string, string> = {
  EACCES: 'access denied.',
  EPERM: 'access denied, or the file is in use.',
  EBUSY: 'the file is in use.',
  ENOSPC: 'not enough disk space.',
  EROFS: 'the drive is read-only.',
  ENAMETOOLONG: 'the path is too long.',
  ENOTEMPTY: 'the folder is not empty.',
  ENOTDIR: 'a part of the path is not a folder.',
};

/**
 * Ein Fehler des Dateisystems als Fehler des Befehls mit englischer Meldung, etwa „Could not rename “a.txt”: the file
 * is in use.“ `action` ist das Verb dazu.
 */
export function fileError(err: unknown, target: string, action: string): CommandError {
  if (err instanceof CommandError) return err;
  const code = (err as NodeJS.ErrnoException | undefined)?.code ?? '';
  if (code === 'ENOENT') return notFound(target);
  if (code === 'EEXIST' || code === 'ERR_FS_CP_EEXIST') return alreadyExists(target);
  const reason = REASONS[code] ?? `${code || (err as Error).message}.`;
  return new CommandError(`Could not ${action} “${path.basename(target)}”: ${reason}`, ErrorCode.fileOperationFailed, {
    path: target,
    code,
  });
}

export class PathGuard {
  private realRoot: Promise<string> | null = null;
  private readonly rootKey: string;

  constructor(
    /** Normalisierter Projektpfad; alle geprüften Pfade beginnen mit ihm. */
    readonly root: string,
    private readonly io: RunIo,
  ) {
    this.rootKey = lexicalProjectKey(root);
  }

  /** Ob ein geprüfter Pfad der Projektordner selbst ist. */
  isRoot(target: string): boolean {
    return lexicalProjectKey(target) === this.rootKey;
  }

  /**
   * Prüft ohne Dateizugriff: ein absoluter Pfad, der nach dem Auflösen von `.` und `..` im Projekt liegt. Liefert ihn
   * normalisiert (Trenner des Systems, ohne abschliessenden Trenner). Für Befehle, die die Festplatte nicht
   * berühren (etwa das Speichern der aufgeklappten Ordner).
   */
  lexical(value: unknown): string {
    if (!isAbsoluteCommandPath(value)) throw new CommandError('An absolute path is expected.', ErrorCode.invalidParams);
    const normalized = normalizeProjectPath(value);
    if (process.platform === 'win32' && !plainWindowsPath(normalized)) {
      throw new CommandError(`Not a valid path: ${value}`, ErrorCode.invalidParams);
    }
    if (!isKeyWithin(lexicalProjectKey(normalized), this.rootKey)) throw outsideProject(normalized);
    return normalized;
  }

  /**
   * Prüft wie `lexical`, dazu: Den Pfad gibt es, und sein echter Pfad (Junctions, symbolische Links und Kurznamen
   * aufgelöst) liegt im echten Projektordner. Liefert den normalisierten Pfad.
   */
  async existing(value: unknown): Promise<string> {
    const normalized = this.lexical(value);
    let real: string;
    try {
      real = await this.io(() => fs.promises.realpath(normalized));
    } catch (err) {
      if (isMissingError(err)) throw notFound(normalized);
      throw fileError(err, normalized, 'read');
    }
    if (!isKeyWithin(lexicalProjectKey(real), lexicalProjectKey(await this.realRootPath()))) throw outsideProject(normalized);
    return normalized;
  }

  /** Der echte Pfad des Projektordners; einmal gelesen, nach einem Fehler beim nächsten Mal neu. */
  private realRootPath(): Promise<string> {
    if (!this.realRoot) {
      const reading = this.io(() => fs.promises.realpath(this.root));
      this.realRoot = reading;
      reading.catch(() => {
        if (this.realRoot === reading) this.realRoot = null;
      });
    }
    return this.realRoot.catch((err: unknown) => {
      if (isMissingError(err)) throw notFound(this.root);
      throw fileError(err, this.root, 'read');
    });
  }
}

/**
 * Ein gewöhnlicher Windows-Pfad: kein Gerätepfad (`\\?\`, `\\.\`), kein Doppelpunkt nach dem Laufwerk (alternative
 * Datenströme) und kein Teil, der auf Punkt oder Leerzeichen endet. Windows entfernt solche Punkte und Leerzeichen
 * stillschweigend; aus „.. “ würde so „..“.
 */
function plainWindowsPath(normalized: string): boolean {
  if (/^\\\\[?.]\\/.test(normalized)) return false;
  if (normalized.indexOf(':', 2) !== -1) return false;
  return normalized
    .split(/[\\/]/)
    .slice(1)
    .every((segment) => !/[. ]$/.test(segment));
}
