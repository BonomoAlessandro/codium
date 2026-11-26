// Teststelle 2: Java-Dateien mit Symbol je Art (Ticket 32) in der echten App, gesteuert mit Playwright im Testmodus.
// Dateibaum (Name ohne `.java`, Tooltip und Rename mit vollem Namen, Git-Farbe nur am Namen), Wechsel des Symbols nach
// dem Speichern, Datei-Tabs, „Recent Files“ und „Go to File“.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { git, shieldedGitEnv, TEST_GIT_USER } from '../support/git';
import { launchCodium, prepareAppState, prepareProjectState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const TITLE = 'Shop – Codium';
const PKG = 'src/shop';
const FILES: Record<string, string> = {
  [`${PKG}/OrderService.java`]: 'package shop;\n\npublic class OrderService {\n}\n',
  [`${PKG}/Repository.java`]: 'package shop;\n\npublic interface Repository<T> {\n}\n',
  [`${PKG}/OrderStatus.java`]: 'package shop;\n\npublic enum OrderStatus { NEW, PAID }\n',
  [`${PKG}/Money.java`]: 'package shop;\n\npublic record Money(long cents) {\n}\n',
  [`${PKG}/Helpers.java`]: 'package shop;\n\nclass Helpers {\n}\n\nclass Other {\n}\n',
  'README.md': '# Shop\n',
};

function tree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Project Files' });
}

/** Eine Zeile des Baums; ihr zugänglicher Name ist der volle Dateiname. */
function item(page: Page, name: string): Locator {
  return tree(page).getByRole('treeitem', { name, exact: true });
}

/** Die Art am Symbol eines Eintrags (Zeile, Tab, Treffer); `null` ohne Java-Symbol. */
async function kindOf(entry: Locator): Promise<string | null> {
  const icon = entry.locator('svg.java-icon');
  return (await icon.count()) === 0 ? null : icon.getAttribute('data-java-kind');
}

/** Der sichtbare Name einer Zeile im Baum. */
function shownName(row: Locator): Promise<string> {
  return row.locator('.file-tree-name').innerText();
}

/** Die Farbe der Linie des Java-Symbols (Ring bzw. Tasse). */
function iconLineColor(entry: Locator): Promise<string> {
  return entry.locator('svg.java-icon').evaluate((svg) => getComputedStyle(svg.querySelector('[stroke]')!).stroke);
}

function tab(page: Page, name: string): Locator {
  return page.getByRole('tablist', { name: 'Editor Tabs' }).getByRole('tab', { name, exact: true });
}

function editorFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('.editor-host') != null);
}

