// Teststelle 1: Git-Log mit Graph (Ticket 19): die Graph-Spuren als reine Logik und der Log im Git-Dienst gegen
// Temp-Repositories mit abgeschirmter Git-Konfiguration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogGraph } from '../../src/main/core/git/logGraph';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import type { CommandArgs, CommandName, CommandResult, GitGraphRow, GitLogCommit } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { createRepoWithRemote, git } from '../support/git';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const realGit = new NodeSystem(process.env).findProgram('git')!;

/** Graph für eine Folge (Kinder vor Eltern) als [Hash, Eltern]. */
function graphOf(commits: Array<[string, string[]]>, head?: string): GitGraphRow[] {
  const graph = new LogGraph(head);
  return commits.map(([hash, parents]) => graph.next(hash, parents));
}

describe('Graph-Spuren', () => {
  it('linear: alles in Spalte 0, die letzte Zeile ohne Linie', () => {
    const rows = graphOf([
      ['c', ['b']],
      ['b', ['a']],
      ['a', []],
    ]);
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0]);
    expect(rows[0].lines).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[2].lines).toEqual([]);
  });

  it('Verzweigung: der aktuelle Branch bleibt in Spalte 0, der Seitenzweig rechts mündet ein', () => {
    // main: m2 → base; feature: f1 → base; feature ist neuer und steht zuerst.
    const rows = graphOf(
      [
        ['f1', ['base']],
        ['m2', ['base']],
        ['base', []],
      ],
      'm2',
    );
    expect(rows.map((r) => r.column)).toEqual([1, 0, 0]);
    // Vor m2 zeichnet die reservierte Spur noch nichts.
    expect(rows[0].lines).toEqual([{ from: 1, to: 1, color: 1 }]);
    // m2 übernimmt base in Spalte 0; die Spur von feature biegt dorthin.
    expect(rows[1].lines).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 0, color: 1 },
    ]);
  });

  it('Merge und Octopus-Merge: weitere Elterncommits bekommen eigene Spuren', () => {
    const merge = graphOf([
      ['m', ['a', 'b']],
      ['b', ['root']],
      ['a', ['root']],
      ['root', []],
    ]);
    expect(merge[0]).toEqual({ column: 0, color: 0, lines: [{ from: 0, to: 0, color: 0 }, { from: 0, to: 1, color: 1 }] });
    expect(merge.map((r) => r.column)).toEqual([0, 1, 0, 0]);
    // b mündet in die Spur von a, die root erwartet.
    expect(merge[1].lines).toEqual([{ from: 0, to: 0, color: 0 }, { from: 1, to: 1, color: 1 }]);
    expect(merge[2].lines).toEqual([{ from: 0, to: 0, color: 0 }, { from: 1, to: 0, color: 1 }]);

    const octopus = graphOf([
      ['o', ['a', 'b', 'c']],
      ['c', ['root']],
      ['b', ['root']],
      ['a', ['root']],
      ['root', []],
    ]);
    expect(octopus[0].lines.map((l) => [l.from, l.to])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(octopus.map((r) => r.column)).toEqual([0, 2, 1, 0, 0]);
  });

  it('mehrere Wurzeln: zwei unabhängige Geschichten nebeneinander, freie Spalten werden wieder belegt', () => {
    const rows = graphOf([
      ['x2', ['x1']],
      ['y2', ['y1']],
      ['x1', []],
      ['y1', []],
      ['z', []],
    ]);
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0, 1, 0]);
    expect(rows[2].lines).toEqual([{ from: 1, to: 1, color: 1 }]);
    expect(rows[3].lines).toEqual([]);
  });
});

