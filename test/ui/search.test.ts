// Teststelle 2: Suche nach Namen, zuletzt geöffnete Dateien, Projektsuche und Werkzeugfenster „Find“ in der echten App,
// gesteuert mit Playwright im Testmodus.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function tabList(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Editor Tabs' });
}

async function activeTab(page: Page): Promise<string | null> {
  if ((await tabList(page).count()) === 0) return null;
  return tabList(page).getByRole('tab', { selected: true }).getAttribute('aria-label');
}

function statusPosition(page: Page): Promise<string> {
  return page.getByLabel('Line and column', { exact: true }).innerText();
}

function editorFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('.editor-host') != null);
}

function stripeButton(page: Page, name: string): Locator {
  return page.getByRole('navigation', { name: 'Left Tool Windows' }).getByRole('button', { name, exact: true });
}

describe('Suchen', () => {
  const tempDir = useTempDirs();

  function setup(files: Record<string, string>) {
    const alpha = path.join(tempDir(), 'Alpha');
    fs.mkdirSync(alpha, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(alpha, relative)), { recursive: true });
      fs.writeFileSync(path.join(alpha, relative), content);
    }
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    return { alpha, dataRoot };
  }

  async function launchAlpha(dataRoot: string): Promise<{ codium: LaunchedApp; page: Page }> {
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page(ALPHA);
      await item(page, 'Alpha').waitFor({ timeout: 15_000 });
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

  it('öffnet mit Ctrl + Shift + N eine Datei nach einem Teil ihres Namens und mit Ctrl + E die vorherige', async () => {
    const { dataRoot } = setup({
      'src/main/java/demo/UserService.java': 'class UserService {}\n',
      'src/main/java/demo/OrderService.java': 'class OrderService {}\n',
      'README.md': '# Alpha\n',
    });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await item(page, 'README.md').click();
      await page.keyboard.press('Control+Shift+N');
      const popup = page.getByRole('dialog', { name: 'Go to File' });
      await popup.waitFor();
      await page.keyboard.type('UsrSrv');
      const results = popup.getByRole('listbox', { name: 'Go to File' }).getByRole('option');
      await expect.poll(() => results.first().getAttribute('aria-label')).toBe('UserService.java');
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page)).toBe('UserService.java');
      expect(await popup.count()).toBe(0);
      await expect.poll(() => editorFocused(page)).toBe(true);

      // Eine zweite Datei, dann Ctrl + E: Vorausgewählt ist die vorherige; Enter öffnet sie.
      await page.keyboard.press('Control+Shift+N');
      await page.keyboard.type('OrderSer');
      await expect
        .poll(() => page.getByRole('dialog', { name: 'Go to File' }).getByRole('option').first().getAttribute('aria-label'))
        .toBe('OrderService.java');
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page)).toBe('OrderService.java');
      await page.keyboard.press('Control+e');
      const recent = page.getByRole('dialog', { name: 'Recent Files' });
      await recent.waitFor();
      await expect.poll(() => recent.getByRole('option').count()).toBe(2);
      expect(await recent.getByRole('option', { selected: true }).getAttribute('aria-label')).toBe('UserService.java');
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page)).toBe('UserService.java');
      // Escape schliesst ohne Öffnen.
      await page.keyboard.press('Control+e');
      await recent.waitFor();
      await page.keyboard.press('Escape');
      await expect.poll(() => recent.count()).toBe(0);
    });
  });

  it('findet mit Ctrl + Shift + F Text im Projekt; Doppelklick öffnet an der Fundstelle, „Open in Find Window“ legt die Liste ab', async () => {
    const { dataRoot } = setup({
      'src/App.ts': 'const a = 1;\nconst b = 2;\nexport function needleFunction() {}\n',
      'src/Other.ts': '// needle here too\n',
      'docs/notes.md': 'no match\n',
    });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      // Ohne Trefferlisten gibt es das Werkzeugfenster „Find“ nicht.
      expect(await stripeButton(page, 'Find').count()).toBe(0);

      await item(page, 'Alpha').click();
      await page.keyboard.press('Control+Shift+F');
      const popup = page.getByRole('dialog', { name: 'Find in Files' });
      await popup.waitFor();
      await page.keyboard.type('needle');
      const results = popup.getByRole('listbox', { name: 'Search Results' }).getByRole('option');
      await expect.poll(() => results.count()).toBe(2);
      expect(await popup.getByRole('status').innerText()).toBe('2 matches');
      // Die Vorschau zeigt die Fundstelle mit Farben.
      await expect.poll(() => popup.locator('.find-popup-preview .view-lines').innerText()).toContain('needle');

      const appMatch = results.filter({ hasText: 'needleFunction' });
      await appMatch.dblclick();
      await expect.poll(() => activeTab(page)).toBe('App.ts');
      // Der Cursor steht auf der Fundstelle (Zeile 3, Spalte 17, der Treffer ist ausgewählt).
      await expect.poll(() => statusPosition(page)).toBe('3:23');
      expect(await popup.count()).toBe(0);

      // Erneut öffnen: Die letzte Suche ist noch da. „Open in Find Window“ legt sie ab.
      await page.keyboard.press('Control+Shift+F');
      await popup.waitFor();
      expect(await popup.getByRole('textbox', { name: 'Search text' }).inputValue()).toBe('needle');
      await expect.poll(() => results.count()).toBe(2);
      await popup.getByRole('button', { name: 'Open in Find Window' }).click();
      const find = page.getByRole('region', { name: 'Find' });
      await find.waitFor();
      await expect.poll(() => stripeButton(page, 'Find').count()).toBe(1);
      expect(await find.getByRole('tab').allInnerTexts()).toEqual(['needle']);
      await expect.poll(() => find.locator('.find-match-row').count()).toBe(2);
      // Doppelklick in der Liste öffnet ebenfalls.
      await find.locator('.find-match-row').filter({ hasText: 'needle here too' }).dblclick();
      await expect.poll(() => activeTab(page)).toBe('Other.ts');

      // Den letzten Reiter schliessen: Das Symbol verschwindet.
      await find.getByRole('button', { name: 'Close needle' }).click();
      await expect.poll(() => stripeButton(page, 'Find').count()).toBe(0);
      expect(await page.getByRole('region', { name: 'Find' }).isVisible()).toBe(false);
    });
  });
});
