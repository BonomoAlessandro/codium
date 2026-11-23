// Teststelle 1: Inhalt einer Datei in einem Commit und Änderungsblöcke (Ticket 17), gegen Temp-Repositories mit
// abgeschirmter Git-Konfiguration; dazu die reine Zeilen-Diff-Logik.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { changeBlocks } from '../../src/main/core/git/lineDiff';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import type { CommandArgs, CommandName, CommandResult } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { createRepoWithRemote } from '../support/git';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const realGit = new NodeSystem(process.env).findProgram('git')!;

describe('Zeilen-Diff', () => {
  it('findet geänderte, eingefügte und gelöschte Zeilen, auch am Anfang und am Ende', () => {
    const old = 'a\nb\nc\nd\ne\n';
    expect(changeBlocks(old, old)).toEqual([]);
    expect(changeBlocks(old, 'a\nB\nc\nd\ne\n')).toEqual([{ kind: 'modified', line: 2, count: 1, oldLines: ['b'] }]);
    expect(changeBlocks(old, 'neu\na\nb\nc\nd\ne\n')).toEqual([{ kind: 'added', line: 1, count: 1, oldLines: [] }]);
    expect(changeBlocks(old, 'a\nb\nc\nd\ne\nx\ny\n')).toEqual([{ kind: 'added', line: 6, count: 2, oldLines: [] }]);
    expect(changeBlocks(old, 'b\nc\nd\ne\n')).toEqual([{ kind: 'deleted', line: 1, count: 0, oldLines: ['a'] }]);
    expect(changeBlocks(old, 'a\nb\nc\nd\n')).toEqual([{ kind: 'deleted', line: 5, count: 0, oldLines: ['e'] }]);
    expect(changeBlocks(old, 'a\nX\nc\ne\nf\n')).toEqual([
      { kind: 'modified', line: 2, count: 1, oldLines: ['b'] },
      { kind: 'deleted', line: 4, count: 0, oldLines: ['d'] },
      { kind: 'added', line: 5, count: 1, oldLines: [] },
    ]);
    // Ohne Rücksicht auf das Zeilenende.
    expect(changeBlocks(old, 'a\r\nb\r\nc\r\nd\r\ne\r\n')).toEqual([]);
    expect(changeBlocks('', 'x\n')).toEqual([{ kind: 'added', line: 1, count: 1, oldLines: [] }]);
  });

  it('ergibt Blöcke, aus denen sich der alte Text wiederherstellen lässt (Zufallsprüfung)', () => {
    let seed = 17;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 2000; round++) {
      const a = Array.from({ length: random(12) }, () => 'abcd'[random(4)]);
      const b = Array.from({ length: random(12) }, () => 'abcd'[random(4)]);
      const blocks = changeBlocks(a.map((l) => `${l}\n`).join(''), b.map((l) => `${l}\n`).join(''));
      const rebuilt = [...b];
      for (const block of [...blocks].reverse()) rebuilt.splice(block.line - 1, block.count, ...block.oldLines);
      expect(rebuilt).toEqual(a);
    }
  });

  it('bleibt bei einer stark geänderten Datei schnell (Review von Ticket 17)', () => {
    const old = Array.from({ length: 6000 }, (_, i) => `zeile ${i}`).join('\n');
    const changed = Array.from({ length: 6000 }, (_, i) => (i % 3 === 0 ? `neu ${i}` : `zeile ${i}`)).join('\n');
    const start = performance.now();
    const blocks = changeBlocks(old, changed);
    expect(performance.now() - start).toBeLessThan(150);
    expect(blocks.length).toBeGreaterThan(0);
  });
});

