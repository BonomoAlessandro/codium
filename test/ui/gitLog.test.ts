// Teststelle 2: Git-Log mit Graph (Ticket 19), mit einem Temp-Repository und abgeschirmter Git-Konfiguration. Die
// Zwischenablage zeichnet der Testmodus nur auf.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote } from '../support/git';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

function treeItem(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

describe('Git-Log', () => {
  const tempDir = useTempDirs();

  it('zeigt die Commits mit Graph; Auswahl zeigt die Dateien, Doppelklick vergleicht, „Copy Revision Number“ kopiert', async () => {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    const write = (file: string, text: string) => fs.writeFileSync(path.join(repo.repo, file), text);
    write('a.txt', 'eins\n');
    repo.run('add', 'a.txt');
    repo.run('commit', '-m', 'Add a');
    repo.run('switch', '-c', 'side');
    write('side.txt', 's\n');
    repo.run('add', 'side.txt');
    repo.run('commit', '-m', 'Side work');
    repo.run('switch', 'main');
    write('a.txt', 'eins\nzwei\n');
    repo.run('commit', '-am', 'Change a');
    repo.run('merge', '--no-ff', '-m', 'Merge side', 'side');
    const changeA = repo.run('rev-parse', 'HEAD^1');

    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page('repo – Codium');
      await treeItem(page, 'repo').waitFor({ timeout: 15_000 });
      await page.keyboard.press('Alt+9');
      const list = page.getByRole('listbox', { name: 'Commits' });
      await list.getByRole('option', { name: 'Merge side' }).waitFor({ timeout: 15_000 });
      for (const subject of ['Merge side', 'Change a', 'Side work', 'Add a', 'Erster Commit']) {
        expect(await list.getByRole('option', { name: subject }).count()).toBe(1);
      }
      // Mit Graph: ein Punkt je Commit, beim Merge zwei Spuren.
      expect(await list.locator('svg.git-log-graph circle').count()).toBe(5);
      expect(Number(await list.locator('svg.git-log-graph').first().getAttribute('width'))).toBeGreaterThan(14);
      // Etiketten: main (HEAD), side, origin/main.
      expect(await list.getByRole('option', { name: 'Merge side' }).locator('.git-log-ref.head').innerText()).toBe('main');

      // Auswahl: die Dateien des Commits; Doppelklick öffnet die schreibgeschützte Vergleichsansicht.
      await list.getByRole('option', { name: 'Change a' }).click();
      const files = page.getByRole('tree', { name: 'Changed Files' });
      await files.getByRole('treeitem', { name: 'a.txt' }).waitFor({ timeout: 15_000 });
      await files.getByRole('treeitem', { name: 'a.txt' }).dblclick();
      const diff = page.getByRole('region', { name: `Diff a.txt (${changeA.slice(0, 8)})` });
      await diff.waitFor({ timeout: 15_000 });
      await expect.poll(() => diff.locator('.editor.modified .view-lines').innerText(), { timeout: 15_000 }).toContain('zwei');
      expect(await diff.locator('.editor.original .view-lines').innerText()).not.toContain('zwei');

      // „Copy Revision Number“: in die aufgezeichnete Zwischenablage des Testmodus.
      await list.getByRole('option', { name: 'Change a' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy Revision Number' }).click();
      await expect.poll(async () => (await codium.recorded()).filter((e) => e.kind === 'clipboard-write').map((e) => e.detail)).toEqual([{ text: changeA }]);
    } finally {
      await codium.close();
    }
  });
});
