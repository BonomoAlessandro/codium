// Teststelle 1: Fetch, Pull, Push und Konflikte (Ticket 18), gegen Temp-Repositories mit Bare-Remote und einem zweiten
// Klon, der den Remote verändert; abgeschirmte Git-Konfiguration, kein echter Server.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import type { CommandArgs, CommandName, CommandResult } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { createRepoWithRemote, git } from '../support/git';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const realGit = new NodeSystem(process.env).findProgram('git')!;

describe('Fetch, Pull, Push und Konflikte', { timeout: 60_000 }, () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function setup(configure?: (run: (...a: string[]) => string) => void) {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    fs.writeFileSync(path.join(repo.repo, 'a.txt'), 'eins\nzwei\ndrei\n');
    repo.run('add', 'a.txt');
    repo.run('commit', '-m', 'a');
    repo.run('push');
    configure?.(repo.run);
    // Der zweite Klon verändert den Remote.
    const otherDir = path.join(base, 'other');
    git(base, repo.env, 'clone', repo.remote, otherDir);
    const other = (...a: string[]) => git(otherDir, repo.env, ...a);
    const test = createTestCore(path.join(base, 'data'), { system: { programs: { git: realGit }, home: path.join(base, 'home') }, processEnv: repo.env });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: repo.repo });
    const windowId = test.ports.windows.windowTitled('repo – Codium');
    await call(test, windowId, 'git.state');
    const commitInOther = (file: string, text: string, message: string) => {
      fs.writeFileSync(path.join(otherDir, file), text);
      other('add', file);
      other('commit', '-m', message);
      other('push');
    };
    return { ...repo, test, windowId, other, otherDir, commitInOther, at: (...p: string[]) => path.join(repo.repo, ...p) };
  }

  it('Fetch zeigt neue Remote-Branches, entfernt gelöschte; voraus/zurück stimmt danach', async () => {
    const { test, windowId, other, commitInOther } = await setup();
    other('push', 'origin', 'HEAD:refs/heads/feature');
    commitInOther('b.txt', 'b\n', 'b');
    await call(test, windowId, 'git.fetch');
    let branches = await call(test, windowId, 'git.branches');
    expect(branches.remote.map((b) => b.name)).toContain('origin/feature');
    expect((await call(test, windowId, 'git.state')).behind).toBe(1);
    other('push', 'origin', '--delete', 'feature');
    await call(test, windowId, 'git.fetch');
    branches = await call(test, windowId, 'git.branches');
    expect(branches.remote.map((b) => b.name)).not.toContain('origin/feature');
    // Fortschritt in der Statusleiste.
    expect(test.events.sent.some((e) => e.name === 'app.progress' && (e.payload as { title?: string }).title === 'Fetching…')).toBe(true);
  });

  it('Pull mit Merge-Konfiguration: ohne Konflikt; mit Konflikt vorausgefüllte Nachricht, Commit schliesst ab', async () => {
    const { test, windowId, at, run, commitInOther } = await setup((r) => r('config', 'pull.rebase', 'false'));
    commitInOther('b.txt', 'b\n', 'b');
    expect(await call(test, windowId, 'git.pull')).toEqual({ conflicts: false });
    expect(fs.readFileSync(at('b.txt'), 'utf8')).toBe('b\n');

    commitInOther('a.txt', 'eins\nREMOTE\ndrei\n', 'remote');
    fs.writeFileSync(at('a.txt'), 'eins\nLOKAL\ndrei\n');
    run('commit', '-am', 'lokal');
    expect(await call(test, windowId, 'git.pull')).toEqual({ conflicts: true });
    const state = await call(test, windowId, 'git.state');
    expect(state.operation).toBe('merge');
    expect(state.files.filter((f) => f.conflict).map((f) => path.basename(f.path))).toEqual(['a.txt']);
    expect(await call(test, windowId, 'git.mergeMessage')).toMatch(/^Merge branch 'main' of /);
    // Verbliebene Markierungen werden erkannt, nach dem Auflösen nicht mehr.
    expect(await call(test, windowId, 'git.conflictMarkers')).toEqual([at('a.txt')]);
    fs.writeFileSync(at('a.txt'), 'eins\nBEIDE\ndrei\n');
    expect(await call(test, windowId, 'git.conflictMarkers')).toEqual([]);
    await call(test, windowId, 'git.commit', { paths: [], message: 'Merge' });
    const after = await call(test, windowId, 'git.state');
    expect(after.operation).toBeUndefined();
    expect(run('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    expect(run('show', 'HEAD:a.txt')).toBe('eins\nBEIDE\ndrei');
  });

  it('Merge-Konflikt: Abort stellt den Stand davor her', async () => {
    const { test, windowId, at, run, commitInOther } = await setup((r) => r('config', 'pull.rebase', 'false'));
    commitInOther('a.txt', 'eins\nREMOTE\ndrei\n', 'remote');
    fs.writeFileSync(at('a.txt'), 'eins\nLOKAL\ndrei\n');
    run('commit', '-am', 'lokal');
    const before = run('rev-parse', 'HEAD');
    expect((await call(test, windowId, 'git.pull')).conflicts).toBe(true);
    await call(test, windowId, 'git.abort');
    expect((await call(test, windowId, 'git.state')).operation).toBeUndefined();
    expect(run('rev-parse', 'HEAD')).toBe(before);
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('eins\nLOKAL\ndrei\n');
  });

  it('Pull mit Rebase-Konfiguration: ohne Konflikt; mit Konflikt schliesst Continue ohne Editor ab, Abort stellt her', async () => {
    const { test, windowId, at, run, commitInOther } = await setup((r) => r('config', 'pull.rebase', 'true'));
    commitInOther('b.txt', 'b\n', 'b');
    fs.writeFileSync(at('c.txt'), 'c\n');
    run('add', 'c.txt');
    run('commit', '-m', 'c');
    expect(await call(test, windowId, 'git.pull')).toEqual({ conflicts: false });
    expect(run('log', '-1', '--format=%P').split(' ')).toHaveLength(1);

    commitInOther('a.txt', 'eins\nREMOTE\ndrei\n', 'remote');
    fs.writeFileSync(at('a.txt'), 'eins\nLOKAL\ndrei\n');
    run('commit', '-am', 'lokal');
    const before = run('rev-parse', 'HEAD');
    expect(await call(test, windowId, 'git.pull')).toEqual({ conflicts: true });
    expect((await call(test, windowId, 'git.state')).operation).toBe('rebase');
    // Abort stellt den Stand davor her.
    await call(test, windowId, 'git.abort');
    expect(run('rev-parse', 'HEAD')).toBe(before);
    expect((await call(test, windowId, 'git.state')).operation).toBeUndefined();

    // Noch einmal; aufgelöst und eine weitere versionierte Datei geändert: Continue schliesst ohne Editor ab.
    expect((await call(test, windowId, 'git.pull')).conflicts).toBe(true);
    fs.writeFileSync(at('a.txt'), 'eins\nBEIDE\ndrei\n');
    fs.writeFileSync(at('c.txt'), 'c geändert\n');
    await expect(call(test, windowId, 'git.commit', { paths: [at('a.txt')], message: 'x' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(await call(test, windowId, 'git.continueRebase')).toEqual({ conflicts: false });
    expect((await call(test, windowId, 'git.state')).operation).toBeUndefined();
    expect(run('log', '-1', '--format=%s')).toBe('lokal');
    expect(run('show', 'HEAD:a.txt')).toBe('eins\nBEIDE\ndrei');
  });

  it('Push eines neuen Branches setzt den Upstream; mit zwei Remotes wird „origin“ gewählt', async () => {
    const { test, windowId, run, remote } = await setup();
    const second = path.join(path.dirname(remote), 'second.git');
    git(path.dirname(remote), {}, 'init', '--bare', second);
    run('remote', 'add', 'aaa', second);
    run('switch', '-c', 'feature');
    fs.writeFileSync(path.join(path.dirname(remote), 'repo', 'f.txt'), 'f\n');
    run('add', 'f.txt');
    run('commit', '-m', 'f');
    expect(await call(test, windowId, 'git.push')).toEqual({ remote: 'origin', branch: 'feature', upstreamSet: true });
    expect(run('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('origin/feature');
    expect(git(path.dirname(remote), {}, '--git-dir', remote, 'rev-parse', 'feature')).toBe(run('rev-parse', 'HEAD'));
    const state = await call(test, windowId, 'git.state');
    expect(state.upstream).toBe('origin/feature');
    expect(state.ahead).toBe(0);
  });

  it('Ein abgelehnter Push liefert „Remote ist weiter“; Commit and Push', async () => {
    // Ohne `pull.rebase` verweigert Git den Pull auseinanderlaufender Branches; Codium hat keine eigene Strategie.
    const { test, windowId, at, run, commitInOther } = await setup((r) => r('config', 'pull.rebase', 'false'));
    commitInOther('b.txt', 'b\n', 'b');
    fs.writeFileSync(at('a.txt'), 'eins\nLOKAL\ndrei\n');
    run('commit', '-am', 'lokal');
    await expect(call(test, windowId, 'git.push')).rejects.toMatchObject({ code: 'GIT_PUSH_REJECTED' });

    // Commit and Push: nach dem Pull ein Commit und dann ein Push.
    expect((await call(test, windowId, 'git.pull')).conflicts).toBe(false);
    fs.writeFileSync(at('d.txt'), 'd\n');
    await call(test, windowId, 'git.commit', { paths: [at('d.txt')], message: 'd' });
    expect(await call(test, windowId, 'git.push')).toEqual({ remote: 'origin', branch: 'main', upstreamSet: false });
    expect((await call(test, windowId, 'git.state')).ahead).toBe(0);
  });
});
