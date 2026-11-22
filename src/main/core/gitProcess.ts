// Aufruf des installierten Git nach den Grundsätzen der Spezifikation („Git“): nie mit einem interaktiven Editor und
// nie mit einer Eingabeaufforderung im Terminal; die Anmeldung läuft über die eingerichteten Helfer (Git Credential
// Manager mit eigenem Fenster, SSH-Agent). Grundlage für das Klonen (Ticket 10) und den Git-Dienst (ab Ticket 15).
// Lädt nie Electron.

import { spawn } from 'node:child_process';
import { killProcessTree } from './processTree';

export interface GitRun {
  code: number | null;
  stdout: string;
  /** Die Ausgabe als Bytes (etwa der Inhalt einer Datei in einem Commit, in ihrer eigenen Kodierung). */
  stdoutBytes: Buffer;
  stderr: string;
}

export interface GitRunOptions {
  cwd: string;
  /** Umgebung für Git; ohne Angabe die des Prozesses. */
  env?: NodeJS.ProcessEnv;
  /** Jede Zeile auf stderr, sobald sie kommt (etwa für Fortschritt); auch mit „\r“ abgeschlossene. */
  onStderrLine?: (line: string) => void;
  /** Eingabe auf stdin (etwa NUL-getrennte Pfade für `--pathspec-from-file=-`); ohne ist stdin zu. */
  input?: string;
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

/** Ein laufender Aufruf von Git, der sich abbrechen lässt. */
export interface GitProcess {
  done: Promise<GitRun>;
  /** Beendet Git samt Kindprozessen (etwa `git remote-https`, den Credential Manager) und wartet darauf. */
  kill(): Promise<void>;
}

/** Führt Git aus und liefert Exit-Code und Ausgaben. Scheitert nur, wenn Git sich nicht starten lässt. */
export function runGit(git: string, args: string[], options: GitRunOptions): Promise<GitRun> {
  return startGit(git, args, options).done;
}

/** Startet Git; `done` wie bei `runGit`, dazu ein Abbruch des ganzen Prozessbaums. */
export function startGit(git: string, args: string[], options: GitRunOptions): GitProcess {
  let pid: number | undefined;
  let finished = false;
  const done = new Promise<GitRun>((resolve, reject) => {
    const child = spawn(git, args, {
      cwd: options.cwd,
      env: gitEnvironment(options.env ?? process.env),
      windowsHide: true,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (options.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input, 'utf8');
    }
    const out: Buffer[] = [];
    let err = '';
    let pending = '';
    child.stdout!.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      err += text;
      if (!options.onStderrLine) return;
      pending += text;
      const parts = pending.split(/\r\n|\r|\n/);
      pending = parts.pop() ?? '';
      for (const line of parts) if (line !== '') options.onStderrLine(line);
    });
    pid = child.pid;
    child.on('error', reject);
    child.on('close', (code) => {
      finished = true;
      if (pending !== '' && options.onStderrLine) options.onStderrLine(pending);
      const bytes = Buffer.concat(out);
      resolve({ code, stdout: bytes.toString('utf8'), stdoutBytes: bytes, stderr: err });
    });
  });
  return {
    done,
    kill: async () => {
      if (finished || pid === undefined) return;
      await killProcessTree(pid);
      await done.catch(() => {});
    },
  };
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
    // Statuszeilen von Fetch, Pull und Push (Ticket 18): Ziel und übertragene Refs; Ablehnungen („! [rejected]“) bleiben.
    .filter((l) => !/^(From|To) \S/.test(l) && !/^(Unpacking|Writing|Delta compression|Auto packing)\b/.test(l))
    .filter((l) => !/^[*+ -]?\s*(\[new [a-z]+\]|\[deleted\]|[0-9a-f]{7,}\.\.\.?[0-9a-f]{7,})\s/.test(l))
    .join('\n');
}
