// Teststelle 2: Vergleichsansicht und Änderungsbalken (Ticket 17), mit einem Temp-Repository und abgeschirmter
// Git-Konfiguration.

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

function changesItem(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Changes' }).getByRole('treeitem', { name, exact: true });
}

describe('Vergleich und Änderungsbalken', () => {
  const tempDir = useTempDirs();

  async function launch() {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    fs.writeFileSync(path.join(repo.repo, 'a.txt'), 'eins\nzwei\ndrei\n');
    repo.run('add', 'a.txt');
    repo.run('commit', '-m', 'a');
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page('repo – Codium');
    await treeItem(page, 'repo').waitFor({ timeout: 15_000 });
    return { ...repo, codium, page, file: path.join(repo.repo, 'a.txt') };
  }

  it('öffnet per Doppelklick in der Änderungsansicht den Vergleich; die rechte Seite speichert die Datei', async () => {
    const { codium, page, file } = await launch();
    try {
      fs.writeFileSync(file, 'eins\nZWEI\ndrei\n');
      await page.keyboard.press('Alt+0');
      await changesItem(page, 'a.txt').waitFor({ timeout: 15_000 });
      await changesItem(page, 'a.txt').dblclick();
      const diff = page.getByRole('region', { name: 'Diff a.txt (Diff)' });
      await diff.waitFor({ timeout: 15_000 });
      const original = diff.locator('.editor.original .view-lines');
      const modified = diff.locator('.editor.modified .view-lines');
      await expect.poll(() => original.innerText(), { timeout: 15_000 }).toContain('zwei');
      await expect.poll(() => modified.innerText(), { timeout: 15_000 }).toContain('ZWEI');
      expect(await page.getByRole('tab', { name: /a\.txt \(Diff\)/ }).count()).toBe(1);

      // Rechts tippen: Die Datei wird gespeichert.
      await modified.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('vier');
      await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('eins\nZWEI\ndrei\nvier');

      // Ein zugleich offener Datei-Tab zeigt denselben Text.
      await page.keyboard.press('Alt+1');
      await treeItem(page, 'a.txt').dblclick();
      await expect.poll(() => page.locator('.editor-host .view-lines').innerText(), { timeout: 15_000 }).toContain('vier');
      // Schliesst der Vergleich, bleibt der Datei-Tab offen.
      await page.getByRole('tab', { name: /a\.txt \(Diff\)/ }).click({ button: 'middle' });
      await expect.poll(() => page.getByRole('tab', { name: /a\.txt \(Diff\)/ }).count()).toBe(0);
      expect(await page.getByRole('tab', { name: /^a\.txt/ }).count()).toBe(1);
    } finally {
      await codium.close();
    }
  });

  it('schliesst einen Vergleich ohne Datei-Tab sauber; „Show Diff“ vergleicht neue Dateien gegen leer', async () => {
    const { codium, page, file, repo } = await launch();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      fs.writeFileSync(file, 'eins\nZWEI\ndrei\n');
      fs.writeFileSync(path.join(repo, 'neu.txt'), 'ganz neu\n');
      await page.keyboard.press('Alt+0');
      await changesItem(page, 'a.txt').waitFor({ timeout: 15_000 });
      await changesItem(page, 'a.txt').dblclick();
      const diffTab = page.getByRole('tab', { name: /a\.txt \(Diff\)/ });
      await diffTab.waitFor({ timeout: 15_000 });
      await expect.poll(() => page.locator('.diff-host .editor.modified .view-lines').innerText(), { timeout: 15_000 }).toContain('ZWEI');
      // Die Datei hat nur den unsichtbaren Tab: Mit dem Vergleich schliesst sie, ohne Fehler in der Seite.
      await diffTab.click({ button: 'middle' });
      await expect.poll(() => diffTab.count()).toBe(0);
      expect(await page.getByRole('tab', { name: /^a\.txt/ }).count()).toBe(0);

      await page.getByRole('tree', { name: 'Changes' }).getByRole('treeitem', { name: 'neu.txt', exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Show Diff' }).click();
      const diff = page.getByRole('region', { name: 'Diff neu.txt (Diff)' });
      await diff.waitFor({ timeout: 15_000 });
      await expect.poll(() => diff.locator('.editor.modified .view-lines').innerText().then((t) => t.replace(/\u00a0/g, ' ')), { timeout: 15_000 }).toContain('ganz neu');
      expect((await diff.locator('.editor.original .view-lines').innerText()).trim()).toBe('');
      await page.waitForTimeout(500);
      expect(errors).toEqual([]);
    } finally {
      await codium.close();
    }
  });

  it('zeigt nach dem Tippen einen Änderungsbalken; „Rollback Lines“ stellt den Block wieder her', async () => {
    const { codium, page, file } = await launch();
    try {
      await treeItem(page, 'a.txt').dblclick();
      const lines = page.locator('.editor-host .view-lines');
      await expect.poll(() => lines.innerText(), { timeout: 15_000 }).toContain('zwei');
      await page.locator('.editor-host .view-line', { hasText: 'zwei' }).click();
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      const bar = page.locator('.editor-host .change-bar.modified');
      await bar.first().waitFor({ timeout: 15_000 });
      await bar.first().click();
      const popup = page.getByRole('dialog', { name: 'Change' });
      await popup.waitFor();
      expect(await popup.getByLabel('Previous Content').innerText()).toBe('zwei');
      await popup.getByRole('button', { name: 'Rollback Lines' }).click();
      await expect.poll(() => lines.innerText()).not.toContain('zwei!');
      await expect.poll(() => bar.count(), { timeout: 15_000 }).toBe(0);
      await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('eins\nzwei\ndrei\n');
    } finally {
      await codium.close();
    }
  });
});