describe('Java-Symbole', () => {
  const tempDir = useTempDirs();

  /** Ein Projekt „Shop“ mit je einer Datei jeder Art; offen beim Start, das Paket aufgeklappt. */
  function setup(state: Parameters<typeof prepareProjectState>[2] = {}, options: { git?: boolean } = {}) {
    const shop = path.join(tempDir(), 'Shop');
    for (const [relative, content] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(shop, relative)), { recursive: true });
      fs.writeFileSync(path.join(shop, relative), content);
    }
    const dataRoot = tempDir();
    if (options.git) {
      const env = shieldedGitEnv(path.join(dataRoot, 'gitconfig-setup'));
      git(shop, env, 'init', '-q', '-b', 'main');
      git(shop, env, 'config', 'user.name', TEST_GIT_USER.name);
      git(shop, env, 'config', 'user.email', TEST_GIT_USER.email);
      git(shop, env, 'add', '-A');
      git(shop, env, 'commit', '-q', '-m', 'Shop');
      fs.appendFileSync(path.join(shop, PKG, 'OrderService.java'), '// geändert\n');
    }
    prepareAppState(dataRoot, { openProjects: [shop], recentProjects: [shop] });
    prepareProjectState(dataRoot, shop, { expandedFolders: ['', 'src', PKG], ...state });
    return { shop, dataRoot, at: (...parts: string[]) => path.join(shop, ...parts) };
  }

  /** Startet Codium und wartet auf eine Zeile im Baum (Standard: die Klasse im aufgeklappten Paket). */
  async function launch(dataRoot: string, firstRow = 'OrderService.java'): Promise<{ codium: LaunchedApp; page: Page }> {
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page(TITLE);
      await item(page, firstRow).waitFor({ timeout: 15_000 });
      return { codium, page };
    } catch (err) {
      await codium.close();
      throw err;
    }
  }

  async function withApp(codium: LaunchedApp, body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } finally {
      await codium.close();
    }
  }

  it('zeigt im Baum das Symbol je Art ohne .java; Tooltip und Rename mit vollem Namen, Git-Farbe nur am Namen', async () => {
    const { dataRoot } = setup({}, { git: true });
    const { codium, page } = await launch(dataRoot);
    await withApp(codium, async () => {
      const service = item(page, 'OrderService.java');
      await expect.poll(() => kindOf(service)).toBe('class');
      expect(await shownName(service)).toBe('OrderService');
      for (const [file, kind, shown] of [
        ['Repository.java', 'interface', 'Repository'],
        ['OrderStatus.java', 'enum', 'OrderStatus'],
        ['Money.java', 'record', 'Money'],
      ]) {
        await expect.poll(() => kindOf(item(page, file)), { message: file }).toBe(kind);
        expect(await shownName(item(page, file)), file).toBe(shown);
      }
      // Zwei oberste Typen: Java-Datei mit Endung und allgemeinem Symbol (Tasse).
      const helpers = item(page, 'Helpers.java');
      await expect.poll(() => kindOf(helpers)).toBe('java');
      expect(await shownName(helpers)).toBe('Helpers.java');
      // Andere Dateien behalten ihr Symbol und ihren Namen.
      expect(await kindOf(item(page, 'README.md'))).toBeNull();
      expect(await shownName(item(page, 'README.md'))).toBe('README.md');

      // Die Reihenfolge bleibt die der vollen Namen.
      const order = await tree(page)
        .getByRole('treeitem')
        .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
      expect(order.slice(order.indexOf('Helpers.java'), order.indexOf('Repository.java') + 1)).toEqual([
        'Helpers.java',
        'Money.java',
        'OrderService.java',
        'OrderStatus.java',
        'Repository.java',
      ]);

      // Tooltip mit vollem Namen.
      expect(await service.getAttribute('title')).toBe('OrderService.java');

      // Git-Farbe nur am Namen (geändert, blau); das Symbol behält seine Farbe (Ticket 29, IntelliJ).
      await expect.poll(() => service.getAttribute('data-git')).toBe('modified');
      expect(await service.locator('.file-tree-name').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(112, 174, 255)');
      expect(await iconLineColor(service)).toBe('rgb(84, 138, 247)');
      expect(await iconLineColor(item(page, 'Repository.java'))).toBe('rgb(87, 150, 92)');
      expect(await iconLineColor(helpers)).toBe('rgb(199, 125, 85)');

      // Rename schlägt den vollen Dateinamen vor und markiert den Namen ohne Endung; der Hinweis zu Java bleibt.
      await service.click();
      await page.keyboard.press('Shift+F6');
      const rename = page.getByRole('dialog', { name: 'Rename' });
      const field = rename.getByRole('textbox');
      expect(await field.inputValue()).toBe('OrderService.java');
      expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'OrderService'.length]);
      expect(await rename.getByText('Rename file “OrderService.java” to:').isVisible()).toBe(true);
      await expect.poll(() => rename.getByText('References to the class in other files are not updated.').isVisible()).toBe(true);
      await page.keyboard.press('Escape');
      await rename.waitFor({ state: 'detached' });
    });
  });

  it('wechselt das Symbol nach dem Speichern von class zu interface', async () => {
    const { dataRoot, at } = setup();
    const { codium, page } = await launch(dataRoot);
    await withApp(codium, async () => {
      const service = item(page, 'OrderService.java');
      await expect.poll(() => kindOf(service)).toBe('class');
      await service.dblclick();
      await expect.poll(() => kindOf(tab(page, 'OrderService.java'))).toBe('class');
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('Control+a');
      await page.keyboard.type('public interface OrderService {}');
      await page.keyboard.press('Control+s');
      await expect.poll(() => fs.readFileSync(at(PKG, 'OrderService.java'), 'utf8')).toBe('public interface OrderService {}');
      await expect.poll(() => kindOf(service)).toBe('interface');
      await expect.poll(() => kindOf(tab(page, 'OrderService.java'))).toBe('interface');
      expect(await shownName(service)).toBe('OrderService');

      // Und von aussen zurück zur Klasse, über die Dateiüberwachung.
      fs.writeFileSync(at(PKG, 'OrderService.java'), 'public class OrderService extends RuntimeException {}\n');
      await expect.poll(() => kindOf(service), { timeout: 10_000 }).toBe('exception');
    });
  });

  it('zeigt in den Datei-Tabs das Symbol der Art, mit vollem Namen', async () => {
    const tabs = [`${PKG}/OrderService.java`, `${PKG}/Repository.java`, `${PKG}/Helpers.java`, 'README.md'];
    // Das Paket bleibt zu: Die Arten fragen die Tabs selbst an, nicht der Baum (Review).
    const { dataRoot } = setup({ tabs, activeTab: tabs[0], expandedFolders: [''] });
    const { codium, page } = await launch(dataRoot, 'src');
    await withApp(codium, async () => {
      await expect.poll(() => kindOf(tab(page, 'OrderService.java'))).toBe('class');
      await expect.poll(() => kindOf(tab(page, 'Repository.java'))).toBe('interface');
      await expect.poll(() => kindOf(tab(page, 'Helpers.java'))).toBe('java');
      expect(await kindOf(tab(page, 'README.md'))).toBeNull();
      expect(await tab(page, 'OrderService.java').locator('.editor-tab-name').innerText()).toBe('OrderService.java');
      expect(await iconLineColor(tab(page, 'Repository.java'))).toBe('rgb(87, 150, 92)');
    });
  });

  it('zeigt in „Recent Files“ das Symbol der Art, mit vollem Namen', async () => {
    const recentFiles = [`${PKG}/OrderStatus.java`, `${PKG}/Money.java`, 'README.md', `${PKG}/Helpers.java`];
    // Das Paket bleibt zu: Die Arten fragt die Liste selbst an, nicht der Baum (Review).
    const { dataRoot } = setup({ recentFiles, expandedFolders: [''] });
    const { codium, page } = await launch(dataRoot, 'src');
    await withApp(codium, async () => {
      await tree(page).focus();
      await page.keyboard.press('Control+e');
      const popup = page.getByRole('dialog', { name: 'Recent Files' });
      await popup.waitFor();
      const option = (name: string) => popup.getByRole('option', { name, exact: true });
      await expect.poll(() => kindOf(option('OrderStatus.java'))).toBe('enum');
      await expect.poll(() => kindOf(option('Money.java'))).toBe('record');
      await expect.poll(() => kindOf(option('Helpers.java'))).toBe('java');
      expect(await kindOf(option('README.md'))).toBeNull();
      expect(await option('Money.java').locator('.quick-popup-name').innerText()).toBe('Money.java');
      await page.keyboard.press('Escape');
    });
  });

  it('zeigt in „Go to File“ das Symbol der Art, mit vollem Namen', async () => {
    // Das Paket bleibt zu: Die Arten fragt die Liste selbst an, nicht der Baum (Review).
    const { dataRoot } = setup({ expandedFolders: [''] });
    const { codium, page } = await launch(dataRoot, 'src');
    await withApp(codium, async () => {
      await tree(page).focus();
      await page.keyboard.press('Control+Shift+N');
      const popup = page.getByRole('dialog', { name: 'Go to File' });
      await popup.waitFor();
      await page.keyboard.type('Order');
      const option = (name: string) => popup.getByRole('option', { name, exact: true });
      await expect.poll(() => kindOf(option('OrderService.java'))).toBe('class');
      await expect.poll(() => kindOf(option('OrderStatus.java'))).toBe('enum');
      expect(await option('OrderService.java').locator('.quick-popup-name').innerText()).toBe('OrderService.java');
      await page.keyboard.press('Escape');
    });
  });
});
