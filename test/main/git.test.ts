// Teststelle 1: der Git-Dienst (Ticket 15) gegen Temp-Repositories mit Bare-Remote, mit abgeschirmter Git-Konfiguration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSOLE_LIMIT } from '../../src/main/core/git/gitService';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import { ErrorCode, type CommandArgs, type CommandName, type CommandResult, type GitConsoleEntry, type GitState } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { createRepoWithRemote, git, shieldedGitEnv } from '../support/git';
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

describe('Git-Dienst', { timeout: 60_000 }, () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** Öffnet ein Projekt (Standard: die Arbeitskopie) mit dem echten Git und der abgeschirmten Konfiguration. */
  async function open(projectPath: string, env: NodeJS.ProcessEnv, base: string, options: { git?: boolean } = {}) {
    const test = createTestCore(path.join(base, 'data'), {
      system: { programs: options.git === false ? {} : { git: realGit }, home: path.join(base, 'home') },
      processEnv: env,
    });
    test.events.recordGitConsole = true;
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: projectPath });
    const windowId = test.ports.windows.windowTitled(`${path.basename(projectPath)} – Codium`);
    const state = () => call(test, windowId, 'git.state');
    return { test, windowId, state };
  }

  it('liest Branch, Upstream, voraus/zurück, abgekoppelten Zustand und einen laufenden Merge', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    const { test, windowId, state } = await open(repo, env, base);
    await until(state, (s) => s.repository && s.branch === 'main', 'main');
    expect(await state()).toMatchObject({ repository: true, root: repo, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });

    // Voraus: ein lokaler Commit; zurück: ein Commit auf dem Remote (über eine zweite Arbeitskopie).
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    run('add', 'a.txt');
    run('commit', '-m', 'lokal');
    const other = path.join(base, 'other');
    git(base, env, 'clone', path.join(base, 'remote.git'), other);
    fs.writeFileSync(path.join(other, 'b.txt'), 'b\n');
    git(other, env, 'add', 'b.txt');
    git(other, env, 'commit', '-m', 'remote');
    git(other, env, 'push');
    run('fetch');
    await call(test, windowId, 'git.refresh');
    expect(await state()).toMatchObject({ ahead: 1, behind: 1 });

    // Abgekoppelt: kurzer Hash statt Branch.
    const head = run('rev-parse', 'HEAD');
    run('checkout', '--detach');
    const detached = await call(test, windowId, 'git.refresh');
    expect(detached).toMatchObject({ branch: null, detached: head.slice(0, 8) });

    // Laufender Merge mit Konflikt.
    run('checkout', 'main');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'anders\n');
    run('add', 'b.txt');
    run('commit', '-m', 'konflikt');
    try {
      run('merge', 'origin/main');
    } catch {
      // Konflikt erwartet.
    }
    const merging = await call(test, windowId, 'git.refresh');
    expect(merging.operation).toBe('merge');
    expect(merging.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: path.join(repo, 'b.txt'), conflict: true })]));
  });

  it('erkennt einen Ordner ohne Repository und einen Projektordner als Unterordner eines Repositorys', async () => {
    const base = tempDir();
    const env = shieldedGitEnv(path.join(base, 'gitconfig'));
    const plain = path.join(base, 'Plain');
    fs.mkdirSync(plain);
    const first = await open(plain, env, base);
    expect(await first.state()).toEqual({ repository: false, branch: null, ahead: 0, behind: 0, files: [] });
    await expect(call(first.test, first.windowId, 'git.branches')).rejects.toMatchObject({ code: ErrorCode.notARepository });

    const { repo, run } = createRepoWithRemote(path.join(base, 'r'));
    const sub = path.join(repo, 'Ordner mit Umläuten');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'Datei ä.txt'), 'x\n');
    const second = await open(sub, env, path.join(base, 's'));
    const st = await until(second.state, (s) => s.repository, 'Repository');
    expect(st).toMatchObject({ root: repo, branch: 'main' });
    // Nur Dateien im Projektordner, mit Umlauten und Leerzeichen unverändert.
    expect(st.files).toEqual([{ path: path.join(sub, 'Datei ä.txt'), index: '?', worktree: '?' }]);
    // Ein Wechsel von aussen: Das Git-Verzeichnis liegt ausserhalb des Projekts, der Dienst beobachtet es selbst.
    run('checkout', '-b', 'aussen');
    await until(() => second.test.events.sent.filter((e) => e.name === 'git.stateChanged').map((e) => (e.payload as GitState).branch), (b) => b.includes('aussen'), 'Wechsel von aussen');
  });

  it('folgt einem Branch-Wechsel von aussen über „Git-Daten geändert“', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    const { test, state } = await open(repo, env, base);
    await until(state, (s) => s.branch === 'main', 'main');
    run('checkout', '-b', 'von-aussen');
    await until(() => test.events.sent.filter((e) => e.name === 'git.stateChanged').map((e) => (e.payload as GitState).branch), (b) => b.includes('von-aussen'), 'Wechsel');
  });

  it('legt Branches an, wechselt, benennt um und löscht; Remote-Branches werden lokal und folgen', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    const { test, windowId, state } = await open(repo, env, base);
    await until(state, (s) => s.branch === 'main', 'main');

    // Vom aktuellen Stand, ohne Auschecken; von einem anderen Branch, mit Auschecken.
    await call(test, windowId, 'git.createBranch', { name: 'feature', checkout: false });
    expect((await state()).branch).toBe('main');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'f\n');
    run('add', 'f.txt');
    run('commit', '-m', 'auf main');
    await call(test, windowId, 'git.createBranch', { name: 'from-feature', from: 'feature', checkout: true });
    expect((await state()).branch).toBe('from-feature');
    expect(fs.existsSync(path.join(repo, 'f.txt'))).toBe(false);

    // Wechseln, umbenennen, gemergten Branch löschen.
    await call(test, windowId, 'git.checkout', { name: 'main' });
    expect((await state()).branch).toBe('main');
    await call(test, windowId, 'git.renameBranch', { name: 'from-feature', newName: 'renamed' });
    const branches = await call(test, windowId, 'git.branches');
    expect(branches.local.map((b) => b.name).sort()).toEqual(['feature', 'main', 'renamed']);
    expect(branches.local.find((b) => b.name === 'main')).toMatchObject({ current: true, upstream: 'origin/main' });
    expect(branches.remote).toEqual([{ name: 'origin/main', remote: 'origin' }]);
    await call(test, windowId, 'git.deleteBranch', { name: 'renamed' });

    // Ein nicht gemergter Branch: erst die Rückfrage (GIT_NOT_MERGED), dann erzwungen.
    run('checkout', '-b', 'unmerged');
    fs.writeFileSync(path.join(repo, 'u.txt'), 'u\n');
    run('add', 'u.txt');
    run('commit', '-m', 'nicht gemergt');
    run('checkout', 'main');
    await call(test, windowId, 'git.refresh');
    await expect(call(test, windowId, 'git.deleteBranch', { name: 'unmerged' })).rejects.toMatchObject({ code: ErrorCode.gitNotMerged });
    await call(test, windowId, 'git.deleteBranch', { name: 'unmerged', force: true });
    // Der aktuelle Branch lässt sich nie löschen.
    await expect(call(test, windowId, 'git.deleteBranch', { name: 'main', force: true })).rejects.toMatchObject({ code: ErrorCode.gitFailed });

    // Remote-Branch auschecken: legt einen folgenden lokalen an; gibt es den Namen schon, wird dieser ausgecheckt.
    run('push', 'origin', 'feature:remote-only');
    run('fetch');
    expect(await call(test, windowId, 'git.checkoutRemote', { name: 'origin/remote-only' })).toEqual({ local: 'remote-only' });
    expect(await state()).toMatchObject({ branch: 'remote-only', upstream: 'origin/remote-only' });
    await call(test, windowId, 'git.checkoutRemote', { name: 'origin/main' });
    expect((await state()).branch).toBe('main');
    // Ungültige Namen (etwa eine Option) lehnt der Dienst ab, bevor Git sie sieht.
    await expect(call(test, windowId, 'git.createBranch', { name: '--force', checkout: false })).rejects.toMatchObject({ code: ErrorCode.invalidParams });
  });

  it('liefert bei einem verweigerten Wechsel die betroffenen Dateien', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    run('checkout', '-b', 'other');
    fs.writeFileSync(path.join(repo, 'README.md'), '# Auf other\n');
    run('commit', '-am', 'other');
    run('checkout', 'main');
    const { test, windowId, state } = await open(repo, env, base);
    await until(state, (s) => s.branch === 'main', 'main');
    fs.writeFileSync(path.join(repo, 'README.md'), '# Lokal geändert\n');
    const failure = await call(test, windowId, 'git.checkout', { name: 'other' }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: ErrorCode.gitCheckoutBlocked, data: { files: [path.join(repo, 'README.md')] } });
    expect((failure as Error).message).toMatch(/would be overwritten/);
  });

  it('schreibt jeden Aufruf mit Exit-Code und Hintergrund-Kennzeichen in die Konsole, höchstens 1000', async () => {
    const base = tempDir();
    const { repo, env } = createRepoWithRemote(base);
    const { test, windowId, state } = await open(repo, env, base);
    await until(state, (s) => s.branch === 'main', 'main');
    await call(test, windowId, 'git.createBranch', { name: 'konsole', checkout: true });
    const entries = await call(test, windowId, 'git.console');
    const created = entries.find((e) => e.command === 'git switch -c konsole')!;
    expect(created).toMatchObject({ exitCode: 0, background: false });
    expect(entries.some((e) => e.command.startsWith('git --no-optional-locks status') && e.background && e.exitCode === 0)).toBe(true);
    // Die Ereignisse melden Start (ohne Exit-Code) und Ende.
    const events = test.events.sent.filter((e) => e.name === 'git.console' && (e.payload as GitConsoleEntry).id === created.id);
    expect(events.map((e) => (e.payload as GitConsoleEntry).exitCode)).toEqual([null, 0]);

    // Höchstens 1000 Einträge (hier mit kleinerer Grenze, damit nicht tausend Prozesse starten).
    expect(CONSOLE_LIMIT).toBe(1000);
    const service = test.core.projectCore(windowId)!.git;
    service.consoleLimit = 10;
    await Promise.all(Array.from({ length: 15 }, () => service.run(['--version'], { background: true })));
    const limited = await call(test, windowId, 'git.console');
    expect(limited).toHaveLength(10);
    expect(limited.some((e) => e.id === created.id)).toBe(false);
  });

  it('führt zwei gleichzeitige schreibende Aktionen nacheinander aus', async () => {
    const base = tempDir();
    const { repo, env } = createRepoWithRemote(base);
    const { test, windowId, state } = await open(repo, env, base);
    await until(state, (s) => s.branch === 'main', 'main');
    await Promise.all([call(test, windowId, 'git.createBranch', { name: 'eins', checkout: false }), call(test, windowId, 'git.createBranch', { name: 'zwei', checkout: false })]);
    const entries = (await call(test, windowId, 'git.console')).filter((e) => !e.background);
    const one = entries.find((e) => e.command === 'git branch eins')!;
    const two = entries.find((e) => e.command === 'git branch zwei')!;
    // Der zweite beginnt erst, wenn der erste fertig ist: Sein Start-Ereignis kommt nach dem Ende des ersten.
    const order = test.events.sent
      .filter((e) => e.name === 'git.console' && [one.id, two.id].includes((e.payload as GitConsoleEntry).id))
      .map((e) => `${(e.payload as GitConsoleEntry).id === one.id ? 'eins' : 'zwei'}:${(e.payload as GitConsoleEntry).exitCode === null ? 'start' : 'ende'}`);
    expect(order).toEqual(['eins:start', 'eins:ende', 'zwei:start', 'zwei:ende']);
  });

  it('öffnet nie einen Editor, auch wenn einer eingestellt ist, der fehlschlagen würde', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    run('config', 'core.editor', 'false-editor-that-does-not-exist');
    const { test, windowId, state } = await open(repo, { ...env, GIT_EDITOR: 'false-editor-that-does-not-exist', EDITOR: 'nope' }, base);
    await until(state, (s) => s.branch === 'main', 'main');
    const service = test.core.projectCore(windowId)!.git;
    expect((await service.run(['var', 'GIT_EDITOR'])).stdout.trim()).toBe('true');
    // Ein Aufruf, der sonst den Editor fragen würde (Commit-Nachricht bearbeiten), läuft einfach durch.
    fs.writeFileSync(path.join(repo, 'e.txt'), 'e\n');
    run('add', 'e.txt');
    expect((await service.run(['commit', '-m', 'ohne Editor', '--edit'], { write: true })).code).toBe(0);
  });

  it('verwirft nie lokale Änderungen, wenn ein Branchname ein Pfad ist (Review von Ticket 15)', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.writeFileSync(path.join(repo, 'docs', 'x.txt'), 'eins\n');
    run('add', '.');
    run('commit', '-m', 'docs');
    const { test, windowId, state } = await open(repo, env, base);
    await until(state, (s) => s.branch === 'main', 'main');
    fs.writeFileSync(path.join(repo, 'docs', 'x.txt'), 'lokal geändert\n');
    fs.writeFileSync(path.join(repo, 'README.md'), 'auch geändert\n');
    for (const name of ['docs', '.', 'README.md']) {
      await expect(call(test, windowId, 'git.checkout', { name }), name).rejects.toMatchObject({ code: ErrorCode.gitFailed });
    }
    expect(fs.readFileSync(path.join(repo, 'docs', 'x.txt'), 'utf8')).toBe('lokal geändert\n');
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('auch geändert\n');
  });

  it('folgt in einem Worktree den gemeinsamen Refs des Haupt-Repositorys (Review von Ticket 15)', async () => {
    const base = tempDir();
    const { repo, env, run } = createRepoWithRemote(base);
    const worktree = path.join(base, 'Arbeit ä');
    run('worktree', 'add', '-b', 'wtb', worktree);
    git(worktree, env, 'branch', '--set-upstream-to=main');
    const { test, state } = await open(worktree, env, base);
    await until(state, (s) => s.branch === 'wtb', 'Worktree');
    // Ein Commit auf main im Haupt-Repository: wtb ist danach einen Commit zurück.
    fs.writeFileSync(path.join(repo, 'neu.txt'), 'n\n');
    run('add', 'neu.txt');
    run('commit', '-m', 'im Haupt-Repository');
    await until(
      () => test.events.sent.filter((e) => e.name === 'git.stateChanged').map((e) => (e.payload as GitState).behind),
      (b) => b.includes(1),
      'zurück nach Commit im Haupt-Repository',
    );
  });

  it('zeigt im Repository ohne Commits den ungeborenen Branch; Umbenennungen mit Umlauten und Leerzeichen', async () => {
    const base = tempDir();
    const env = shieldedGitEnv(path.join(base, 'gitconfig'));
    const fresh = path.join(base, 'Neu');
    git(base, env, 'init', '--initial-branch=main', fresh);
    const first = await open(fresh, env, base);
    await until(first.state, (s) => s.repository, 'Repository');
    expect((await call(first.test, first.windowId, 'git.branches')).local).toEqual([{ name: 'main', current: true }]);

    const { repo, run } = createRepoWithRemote(path.join(base, 'r'));
    fs.writeFileSync(path.join(repo, 'alt name.txt'), 'x\n');
    run('add', '.');
    run('commit', '-m', 'datei');
    run('mv', 'alt name.txt', 'neuer Näme.txt');
    const second = await open(repo, env, path.join(base, 's'));
    const st = await until(second.state, (s) => s.files.length > 0, 'Umbenennung');
    expect(st.files).toEqual([{ path: path.join(repo, 'neuer Näme.txt'), index: 'R', worktree: '.', origPath: path.join(repo, 'alt name.txt') }]);
  });

  it('ist ohne Git aus', async () => {
    const base = tempDir();
    const { repo, env } = createRepoWithRemote(base);
    const { test, windowId, state } = await open(repo, env, base, { git: false });
    expect(await state()).toMatchObject({ repository: false });
    await expect(call(test, windowId, 'git.branches')).rejects.toMatchObject({ code: ErrorCode.gitNotFound });
    await expect(call(test, windowId, 'git.checkout', { name: 'main' })).rejects.toMatchObject({ code: ErrorCode.gitNotFound });
  });
});