describe('Graph-Spuren (Zufallsprüfung)', () => {
  it('jede Linie kommt an, jede Spur kommt von oben, jeder Elterncommit ist verbunden', () => {
    let seed = 19;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 1500; round++) {
      // Zufälliger Graph: Commit i hat Eltern unter den älteren (höheren Nummern), manchmal keine (Wurzel).
      const count = 2 + random(25);
      const commits: Array<[string, string[]]> = [];
      for (let i = 0; i < count; i++) {
        const older = count - i - 1;
        const parents = new Set<string>();
        const n = older === 0 || random(8) === 0 ? 0 : 1 + (random(5) === 0 ? 1 + random(2) : 0);
        for (let k = 0; k < n; k++) parents.add(`c${i + 1 + random(older)}`);
        commits.push([`c${i}`, [...parents]]);
      }
      const rows = graphOf(commits, random(2) === 0 ? 'c0' : undefined);
      const children = new Set(commits.flatMap(([, parents]) => parents));
      rows.forEach((row, i) => {
        const incoming = i === 0 ? new Set<number>() : new Set(rows[i - 1].lines.map((l) => l.to));
        // Jede Linie von oben endet am Punkt oder an einer Spur, die weiterläuft.
        const sources = new Set([row.column, ...row.lines.map((l) => l.from)]);
        for (const to of incoming) expect(sources.has(to)).toBe(true);
        // Jede weiterlaufende Spur kommt von oben.
        for (const l of row.lines) if (l.from !== row.column) expect(incoming.has(l.from)).toBe(true);
        // Ein Commit mit Kind im Log bekommt eine Linie von oben.
        expect(incoming.has(row.column)).toBe(children.has(commits[i][0]));
        // Je Elterncommit eine Linie vom Punkt.
        expect(row.lines.filter((l) => l.from === row.column).length).toBe(commits[i][1].length);
      });
    }
  });
});

