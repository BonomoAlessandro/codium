// Teststelle 2: Werkzeugfenster „Commit“ und Git-Farben im Dateibaum (Ticket 16), mit einem Temp-Repository und
// abgeschirmter Git-Konfiguration.

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

describe('Commit', () => {
  const tempDir = useTempDirs();

  async function launch() {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    fs.writeFileSync(path.join(repo.repo, 'a.txt'), 'original\n');
    repo.run('add', 'a.txt');
    repo.run('commit', '-m', 'a');
    fs.writeFileSync(path.join(repo.repo, 'a.txt'), 'geändert\n');
    fs.writeFileSync(path.join(repo.repo, 'neu.txt'), 'neu\n');
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page('repo – Codium');
    await treeItem(page, 'repo').waitFor({ timeout: 15_000 });
    return { ...repo, codium, page };
  }

  it('zeigt Änderungen in den Gruppen, committet die angehakte und lässt die neue Datei stehen', async () => {
    const { codium, page, run } = await launch();
    try {
      await page.keyboard.press('Alt+0');
      await changesItem(page, 'a.txt').waitFor({ timeout: 15_000 });
      const changes = page.getByRole('group', { name: 'Changes', exact: true });
      const unversioned = page.getByRole('group', { name: 'Unversioned Files' });
      expect(await changes.getByRole('treeitem', { name: 'a.txt' }).count()).toBe(1);
      expect(await unversioned.getByRole('treeitem', { name: 'neu.txt' }).count()).toBe(1);
      expect(await page.getByRole('checkbox', { name: 'Include a.txt' }).isChecked()).toBe(true);
      expect(await page.getByRole('checkbox', { name: 'Include neu.txt' }).isChecked()).toBe(false);

      // Ohne Nachricht ist „Commit“ inaktiv.
      const commit = page.locator('section[aria-label="Commit"]').getByRole('button', { name: 'Commit', exact: true });
      expect(await commit.isDisabled()).toBe(true);
      await page.getByRole('textbox', { name: 'Commit Message' }).fill('a geändert');
      expect(await commit.isDisabled()).toBe(false);
      await commit.click();
      await expect.poll(() => changesItem(page, 'a.txt').count(), { timeout: 15_000 }).toBe(0);
      expect(await changesItem(page, 'neu.txt').count()).toBe(1);
      expect(run('log', '-1', '--format=%s')).toBe('a geändert');
    } finally {
      await codium.close();
    }
  });

  it('öffnet mit Ctrl + K aus dem Editor die Änderungsansicht mit dem Fokus in der Nachricht', async () => {
    const { codium, page } = await launch();
    try {
      await treeItem(page, 'a.txt').dblclick();
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.press('Control+k');
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Commit Message');
      expect(await changesItem(page, 'a.txt').isVisible()).toBe(true);
    } finally {
      await codium.close();
    }
  });

  it('setzt mit „Rollback…“ nach Rückfrage den alten Inhalt zurück; der Dateibaum färbt die Dateien', async () => {
    const { codium, page, repo } = await launch();
    try {
      // Farben im Dateibaum: geändert blau, nicht versioniert rotbraun.
      await expect.poll(() => treeItem(page, 'a.txt').getAttribute('data-git'), { timeout: 15_000 }).toBe('modified');
      expect(await treeItem(page, 'neu.txt').getAttribute('data-git')).toBe('unversioned');
      expect(await treeItem(page, 'a.txt').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(104, 151, 187)');
      expect(await treeItem(page, 'neu.txt').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(209, 103, 90)');

      await page.keyboard.press('Alt+0');
      await changesItem(page, 'a.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rollback…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rollback Changes' });
      expect(await dialog.innerText()).toContain('a.txt');
      await dialog.getByRole('button', { name: 'Rollback' }).click();
      await expect.poll(() => fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('original\n');
      await expect.poll(() => changesItem(page, 'a.txt').count()).toBe(0);
    } finally {
      await codium.close();
    }
  });
});
