// Temp-Git-Repositories für Tests, mit abgeschirmter Git-Konfiguration: Weder die globale noch die systemweite
// Konfiguration des Rechners wirkt hinein (Hooks, Signierung, Aliase des Nutzers). Als Remote dient ein lokales
// Bare-Repository; echte Server werden nie angesprochen.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const TEST_GIT_USER = { name: 'Codium Test', email: 'test@codium.invalid' };

/**
 * Umgebung für Git-Aufrufe in Tests: geerbte GIT_*-Variablen entfernt, globale Konfiguration auf die
 * angegebene Datei umgeleitet (sie wird mit Benutzer und Standardbranch angelegt), systemweite abgeschaltet.
 */
export function shieldedGitEnv(globalConfigFile: string): NodeJS.ProcessEnv {
  if (!fs.existsSync(globalConfigFile)) {
    fs.mkdirSync(path.dirname(globalConfigFile), { recursive: true });
    fs.writeFileSync(
      globalConfigFile,
      [
        '[user]',
        `\tname = ${TEST_GIT_USER.name}`,
        `\temail = ${TEST_GIT_USER.email}`,
        '[init]',
        '\tdefaultBranch = main',
        '[commit]',
        '\tgpgsign = false',
        '[core]',
        '\tautocrlf = false',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key)) env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = globalConfigFile;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/** Führt Git aus und liefert die Ausgabe ohne abschliessenden Zeilenumbruch. Wirft bei Exit-Code ≠ 0. */
export function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

export interface RepoWithRemote {
  /** Arbeitskopie mit einem ersten Commit auf `main`, die `origin` folgt. */
  repo: string;
  /** Bare-Repository als `origin`. */
  remote: string;
  env: NodeJS.ProcessEnv;
  /** Git in der Arbeitskopie. */
  run(...args: string[]): string;
}

/**
 * Legt unter `baseDir` ein Bare-Repository und eine Arbeitskopie mit erstem, gepushtem Commit an; `name` ist der Ordner
 * der Arbeitskopie und damit der Projektname.
 */
export function createRepoWithRemote(baseDir: string, name = 'repo'): RepoWithRemote {
  const env = shieldedGitEnv(path.join(baseDir, 'gitconfig-global'));
  const remote = path.join(baseDir, 'remote.git');
  const repo = path.join(baseDir, name);
  git(baseDir, env, 'init', '--bare', '--initial-branch=main', remote);
  git(baseDir, env, 'init', '--initial-branch=main', repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# Testprojekt\n', 'utf8');
  git(repo, env, 'add', 'README.md');
  git(repo, env, 'commit', '-m', 'Erster Commit');
  git(repo, env, 'remote', 'add', 'origin', remote);
  git(repo, env, 'push', '-u', 'origin', 'main');
  return { repo, remote, env, run: (...args) => git(repo, env, ...args) };
}
