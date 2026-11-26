// Teststelle 1: Commit, Rollback, .gitignore und Dateizustände im Git-Dienst (Ticket 16), gegen Temp-Repositories mit
// abgeschirmter Git-Konfiguration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathChunks } from '../../src/main/core/git/gitService';
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

describe('Commit und Rollback', { timeout: 60_000 }, () => {
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
    expect((await call(test, windowId, 'git.refresh')).files).toEqual([]);
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
    expect(state.ignored).toEqual(expect.arrayContaining([{ path: at('build.log') }, { path: at('out'), directory: true }]));

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

  it('meldet Ordner ohne versionierte Dateien als nicht versioniert, die Dateien darin einzeln (Ticket 29)', async () => {
    const { test, windowId, at, run, env } = await setup();
    const write = (relative: string) => {
      fs.mkdirSync(path.dirname(at(relative)), { recursive: true });
      fs.writeFileSync(at(relative), 'x\n');
    };
    fs.writeFileSync(at('.gitignore'), '*.log\nbuild/\n');
    write('gemischt/alt.txt');
    write('Entwürfe 1/fest.txt');
    run('add', '.');
    run('commit', '-m', 'gemischt');
    // Nur nicht versioniert, verschachtelt und mit Klammern und Umlaut im Namen; darin eine ignorierte Datei und ein
    // ignorierter Ordner.
    write('drafts/ideas.md');
    write('drafts/old/notes.txt');
    write('drafts/x.log');
    write('drafts/build/out.class');
    write('Entwürfe [1]/a_b.txt');
    // Gemischt: versioniert und neu; ein Ordner, der wie „Entwürfe [1]“ heisst, wenn man die Klammern als Muster liest.
    // Nur ignoriert: kein nicht versionierter Ordner. Leer: kommt nicht vor.
    write('gemischt/neu.txt');
    write('Entwürfe 1/neu.txt');
    write('logs/server.log');
    fs.mkdirSync(at('leer'));
    // Ein eigenes Repository und ein Worktree im Projekt: als Ordner gemeldet, aber ohne zweiten Aufruf.
    write('eigenes-repo/innen.txt');
    git(at('eigenes-repo'), env, 'init', '--quiet');
    run('worktree', 'add', '--quiet', 'wt', '-b', 'wt-zweig');

    const state = await call(test, windowId, 'git.refresh');
    expect(state.untrackedDirs?.slice().sort()).toEqual([at('drafts'), at('eigenes-repo'), at('Entwürfe [1]'), at('wt')].sort());
    // Die Reihenfolge der Dateien ist egal, die Änderungsansicht sortiert selbst.
    expect(
      state.files
        .filter((f) => f.index === '?')
        .map((f) => f.path)
        .sort(),
    ).toEqual([at('drafts', 'ideas.md'), at('drafts', 'old', 'notes.txt'), at('Entwürfe [1]', 'a_b.txt'), at('Entwürfe 1', 'neu.txt'), at('gemischt', 'neu.txt')].sort());
    // Der zweite Aufruf nur für die beiden Ordner ohne eigenes Repository.
    const inner = (await call(test, windowId, 'git.console')).filter((e) => e.command.includes('--literal-pathspecs'));
    expect(inner.at(-1)?.command).toMatch(/"?-- \(2 paths\)"?$/);
    expect(state.ignored).toEqual(
      expect.arrayContaining([{ path: at('drafts', 'x.log') }, { path: at('drafts', 'build'), directory: true }, { path: at('logs', 'server.log') }]),
    );
    // Commit einer Datei aus einem nicht versionierten Ordner wie bisher.
    await call(test, windowId, 'git.commit', { paths: [at('drafts', 'old', 'notes.txt')], message: 'Notizen' });
    expect(run('show', '--name-only', '--format=', 'HEAD')).toBe('drafts/old/notes.txt');
    const after = await call(test, windowId, 'git.refresh');
    // drafts hat jetzt eine versionierte Datei: nicht mehr als Ganzes nicht versioniert.
    expect(after.untrackedDirs?.slice().sort()).toEqual([at('eigenes-repo'), at('Entwürfe [1]'), at('wt')].sort());
    expect(after.files.find((f) => f.path === at('drafts', 'ideas.md'))).toMatchObject({ index: '?' });
  });

  it('nimmt Dateinamen mit [ ] wörtlich (* und ? sind unter Windows keine gültigen Namen): Rollback, Commit und .gitignore treffen nur sie (Review von Ticket 16)', async () => {
    const { test, windowId, at, run } = await setup({ '[ab].txt': 'x\n', 'a.txt': 'a\n', 'b.txt': 'b\n', '[x]y.txt': 's\n' });
    fs.writeFileSync(at('[ab].txt'), 'geändert\n');
    fs.writeFileSync(at('a.txt'), 'WICHTIG ungespeicherte Arbeit\n');
    fs.writeFileSync(at('[x]y.txt'), 'geändert\n');
    await call(test, windowId, 'git.refresh');
    await call(test, windowId, 'git.rollback', { paths: [at('[ab].txt')] });
    expect(fs.readFileSync(at('[ab].txt'), 'utf8')).toBe('x\n');
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('WICHTIG ungespeicherte Arbeit\n');

    await call(test, windowId, 'git.commit', { paths: [at('[x]y.txt')], message: 'Nur die Klammer' });
    expect(run('show', '--name-only', '--format=', 'HEAD')).toBe('[x]y.txt');

    fs.writeFileSync(at('[cd].log'), 'x\n');
    fs.writeFileSync(at('c.log'), 'x\n');
    await call(test, windowId, 'git.addToGitignore', { path: at('[cd].log') });
    const state = await call(test, windowId, 'git.refresh');
    expect(state.ignored).toEqual(expect.arrayContaining([{ path: at('[cd].log') }]));
    expect(state.files.find((f) => f.path === at('c.log'))).toMatchObject({ index: '?' });
  });

  it('liest auch sehr viele nicht versionierte Ordner, in Teilen über die Befehlszeile (Ticket 29)', async () => {
    expect(pathChunks(['aaa/', 'bbb/', 'ccc/'], 10)).toEqual([['aaa/', 'bbb/'], ['ccc/']]);
    expect(pathChunks(['ein-sehr-langer-pfad/'], 5)).toEqual([['ein-sehr-langer-pfad/']]);
    expect(pathChunks([])).toEqual([]);

    const { test, windowId, at } = await setup();
    // 400 Ordner, je 44 Zeichen mit „/“: zusammen über 16'000 Zeichen, also mindestens zwei Aufrufe.
    const names = Array.from({ length: 400 }, (_, i) => `generierter-ordner-mit-langem-namen-nr-${String(i).padStart(4, '0')}`);
    for (const name of names) {
      fs.mkdirSync(at(name));
      fs.writeFileSync(at(name, 'datei.txt'), 'x\n');
    }
    const state = await call(test, windowId, 'git.refresh');
    expect(state.untrackedDirs).toHaveLength(400);
    expect(
      state.files
        .filter((f) => f.index === '?')
        .map((f) => f.path)
        .sort(),
    ).toEqual(names.map((n) => at(n, 'datei.txt')).sort());
    // Jeder zweite Aufruf bleibt unter der Grenze (je Pfad die Länge plus ein Trennzeichen); die Konsole nennt nur die
    // Zahl der Pfade.
    const counts = (await call(test, windowId, 'git.console'))
      .filter((e) => e.command.includes('--literal-pathspecs'))
      .map((e) => Number(/\((\d+) paths\)/.exec(e.command)?.[1] ?? 1));
    expect(counts.length).toBeGreaterThanOrEqual(2);
    for (const count of counts) expect(count * (names[0].length + 2), String(count)).toBeLessThanOrEqual(16_000);
  });

  it('committet sehr viele neue Dateien (Pfade über stdin statt über die Befehlszeile)', async () => {
    const { test, windowId, at, run } = await setup();
    const dir = at('ein-ziemlich-langer-ordnername-fuer-generierten-code', 'noch-ein-unterordner');
    fs.mkdirSync(dir, { recursive: true });
    const paths = Array.from({ length: 700 }, (_, i) => path.join(dir, `generierte-datei-nummer-${i}.txt`));
    for (const p of paths) fs.writeFileSync(p, 'x\n');
    await call(test, windowId, 'git.refresh');
    await call(test, windowId, 'git.commit', { paths, message: 'Viele' });
    expect(run('show', '--name-only', '--format=', 'HEAD').split('\n')).toHaveLength(700);
  });

  it('überträgt beim Umbenennen eines Ordners nur versionierte Dateien und übersteht schnelles Umbenennen', async () => {
    const { test, windowId, at, run } = await setup();
    fs.mkdirSync(at('dir'));
    fs.writeFileSync(at('dir', 't.txt'), 't\n');
    run('add', '.');
    run('commit', '-m', 'dir');
    fs.writeFileSync(at('dir', 'privat.txt'), 'geheim\n');
    await call(test, windowId, 'files.rename', { path: at('dir'), newName: 'dir2' });
    const afterDir = await until(
      () => call(test, windowId, 'git.refresh'),
      (s) => s.files.some((f) => f.index === 'R'),
      'Ordner umbenannt',
    );
    expect(afterDir.files.find((f) => f.path === at('dir2', 't.txt'))).toMatchObject({ index: 'R', origPath: at('dir', 't.txt') });
    expect(afterDir.files.find((f) => f.path === at('dir2', 'privat.txt'))).toMatchObject({ index: '?' });

    // a.txt → b2.txt → c2.txt kurz hintereinander: am Ende eine Umbenennung a.txt → c2.txt.
    await call(test, windowId, 'files.rename', { path: at('a.txt'), newName: 'b2.txt' });
    await call(test, windowId, 'files.rename', { path: at('b2.txt'), newName: 'c2.txt' });
    const fast = await until(
      () => call(test, windowId, 'git.refresh'),
      (s) => s.files.some((f) => f.path === at('c2.txt') && f.index === 'R'),
      'zweimal umbenannt',
    );
    expect(fast.files.find((f) => f.path === at('c2.txt'))).toMatchObject({ origPath: at('a.txt') });
    expect(fast.files.some((f) => f.path === at('a.txt'))).toBe(false);
  });

  it('nimmt neu aufgenommene Dateien wieder aus dem Index, wenn ein Hook den Commit ablehnt', async () => {
    const { test, windowId, at, run, repo } = await setup();
    fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "Abgelehnt vom Hook" >&2\nexit 1\n');
    fs.writeFileSync(at('neu.txt'), 'neu\n');
    await call(test, windowId, 'git.refresh');
    await expect(call(test, windowId, 'git.commit', { paths: [at('neu.txt')], message: 'x' })).rejects.toThrow(/Abgelehnt vom Hook/);
    expect(run('status', '--porcelain', '--', 'neu.txt')).toBe('?? neu.txt');
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