describe('Vergleichsstand im Git-Dienst', { timeout: 60_000 }, () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function setup(configure?: (run: (...a: string[]) => string, repo: string) => void) {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    configure?.(repo.run, repo.repo);
    const test = createTestCore(path.join(base, 'data'), { system: { programs: { git: realGit }, home: path.join(base, 'home') }, processEnv: repo.env });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: repo.repo });
    const windowId = test.ports.windows.windowTitled('repo – Codium');
    await call(test, windowId, 'git.state');
    return { ...repo, test, windowId, at: (...p: string[]) => path.join(repo.repo, ...p) };
  }

  it('liefert den Inhalt im letzten Commit, in einem älteren und „nicht vorhanden“', async () => {
    const { test, windowId, at, run } = await setup();
    fs.writeFileSync(at('a.txt'), 'eins\n');
    run('add', 'a.txt');
    run('commit', '-m', 'eins');
    const first = run('rev-parse', 'HEAD');
    fs.writeFileSync(at('a.txt'), 'zwei\n');
    run('commit', '-am', 'zwei');
    expect(await call(test, windowId, 'git.fileAtCommit', { path: at('a.txt') })).toEqual({ exists: true, text: 'zwei\n' });
    expect(await call(test, windowId, 'git.fileAtCommit', { path: at('a.txt'), commit: first })).toEqual({ exists: true, text: 'eins\n' });
    expect(await call(test, windowId, 'git.fileAtCommit', { path: at('gibt-es-nicht.txt') })).toEqual({ exists: false, text: '' });
    await expect(call(test, windowId, 'git.fileAtCommit', { path: at('a.txt'), commit: '--output=x' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('berechnet Blöcke zum aktuellen Text; nach einem Commit ändert sich der Vergleichsstand', async () => {
    const { test, windowId, at, run } = await setup((r, repo) => {
      fs.writeFileSync(path.join(repo, 'b.txt'), 'a\nb\nc\n');
      r('add', 'b.txt');
      r('commit', '-m', 'b');
    });
    expect(await call(test, windowId, 'git.changes', { path: at('b.txt'), text: 'a\nb\nc\n' })).toEqual([]);
    expect(await call(test, windowId, 'git.changes', { path: at('b.txt'), text: 'a\nB\nc\n' })).toEqual([{ kind: 'modified', line: 2, count: 1, oldLines: ['b'] }]);
    fs.writeFileSync(at('b.txt'), 'a\nB\nc\n');
    run('commit', '-am', 'B');
    await call(test, windowId, 'git.refresh');
    expect(await call(test, windowId, 'git.changes', { path: at('b.txt'), text: 'a\nB\nc\n' })).toEqual([]);
    // Nicht versioniert: keine Blöcke; neu im Index: alles hinzugefügt.
    fs.writeFileSync(at('neu.txt'), 'x\n');
    expect(await call(test, windowId, 'git.changes', { path: at('neu.txt'), text: 'x\n' })).toEqual([]);
    run('add', 'neu.txt');
    await call(test, windowId, 'git.refresh');
    expect(await call(test, windowId, 'git.changes', { path: at('neu.txt'), text: 'x\n' })).toEqual([{ kind: 'added', line: 1, count: 1, oldLines: [] }]);
  });

  it('kennt Zeilenende-Umwandlung und Windows-1252: unveränderte Dateien haben keine Blöcke', async () => {
    const { test, windowId, at } = await setup((r, repo) => {
      // Im Repository LF, im Arbeitsordner CRLF (core.autocrlf=true).
      r('config', 'core.autocrlf', 'true');
      fs.writeFileSync(path.join(repo, 'crlf.txt'), 'eins\r\nzwei\r\n');
      // Windows-1252 mit Umlauten.
      fs.writeFileSync(path.join(repo, 'ansi.txt'), Buffer.from([0x47, 0x72, 0xfc, 0x73, 0x73, 0x65, 0x20, 0xe4, 0x0a]));
      r('add', '.');
      r('commit', '-m', 'Kodierungen');
    });
    expect((await call(test, windowId, 'git.fileAtCommit', { path: at('crlf.txt') })).text).toBe('eins\r\nzwei\r\n');
    expect(await call(test, windowId, 'git.changes', { path: at('crlf.txt'), text: 'eins\r\nzwei\r\n' })).toEqual([]);
    const ansi = await call(test, windowId, 'files.read', { path: at('ansi.txt') });
    expect(ansi.kind === 'text' && ansi.text).toBe('Grüsse ä\n');
    expect(await call(test, windowId, 'git.changes', { path: at('ansi.txt'), text: 'Grüsse ä\n', encoding: 'windows-1252' })).toEqual([]);
  });

  it('dekodiert mit der Kodierung der Arbeitsdatei; Binärinhalt ergibt keine Blöcke', async () => {
    const { test, windowId, at } = await setup((r, repo) => {
      // Gültiges UTF-8 („Ã¤“ in Windows-1252), die Arbeitsdatei ist aber Windows-1252.
      fs.writeFileSync(path.join(repo, 'w.txt'), Buffer.from([0xc3, 0xa4, 0x0a]));
      fs.writeFileSync(path.join(repo, 'bild.bin'), Buffer.from([0x00, 0x01, 0x02]));
      r('add', '.');
      r('commit', '-m', 'w');
    });
    expect((await call(test, windowId, 'git.fileAtCommit', { path: at('w.txt'), encoding: 'windows-1252' })).text).toBe('Ã¤\n');
    expect(await call(test, windowId, 'git.changes', { path: at('w.txt'), text: 'Ã¤\n', encoding: 'windows-1252' })).toEqual([]);
    expect(await call(test, windowId, 'git.fileAtCommit', { path: at('bild.bin') })).toEqual({ exists: true, text: '', binary: true });
    expect(await call(test, windowId, 'git.changes', { path: at('bild.bin'), text: 'x\n' })).toEqual([]);
    await expect(call(test, windowId, 'git.changes', { path: at('w.txt'), text: '', encoding: 'latin9' as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });
});
