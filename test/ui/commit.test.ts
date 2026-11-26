// Teststelle 2: Werkzeugfenster „Commit“ und Git-Farben im Dateibaum (Ticket 16), mit einem Temp-Repository und
// abgeschirmter Git-Konfiguration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote } from '../support/git';
import { launchCodium, prepareAppState, prepareProjectState } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

function treeItem(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function changesItem(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Changes' }).getByRole('treeitem', { name, exact: true });
}

/** Die freigegebenen Git-Farben (IntelliJ „Dark“, Ticket 29) und die Schriftfarben ohne Git-Zustand, wie der Browser sie meldet. */
const RGB = {
  modified: 'rgb(112, 174, 255)',
  added: 'rgb(115, 189, 121)',
  unversioned: 'rgb(232, 143, 137)',
  ignored: 'rgb(214, 154, 107)',
  text: 'rgb(223, 225, 229)',
};

/** Die berechnete Farbe des Namens einer Zeile im Dateibaum bzw. des Titels eines Tabs. */
function nameColor(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el.querySelector('.file-tree-name, .editor-tab-name') ?? el).color);
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
      // Farben im Dateibaum: geändert blau, nicht versioniert lachsrot (Ticket 29, mehr im eigenen Test unten).
      await expect.poll(() => treeItem(page, 'a.txt').getAttribute('data-git'), { timeout: 15_000 }).toBe('modified');
      expect(await treeItem(page, 'neu.txt').getAttribute('data-git')).toBe('unversioned');
      expect(await treeItem(page, 'a.txt').evaluate((el) => getComputedStyle(el).color)).toBe(RGB.modified);
      expect(await treeItem(page, 'neu.txt').evaluate((el) => getComputedStyle(el).color)).toBe(RGB.unversioned);

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

  it('färbt wie IntelliJ „Dark“: nicht versionierte und ignorierte Ordner im Baum, Änderungsansicht und Tabs (Ticket 29)', async () => {
    const base = tempDir();
    const repo = createRepoWithRemote(base, 'shop');
    const write = (relative: string, text = 'x\n') => {
      const file = path.join(repo.repo, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    write('.gitignore', 'node_modules/\n*.log\n');
    write('src/Cart.java', 'class Cart {}\n');
    repo.run('add', '.');
    repo.run('commit', '-m', 'shop');
    write('src/Cart.java', 'class Cart { int n; }\n');
    write('src/Draft.java');
    write('drafts/ideas.md');
    write('drafts/old/notes.txt');
    write('node_modules/left-pad/index.js');
    write('app.log');
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    prepareProjectState(dataRoot, repo.repo, {
      expandedFolders: ['', 'drafts', 'drafts/old', 'node_modules', 'node_modules/left-pad', 'src'],
      tabs: ['src/Cart.java', 'src/Draft.java', 'README.md'],
      activeTab: 'README.md',
    });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page('shop – Codium');
      await expect.poll(() => treeItem(page, 'Cart.java').getAttribute('data-git'), { timeout: 15_000 }).toBe('modified');

      // Dateibaum: Datei, Ordner und Unterordner ohne versionierte Dateien „nicht versioniert“; ein Ordner mit
      // versionierten Dateien ohne Farbe; ignorierte Ordner samt Inhalt und ignorierte Dateien orange.
      const expected: Array<[string, string | null, string]> = [
        ['Cart.java', 'modified', RGB.modified],
        ['Draft.java', 'unversioned', RGB.unversioned],
        ['drafts', 'unversioned', RGB.unversioned],
        ['old', 'unversioned', RGB.unversioned],
        ['notes.txt', 'unversioned', RGB.unversioned],
        ['src', null, RGB.text],
        ['node_modules', 'ignored', RGB.ignored],
        ['index.js', 'ignored', RGB.ignored],
        ['app.log', 'ignored', RGB.ignored],
      ];
      for (const [name, git, rgb] of expected) {
        await treeItem(page, name).waitFor();
        expect(await treeItem(page, name).getAttribute('data-git'), name).toBe(git);
        expect(await nameColor(treeItem(page, name)), name).toBe(rgb);
      }

      // Tabs: der Titel trägt die Farbe, eine unveränderte Datei nicht. Sie folgen dem Zustand.
      const tab = (name: string) => page.getByRole('tab', { name, exact: true });
      await expect.poll(() => tab('Cart.java').getAttribute('data-git')).toBe('modified');
      expect(await nameColor(tab('Cart.java'))).toBe(RGB.modified);
      expect(await tab('Draft.java').getAttribute('data-git')).toBe('unversioned');
      expect(await nameColor(tab('Draft.java'))).toBe(RGB.unversioned);
      expect(await tab('README.md').getAttribute('data-git')).toBeNull();
      expect(await nameColor(tab('README.md'))).toBe(RGB.text);
      repo.run('add', 'src/Draft.java');
      await expect.poll(() => tab('Draft.java').getAttribute('data-git'), { timeout: 15_000 }).toBe('added');
      expect(await nameColor(tab('Draft.java'))).toBe(RGB.added);
      expect(await nameColor(treeItem(page, 'Draft.java'))).toBe(RGB.added);

      // Änderungsansicht: dieselben Farben.
      await page.keyboard.press('Alt+0');
      await changesItem(page, 'Cart.java').waitFor({ timeout: 15_000 });
      expect(await changesItem(page, 'Cart.java').evaluate((el) => getComputedStyle(el).color)).toBe(RGB.modified);
      expect(await changesItem(page, 'Draft.java').evaluate((el) => getComputedStyle(el).color)).toBe(RGB.added);
      expect(await changesItem(page, 'ideas.md').evaluate((el) => getComputedStyle(el).color)).toBe(RGB.unversioned);
    } finally {
      await codium.close();
    }
  });
});
