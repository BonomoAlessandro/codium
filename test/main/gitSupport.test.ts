// Das Testgerüst für Git selbst: Temp-Repository mit Bare-Remote, Git-Konfiguration des Rechners abgeschirmt.

import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote, git, TEST_GIT_USER } from '../support/git';
import { useTempDirs } from '../support/tempDir';

describe('Git-Testgerüst', () => {
  const tempDir = useTempDirs();

  it('legt eine Arbeitskopie an, die einem Bare-Remote folgt', () => {
    const { repo, remote, run } = createRepoWithRemote(tempDir());
    expect(run('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(run('rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main');
    expect(path.resolve(run('remote', 'get-url', 'origin'))).toBe(remote);
    expect(run('log', '--format=%an <%ae>', '-1')).toBe(`${TEST_GIT_USER.name} <${TEST_GIT_USER.email}>`);
    expect(run('status', '--porcelain')).toBe('');
    expect(repo).not.toBe(remote);
  });

  it('lässt weder die globale noch die systemweite Konfiguration des Rechners hineinwirken', () => {
    const base = tempDir();
    const { repo, env } = createRepoWithRemote(base);
    // Jede wirksame Einstellung samt Herkunft: nur die Temp-Datei des Tests und die Konfiguration des
    // Repositorys selbst sind erlaubt.
    const lines = git(repo, env, 'config', '--list', '--show-origin', '--show-scope').split('\n');
    const globalFile = path.join(base, 'gitconfig-global').toLowerCase();
    for (const line of lines) {
      const [scope, origin] = line.split('\t');
      // Git schreibt Pfade mit Sonderzeichen in Anführungszeichen und verdoppelt dabei die Backslashes.
      const file = origin.replace(/^file:/, '').replace(/^"(.*)"$/, '$1').replace(/\\\\/g, '\\');
      const fromTestGlobal = scope === 'global' && path.resolve(file).toLowerCase() === globalFile;
      const fromRepo = scope === 'local' && file === '.git/config';
      expect(fromTestGlobal || fromRepo, line).toBe(true);
    }
    expect(lines.some((line) => line.startsWith('global'))).toBe(true);
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
  });
});
