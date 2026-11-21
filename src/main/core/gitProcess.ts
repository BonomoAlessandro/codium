// Aufruf des installierten Git nach den Grundsätzen der Spezifikation („Git“): nie mit einem interaktiven Editor und
// nie mit einer Eingabeaufforderung im Terminal; die Anmeldung läuft über die eingerichteten Helfer (Git Credential
// Manager mit eigenem Fenster, SSH-Agent). Grundlage für das Klonen (Ticket 10) und den Git-Dienst (ab Ticket 15).
// Lädt nie Electron.

import { spawn } from 'node:child_process';

export interface GitRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface GitRunOptions {
  cwd: string;
  /** Umgebung für Git; ohne Angabe die des Prozesses. */
  env?: NodeJS.ProcessEnv;
  /** Jede Zeile auf stderr, sobald sie kommt (etwa für Fortschritt); auch mit „\r“ abgeschlossene. */
  onStderrLine?: (line: string) => void;
}

/** Die Umgebung für jeden Aufruf: kein Editor, keine Eingabeaufforderung im Terminal, englische Meldungen nicht erzwungen. */
export function gitEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    // Ein Editor, der nichts tut: `true` aus der Shell von Git für Windows.
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    // Keine Fragen nach Benutzername oder Passwort im Terminal; der Credential Manager zeigt sein eigenes Fenster.
    // SSH bekommt kein Terminal (stdin ist zu) und fragt deshalb nicht; eine eigene SSH-Einstellung des Nutzers
    // (`core.sshCommand`) bleibt unberührt.
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** Führt Git aus und liefert Exit-Code und Ausgaben. Scheitert nur, wenn Git sich nicht starten lässt. */
export function runGit(git: string, args: string[], options: GitRunOptions): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(git, args, {
      cwd: options.cwd,
      env: gitEnvironment(options.env ?? process.env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let err = '';
    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      err += text;
      if (!options.onStderrLine) return;
      pending += text;
      const parts = pending.split(/\r\n|\r|\n/);
      pending = parts.pop() ?? '';
      for (const line of parts) if (line !== '') options.onStderrLine(line);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (pending !== '' && options.onStderrLine) options.onStderrLine(pending);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: err });
    });
  });
}

/**
 * Die Meldung von Git für die Oberfläche, im Wortlaut: die Zeilen auf stderr ohne Fortschrittszeilen
 * („Receiving objects: 45% …“) und ohne „Cloning into …“.
 */
export function gitMessage(stderr: string): string {
  return stderr
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^(remote: )?(Counting|Compressing|Receiving|Resolving|Enumerating|Total|Updating files)\b/.test(l))
    .filter((l) => !/^Cloning into /.test(l))
    .join('\n');
}