describe('Log im Git-Dienst', { timeout: 60_000 }, () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function setup(prepare?: (run: (...a: string[]) => string, repo: string, env: NodeJS.ProcessEnv) => void) {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    prepare?.(repo.run, repo.repo, repo.env);
    const test = createTestCore(path.join(base, 'data'), { system: { programs: { git: realGit }, home: path.join(base, 'home') }, processEnv: repo.env });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: repo.repo });
    const windowId = test.ports.windows.windowTitled('repo – Codium');
    await call(test, windowId, 'git.state');
    return { ...repo, test, windowId, at: (...p: string[]) => path.join(repo.repo, ...p) };
  }

  function commit(run: (...a: string[]) => string, repo: string, file: string, text: string, message: string, author?: string) {
    fs.writeFileSync(path.join(repo, file), text);
    run('add', file);
    run(...(author ? ['-c', `user.name=${author}`, '-c', `user.email=${author.toLowerCase()}@test.invalid`] : []), 'commit', '-m', message);
  }

  /** Viele Commits auf einmal (fast-import statt hunderter Aufrufe). */
  function manyCommits(repo: string, env: NodeJS.ProcessEnv, count: number) {
    const lines: string[] = [];
    for (let i = 1; i <= count; i++) {
      const data = `datei ${i}\n`;
      const msg = `Commit ${i}`;
      lines.push('commit refs/heads/main', `committer Codium Test <test@codium.invalid> ${1700000000 + i} +0000`, `data ${Buffer.byteLength(msg)}`, msg);
      if (i === 1) lines.push('from refs/heads/main^0');
      lines.push(`M 100644 inline f${i % 50}.txt`, `data ${Buffer.byteLength(data)}`, data);
      // Ab und zu ein Seitenzweig mit Merge, damit der Graph mehr als eine Spur hat.
      if (i % 97 === 0) {
        lines.push(`commit refs/heads/side${i}`, `committer Codium Test <test@codium.invalid> ${1700000000 + i} +0000`, 'data 4', 'side', 'from refs/heads/main', `M 100644 inline s${i}.txt`, 'data 2', 's', '');
        lines.push('commit refs/heads/main', `committer Codium Test <test@codium.invalid> ${1700000000 + i} +0000`, 'data 5', 'merge', `merge refs/heads/side${i}`, '');
      }
    }
    execInput(repo, env, ['fast-import', '--quiet'], lines.join('\n') + '\n');
    git(repo, env, 'reset', '--hard', '--quiet');
  }

  it('liest Seiten aus einem laufenden Prozess; über die Seitengrenze ist der Graph wie in einem Stück', async () => {
    const { test, windowId, repo, env, run } = await setup((r, dir, e) => manyCommits(dir, e, 700));
    const git = test.core.projectCore(windowId)!.git;
    const first = await call(test, windowId, 'git.log', { filter: {}, offset: 0 });
    expect(first.commits).toHaveLength(500);
    expect(first.done).toBe(false);
    expect(first.graph).toBe(true);
    const second = await call(test, windowId, 'git.log', { filter: {}, offset: 500 });
    expect(second.version).toBe(first.version);
    expect(git.logProcessesStarted).toBe(1);
    const all = [...first.commits, ...second.commits];
    expect(second.done).toBe(true);
    expect(all.length).toBe(Number(run('rev-list', '--all', '--count')));
    // Dieselbe Berechnung in einem Stück.
    const head = run('rev-parse', 'HEAD');
    const whole = graphOf(all.map((c): [string, string[]] => [c.hash, c.parents]), head);
    expect(all.map((c) => c.graph)).toEqual(whole);
    // Der aktuelle Branch (main) liegt in Spalte 0.
    const mainChain = run('rev-list', '--first-parent', 'HEAD').split('\n');
    const byHash = new Map(all.map((c) => [c.hash, c]));
    expect(mainChain.every((h) => byHash.get(h)?.graph?.column === 0)).toBe(true);

    // Geänderte Refs: ein neuer Prozess, eine neue Version.
    commit(run, repo, 'neu.txt', 'neu\n', 'Neu');
    const after = await call(test, windowId, 'git.log', { filter: {}, offset: 0 });
    expect(after.version).not.toBe(first.version);
    expect(after.commits[0].subject).toBe('Neu');
    expect(git.logProcessesStarted).toBe(2);
  });

  it('filtert nach Text, Hash-Anfang, Branch und Autor; mit Text oder Autor ohne Graph', async () => {
    const { test, windowId, run, repo } = await setup((r, dir) => {
      commit(r, dir, 'a.txt', 'a\n', 'Fix the parser', 'Alice');
      r('switch', '-c', 'feature');
      commit(r, dir, 'b.txt', 'b\n', 'Add feature', 'Bob');
      r('switch', 'main');
      commit(r, dir, 'c.txt', 'c\n', 'Update docs\n\nMentions the PARSER in the body.', 'Alice');
    });
    const subjects = async (filter: object) => (await call(test, windowId, 'git.log', { filter, offset: 0 })).commits.map((c: GitLogCommit) => c.subject);
    expect(await subjects({ text: 'parser' })).toEqual(['Update docs', 'Fix the parser']);
    const hash = run('rev-parse', 'feature');
    expect(await subjects({ text: hash.slice(0, 7) })).toEqual(['Add feature']);
    expect(await subjects({ author: 'bob' })).toEqual(['Add feature']);
    expect(await subjects({ branch: 'feature' })).toEqual(['Add feature', 'Fix the parser', 'Erster Commit']);
    const textPage = await call(test, windowId, 'git.log', { filter: { text: 'parser' }, offset: 0 });
    expect(textPage.graph).toBe(false);
    expect(textPage.commits.every((c) => c.graph === undefined)).toBe(true);
    expect((await call(test, windowId, 'git.log', { filter: { author: 'alice' }, offset: 0 })).graph).toBe(false);
    expect((await call(test, windowId, 'git.log', { filter: { branch: 'feature' }, offset: 0 })).graph).toBe(true);
    // Etiketten: HEAD auf main, lokaler Branch, Remote-Branch.
    const all = (await call(test, windowId, 'git.log', { filter: {}, offset: 0 })).commits;
    expect(all.find((c) => c.subject === 'Update docs')!.refs).toEqual([{ name: 'main', kind: 'head' }]);
    expect(all.find((c) => c.subject === 'Add feature')!.refs).toEqual([{ name: 'feature', kind: 'local' }]);
    expect(all.find((c) => c.subject === 'Erster Commit')!.refs).toEqual([{ name: 'origin/main', kind: 'remote' }]);
    await expect(call(test, windowId, 'git.log', { filter: { branch: '--output=x' }, offset: 0 })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(repo).toBeTruthy();
  });

  it('liefert Details und Dateien, beim Merge gegen den ersten Elterncommit; Checkout Revision, New Branch, Copy', async () => {
    const { test, windowId, run, repo, at } = await setup((r, dir) => {
      commit(r, dir, 'a.txt', 'a\n', 'a');
      r('switch', '-c', 'side');
      commit(r, dir, 'side.txt', 's\n', 'side');
      r('switch', 'main');
      commit(r, dir, 'main.txt', 'm\n', 'main');
      r('merge', '--no-ff', '-m', 'Merge side', 'side');
      r('mv', 'a.txt', 'b.txt');
      r('commit', '-m', 'Rename\n\nWith a body.');
    });
    const rename = await call(test, windowId, 'git.commitDetails', { hash: run('rev-parse', 'HEAD') });
    expect(rename.message).toBe('Rename\n\nWith a body.');
    expect(rename.files).toEqual([{ status: 'R', origRepoPath: 'a.txt', repoPath: 'b.txt', path: at('b.txt') }]);
    const merge = await call(test, windowId, 'git.commitDetails', { hash: run('rev-parse', 'HEAD~1') });
    expect(merge.parents).toHaveLength(2);
    expect(merge.files.map((f) => [f.status, f.repoPath])).toEqual([['A', 'side.txt']]);
    const root = await call(test, windowId, 'git.commitDetails', { hash: run('rev-list', '--max-parents=0', 'HEAD') });
    expect(root.files.map((f) => [f.status, f.repoPath])).toEqual([['A', 'README.md']]);
    // Inhalt aus der Historie.
    expect(await call(test, windowId, 'git.commitFile', { hash: run('rev-parse', 'HEAD~1'), repoPath: 'a.txt' })).toEqual({ exists: true, text: 'a\n' });
    await expect(call(test, windowId, 'git.commitFile', { hash: 'abcd', repoPath: '../x' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

    const target = run('rev-parse', 'HEAD~2');
    await call(test, windowId, 'git.copyRevision', { hash: target.slice(0, 8) });
    expect(test.ports.shell.clipboard).toBe(target);
    await call(test, windowId, 'git.createBranch', { name: 'from-commit', from: target, checkout: false });
    expect(run('rev-parse', 'from-commit')).toBe(target);
    await call(test, windowId, 'git.checkoutRevision', { hash: target });
    const state = await call(test, windowId, 'git.state');
    expect(state.branch).toBeNull();
    expect(state.detached).toBe(target.slice(0, state.detached!.length));
    await expect(call(test, windowId, 'git.checkoutRevision', { hash: '--detach' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(repo).toBeTruthy();
  });

  it('lädt nach einem Wechsel auf einen Branch desselben Commits neu; Stash und Notes gehören nicht in den Log', async () => {
    const { test, windowId, run, repo } = await setup((r, dir) => {
      commit(r, dir, 'a.txt', 'a\n', 'a');
    });
    const first = await call(test, windowId, 'git.log', { filter: {}, offset: 0 });
    expect(first.commits[0].refs).toContainEqual({ name: 'main', kind: 'head' });
    test.events.sent.length = 0;
    await call(test, windowId, 'git.createBranch', { name: 'other', checkout: true });
    expect(test.events.sent.some((e) => e.name === 'git.refsChanged')).toBe(true);
    const after = await call(test, windowId, 'git.log', { filter: {}, offset: 0 });
    expect(after.version).not.toBe(first.version);
    expect(after.commits[0].refs).toContainEqual({ name: 'other', kind: 'head' });
    expect(after.commits[0].refs).toContainEqual({ name: 'main', kind: 'local' });

    // Stash und Notes: nicht im Log.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'geändert\n');
    run('stash');
    run('notes', 'add', '-m', 'Eine Notiz');
    const subjects = (await call(test, windowId, 'git.log', { filter: {}, offset: 0 })).commits.map((c) => c.subject);
    expect(subjects).toEqual(['a', 'Erster Commit']);
  });

  it('beendet den Log-Prozess mit dem Fenster und meldet geänderte Refs', async () => {
    const { test, windowId, run, repo } = await setup((r, dir, e) => manyCommits(dir, e, 600));
    await call(test, windowId, 'git.log', { filter: {}, offset: 0 });
    test.events.sent.length = 0;
    run('branch', 'neu');
    await call(test, windowId, 'git.refresh');
    expect(test.events.sent.some((e) => e.name === 'git.refsChanged')).toBe(true);
    const service = test.core.projectCore(windowId)!.git as unknown as { logSession: { reader: { exited: Promise<{ code: number | null }> } } | null };
    const exited = service.logSession!.reader.exited;
    test.ports.windows.close(windowId);
    await test.core.disposalsSettled();
    expect(service.logSession).toBeNull();
    // Der Prozess (mit noch ungelesener Ausgabe) ist wirklich beendet.
    await exited;
    expect(repo).toBeTruthy();
  });
});

function execInput(cwd: string, env: NodeJS.ProcessEnv, args: string[], input: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync('git', args, { cwd, env, input, stdio: ['pipe', 'pipe', 'pipe'] });
}
