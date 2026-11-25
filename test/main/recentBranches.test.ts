// Zuletzt benutzte Branches aus dem Reflog von HEAD (Ticket 31): reine Funktionen, ohne Git.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readReflogTail } from '../../src/main/core/git/gitService';
import { RECENT_LIMIT, recentBranches, reflogMessages } from '../../src/main/core/git/recentBranches';
import { useTempDirs } from '../support/tempDir';

/** Die Nachricht eines Wechsels, wie Git sie bei `checkout` und `switch` schreibt. */
const moved = (from: string, to: string) => `checkout: moving from ${from} to ${to}`;
const DETACHED = '3f2a9c1d7e5b4a6f8c0d2e4f6a8b0c1d2e3f4a5b';

describe('Zuletzt benutzte Branches', () => {
  it('nimmt die verlassenen Branches, den neuesten zuerst, ohne den aktuellen', () => {
    // main → feature/a → bugfix/c → main (neueste Nachricht zuerst, wie im Reflog von unten gelesen)
    const messages = [moved('bugfix/c', 'main'), moved('feature/a', 'bugfix/c'), moved('main', 'feature/a')];
    expect(recentBranches(messages, ['main', 'feature/a', 'bugfix/c'], 'main')).toEqual(['bugfix/c', 'feature/a']);
  });

  it('zeigt höchstens fünf', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    // g ist aktuell; vorher der Reihe nach a bis f.
    const messages = names.slice(1).map((to, i) => moved(names[i], to)).reverse();
    expect(RECENT_LIMIT).toBe(5);
    expect(recentBranches(messages, names, 'g')).toEqual(['f', 'e', 'd', 'c', 'b']);
  });

  it('lässt gelöschte Branches weg; dafür rücken ältere nach', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const messages = names.slice(1).map((to, i) => moved(names[i], to)).reverse();
    expect(recentBranches(messages, ['a', 'b', 'c', 'e', 'g'], 'g')).toEqual(['e', 'c', 'b', 'a']);
    expect(recentBranches(messages, ['g'], 'g')).toEqual([]);
  });

  it('zählt losgelöste Stände nicht, auch nicht einen Branch, der nur losgelöst ausgecheckt war', () => {
    const messages = [
      moved(DETACHED, 'main'),
      // `git checkout --detach feature/a`: Git nennt den Branch, HEAD hängt aber an keinem.
      moved('bugfix/c', 'feature/a'),
      moved('main', 'bugfix/c'),
    ];
    expect(recentBranches(messages, ['main', 'feature/a', 'bugfix/c'], 'main')).toEqual(['bugfix/c']);
    // Ein kurzer Hash, auf den gewechselt wurde, ist ebenfalls kein Branch.
    expect(recentBranches([moved('3f2a9c1', 'main'), moved('main', '3f2a9c1')], ['main'], 'main')).toEqual([]);
  });

  it('führt doppelte Wechsel nur einmal, an der neuesten Stelle', () => {
    const messages = [moved('a', 'main'), moved('b', 'a'), moved('a', 'b'), moved('main', 'a'), moved('a', 'main')];
    expect(recentBranches(messages, ['main', 'a', 'b'], 'main')).toEqual(['a', 'b']);
  });

  it('übergeht andere Einträge (Commits, Rebase, Reset, Umbenennen) und Fremdes', () => {
    const messages = [
      'commit: Neue Funktion',
      'rebase (finish): returning to refs/heads/feature/a',
      'rebase (pick): Etwas',
      'rebase (start): checkout main',
      moved('bugfix/c', 'feature/a'),
      'reset: moving to HEAD~1',
      'Branch: renamed refs/heads/alt to refs/heads/bugfix/c',
      'commit (amend): Korrektur',
      moved('main', 'alt'),
      '',
      'checkout: moving from  to main',
    ];
    expect(recentBranches(messages, ['main', 'feature/a', 'bugfix/c'], 'feature/a')).toEqual(['bugfix/c', 'main']);
  });

  it('zeigt bei abgekoppeltem HEAD oder ohne Commit alle verlassenen Branches', () => {
    const messages = [moved('main', DETACHED), moved('feature/a', 'main')];
    expect(recentBranches(messages, ['main', 'feature/a'], null)).toEqual(['main', 'feature/a']);
  });

  it('liest die Nachrichten aus dem Reflog, die neueste zuerst', () => {
    const line = (message: string, time: number) =>
      `${'1'.repeat(40)} ${'2'.repeat(40)} Codium Test <test@codium.invalid> ${time} +0100\t${message}\n`;
    const text = line('commit (initial): Erster Commit', 1) + line(moved('main', 'feature/a'), 2) + line(moved('feature/a', 'main'), 3);
    expect(reflogMessages(text)).toEqual([moved('feature/a', 'main'), moved('main', 'feature/a'), 'commit (initial): Erster Commit']);
    // Eine Zeile, die Git gerade noch schreibt (ohne Zeilenende), zählt noch nicht; Zeilenenden von Windows stören nicht.
    expect(reflogMessages(`${line('commit: a', 1).replace('\n', '\r\n')}${line(moved('a', 'b'), 2).slice(0, -5)}`)).toEqual(['commit: a']);
    expect(reflogMessages('')).toEqual([]);
  });
});

describe('Ende des Reflogs', () => {
  const tempDir = useTempDirs();
  const line = (message: string) => `${'1'.repeat(40)} ${'2'.repeat(40)} Codium Test <test@codium.invalid> 1700000000 +0100\t${message}\n`;

  it('liest nur die letzten Bytes, ab der ersten vollständigen Zeile', async () => {
    const file = path.join(tempDir(), 'HEAD');
    const commits = Array.from({ length: 4000 }, (_, i) => line(`commit: Änderung ${i}`)).join('');
    fs.writeFileSync(file, line(moved('alt', 'main')) + commits + line(moved('feature/grösse', 'main')));
    const messages = await readReflogTail(file, 64 * 1024);
    expect(messages[0]).toBe(moved('feature/grösse', 'main'));
    expect(messages).not.toContain(moved('alt', 'main'));
    expect(messages.length).toBeLessThan(1000);
    // Jede gelesene Zeile ist vollständig; der Schnitt liegt nie mitten in einer Zeile oder einem Zeichen.
    expect(messages.slice(1).every((m) => /^commit: Änderung \d+$/.test(m))).toBe(true);

    // Ohne Grenze kommt alles.
    expect(await readReflogTail(file, 10 * 1024 * 1024)).toHaveLength(4002);
  });
});
