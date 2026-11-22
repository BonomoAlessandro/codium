// Teststelle 1: Commit, Rollback, .gitignore und Dateizustände im Git-Dienst (Ticket 16), gegen Temp-Repositories mit
// abgeschirmter Git-Konfiguration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import type { CommandArgs, CommandName, CommandResult, GitState } from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { createRepoWithRemote, git } from '../support/git';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const realGit = new NodeSystem(process.env).findProgram('git')!;

async function until<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, what: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what} (zuletzt ${JSON.stringify(value)?.slice(0, 300)})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Commit und Rollback', { timeout: 30_000 }, () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function setup(files: Record<string, string> = { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' }) {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo.repo, name), text);
    repo.run('add', '.');
    repo.run('commit', '-m', 'Dateien');
    const test = createTestCore(path.join(base, 'data'), { system: { programs: { git: realGit }, home: path.join(base, 'home') }, processEnv: repo.env });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: repo.repo });
    const windowId = test.ports.windows.windowTitled('repo – Codium');
    await until(() => call(test, windowId, 'git.state'), (s) => s.repository, 'Repository');
    const at = (...p: string[]) => path.join(repo.repo, ...p);
    const status = (s: GitState, file: string) => s.files.find((f) => f.path === at(file));
    return { ...repo, test, windowId, at, status, base };
  }

  it('committet nur die angehakten Dateien; vorbereitete Index-Einträge anderer Dateien bleiben', async () => {
    const { test, windowId, at, run, status } = await setup();
    for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(at(f), 'geändert\n');
    // c.txt ist im Index vorbereitet, aber nicht angehakt.
    run('add', 'c.txt');
    await call(test, windowId, 'git.commit', { paths: [at('a.txt'), at('b.txt')], message: 'Zwei von drei' });
    expect(run('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['a.txt', 'b.txt']);
    const after = await call(test, windowId, 'git.refresh');
    expect(status(after, 'c.txt')).toMatchObject({ index: 'M' });
    expect(status(after, 'a.txt')).toBeUndefined();
  });

  it('nimmt neue angehakte Dateien auf, lässt nicht angehakte unversioniert und committet Löschungen', async () => {
    const { test, windowId, at, run, status } = await setup();
    fs.writeFileSync(at('neu.txt'), 'neu\n');
    fs.writeFileSync(at('andere.txt'), 'andere\n');
    fs.rmSync(at('b.txt'));
    await call(test, windowId, 'git.commit', { paths: [at('neu.txt'), at('b.txt')], message: 'Neu und gelöscht' });
    expect(run('show', '--name-status', '--format=', 'HEAD').split('\n').sort()).toEqual(['A\tneu.txt', 'D\tb.txt']);
    expect(status(await call(test, windowId, 'git.refresh'), 'andere.txt')).toMatchObject({ index: '?' });
  });

  it('merkt eine Umbenennung in Codium im Index vor und committet sie als Umbenennung', async () => {
    const { test, windowId, at, run } = await setup();
    await call(test, windowId, 'files.rename', { path: at('a.txt'), newName: 'umbenannt ä.txt' });
    const state = await until(
      () => call(test, windowId, 'git.refresh'),
      (s) => s.files.some((f) => f.index === 'R'),
      'Umbenennung',
    );
    expect(state.files.find((f) => f.index === 'R')).toMatchObject({ path: at('umbenannt ä.txt'), origPath: at('a.txt') });
    await call(test, windowId, 'git.commit', { paths: [at('umbenannt ä.txt')], message: 'Umbenannt' });
    expect(run('-c', 'core.quotePath=false', 'show', '--name-status', '-M', '--format=', 'HEAD')).toMatch(/^R100\ta\.txt\tumbenannt ä\.txt$/);
  });

  it('ergänzt mit Amend den letzten Commit und übernimmt die geänderte Nachricht', async () => {
    const { test, windowId, at, run } = await setup();
    fs.writeFileSync(at('a.txt'), 'eins\n');
    await call(test, windowId, 'git.commit', { paths: [at('a.txt')], message: 'Erster Versuch' });
    const count = run('rev-list', '--count', 'HEAD');
    expect(await call(test, windowId, 'git.lastMessage')).toBe('Erster Versuch');
    fs.writeFileSync(at('b.txt'), 'zwei\n');
    await call(test, windowId, 'git.commit', { paths: [at('b.txt')], message: 'Besser', amend: true });
    expect(run('rev-list', '--count', 'HEAD')).toBe(count);
    expect(run('log', '-1', '--format=%s')).toBe('Besser');
    expect(run('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['a.txt', 'b.txt']);
    // Nur die Nachricht ändern.
    await call(test, windowId, 'git.commit', { paths: [], message: 'Nur die Nachricht', amend: true });
    expect(run('log', '-1', '--format=%s')).toBe('Nur die Nachricht');
  });

  it('setzt geänderte, gelöschte, hinzugefügte und umbenannte Dateien zurück; Hinzugefügte landen im Papierkorb', async () => {
    const { test, windowId, at, run } = await setup();
    fs.writeFileSync(at('a.txt'), 'geändert\n');
    fs.rmSync(at('b.txt'));
    fs.writeFileSync(at('neu.txt'), 'neu\n');
    run('add', 'neu.txt');
    run('mv', 'c.txt', 'c2.txt');
    await call(test, windowId, 'git.refresh');
    await call(test, windowId, 'git.rollback', { paths: [at('a.txt'), at('b.txt'), at('neu.txt'), at('c2.txt')] });
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('a\n');
    expect(fs.readFileSync(at('b.txt'), 'utf8')).toBe('b\n');
    expect(fs.readFileSync(at('c.txt'), 'utf8')).toBe('c\n');
    expect(fs.existsSync(at('neu.txt'))).toBe(false);
    expect(fs.existsSync(at('c2.txt'))).toBe(false);
    expect(test.ports.shell.trashed.map((t) => path.basename(t.path)).sort()).toEqual(['c2.txt', 'neu.txt']);
    expect((await call(test, windowId, 'git.refresh')).files.filter((f) => f.index !== '!')).toEqual([]);
  });

  it('ergänzt die .gitignore und meldet ignorierte Dateien und Konflikte für den Dateibaum', async () => {
    const { test, windowId, at, run, status } = await setup();
    fs.writeFileSync(at('build.log'), 'x\n');
    fs.mkdirSync(at('out'));
    fs.writeFileSync(at('out', 'a.class'), 'x');
    await call(test, windowId, 'git.addToGitignore', { path: at('build.log') });
    expect(fs.readFileSync(at('.gitignore'), 'utf8')).toBe('/build.log\n');
    await call(test, windowId, 'git.addToGitignore', { path: at('out') });
    expect(fs.readFileSync(at('.gitignore'), 'utf8')).toBe('/build.log\n/out/\n');
    const state = await call(test, windowId, 'git.refresh');
    expect(status(state, 'build.log')).toMatchObject({ index: '!' });
    expect(status(state, 'out')).toMatchObject({ index: '!' });

    // Konflikt.
    run('add', '.gitignore');
    run('commit', '-m', 'ignore');
    run('checkout', '-b', 'zweig');
    fs.writeFileSync(at('a.txt'), 'zweig\n');
    run('commit', '-am', 'zweig');
    run('checkout', 'main');
    fs.writeFileSync(at('a.txt'), 'main\n');
    run('commit', '-am', 'main');
    try {
      run('merge', 'zweig');
    } catch {
      // Konflikt erwartet.
    }
    expect(status(await call(test, windowId, 'git.refresh'), 'a.txt')).toMatchObject({ conflict: true });
  });

  it('merkt sich „Group by Directory“ über einen Neustart', async () => {
    const { test, windowId, base } = await setup();
    expect(await call(test, windowId, 'project.commitView')).toEqual({ groupByDirectory: false });
    await call(test, windowId, 'project.setCommitView', { groupByDirectory: true });
    const next = await restart(test, { system: { programs: { git: realGit }, home: path.join(base, 'home') } });
    await next.core.start();
    expect(await call(next, next.ports.windows.windowTitled('repo – Codium'), 'project.commitView')).toEqual({ groupByDirectory: true });
    void git;
  });
});
