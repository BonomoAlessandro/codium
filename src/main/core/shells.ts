// Die Shells fürs Terminal (Ticket 11): PowerShell 7, Windows PowerShell, cmd und Git Bash, über den Port „System“
// gesucht. Standard ist PowerShell 7, sonst Windows PowerShell. Lädt nie Electron und kein node-pty.

import * as path from 'node:path';
import type { ShellId, ShellInfo } from '../../shared/types';
import type { SystemPort } from './ports';

/** Reihenfolge in der Auswahl und beim Standard. */
const ORDER: readonly ShellId[] = ['pwsh', 'powershell', 'cmd', 'gitbash'];

const NAMES: Record<ShellId, string> = {
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'cmd',
  gitbash: 'Git Bash',
};

/** Die gefundenen Shells in fester Reihenfolge. */
export function detectShells(system: SystemPort): ShellInfo[] {
  const systemRoot = system.getEnv('SystemRoot') ?? system.getEnv('windir') ?? 'C:\\Windows';
  const programFiles = [system.getEnv('ProgramFiles'), system.getEnv('ProgramW6432')].filter((p): p is string => !!p);
  const first = (...candidates: Array<string | null | undefined>): string | null =>
    candidates.find((c): c is string => typeof c === 'string' && c !== '' && system.exists(c)) ?? null;

  const found: Partial<Record<ShellId, string>> = {
    pwsh: first(system.findProgram('pwsh.exe'), ...programFiles.map((p) => path.join(p, 'PowerShell', '7', 'pwsh.exe'))) ?? undefined,
    powershell:
      first(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), system.findProgram('powershell.exe')) ??
      undefined,
    cmd: first(system.getEnv('ComSpec'), path.join(systemRoot, 'System32', 'cmd.exe')) ?? undefined,
    gitbash: gitBash(system, programFiles) ?? undefined,
  };
  return ORDER.filter((id) => found[id] !== undefined).map((id) => ({ id, name: NAMES[id], path: found[id]! }));
}

/**
 * Git Bash neben dem gefundenen Git (`<Git>\cmd\git.exe` oder `<Git>\bin\git.exe` → `<Git>\bin\bash.exe`), sonst im
 * üblichen Installationsordner. Nie das `bash.exe` von Windows (WSL) unter System32.
 */
function gitBash(system: SystemPort, programFiles: string[]): string | null {
  const candidates: string[] = [];
  const git = system.findProgram('git.exe');
  if (git) {
    let root = path.dirname(path.dirname(git));
    if (/^mingw64$/i.test(path.basename(root))) root = path.dirname(root);
    candidates.push(path.join(root, 'bin', 'bash.exe'));
  }
  for (const p of programFiles) candidates.push(path.join(p, 'Git', 'bin', 'bash.exe'));
  return candidates.find((c) => system.exists(c)) ?? null;
}

/**
 * Die Shell für ein neues Terminal: die eingestellte, wenn es sie gibt, sonst PowerShell 7, sonst Windows PowerShell,
 * sonst die erste gefundene; `null`, wenn es keine gibt.
 */
export function shellFor(shells: readonly ShellInfo[], setting: string | undefined): ShellInfo | null {
  return (
    shells.find((s) => s.id === setting) ??
    shells.find((s) => s.id === 'pwsh') ??
    shells.find((s) => s.id === 'powershell') ??
    shells[0] ??
    null
  );
}

/** Die Argumente beim Start: ohne Logo bei PowerShell, Git Bash als Login-Shell (lädt `.bash_profile`). */
export function shellArgs(shell: ShellInfo): string[] {
  if (shell.id === 'pwsh' || shell.id === 'powershell') return ['-NoLogo'];
  if (shell.id === 'gitbash') return ['--login', '-i'];
  return [];
}

/** Geerbte Variablen, die nie in eine Shell gelangen (aus dem Dev-Start, von Electron, von Codium selbst). */
const DROPPED = /^(npm_|ELECTRON_|CODIUM_)/i;

/**
 * Umgebung für die Shell: die eigene, ohne npm-/Electron-Interna und ohne `CODIUM_*` (etwa die des Testmodus).
 * `PSModulePath` verliert die Modulordner von PowerShell 7: Wurde Codium aus PowerShell 7 gestartet, fände Windows
 * PowerShell dort sonst deren Fassung von Modulen wie Microsoft.PowerShell.Security und könnte sie nicht laden
 * (Erfahrung aus THub). PowerShell 7 ergänzt seine Ordner beim Start selbst wieder.
 */
export function shellEnvironment(inherited: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined || DROPPED.test(key)) continue;
    if (key.toUpperCase() === 'PSMODULEPATH') {
      const kept = value
        .split(';')
        .filter((dir) => dir !== '' && !/[\\/]PowerShell[\\/](7[\\/])?Modules[\\/]?$/i.test(dir));
      if (kept.length > 0) env[key] = kept.join(';');
      continue;
    }
    env[key] = value;
  }
  env.TERM_PROGRAM = 'Codium';
  return env;
}
