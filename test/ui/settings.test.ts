// Teststelle 2: Einstellungsdialog und Hinweise zu fehlenden Voraussetzungen in der echten App, gesteuert mit
// Playwright im Testmodus.

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

/** Der sichtbare Text in Monaco (Monaco schreibt Leerzeichen als geschützte Leerzeichen). */
async function editorText(page: Page): Promise<string> {
  return (await page.locator('.editor-host .view-lines').innerText()).replace(/\u00a0/g, ' ');
}

function fontSize(page: Page): Promise<number> {
  return page.locator('.editor-host .view-lines').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
}

describe('Einstellungen und Voraussetzungen', () => {
  const tempDir = useTempDirs();

  function setup() {
    const alpha = path.join(tempDir(), 'Alpha');
    fs.mkdirSync(alpha, { recursive: true });
    fs.writeFileSync(path.join(alpha, 'a.txt'), 'text\n');
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    return { alpha, dataRoot };
  }

  async function withApp(codium: LaunchedApp, body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } finally {
      await codium.close();
    }
  }

  it('öffnet mit Ctrl + Alt + S die Einstellungen; eine geänderte Schriftgrösse wirkt sofort im Editor', async () => {
    const { dataRoot } = setup();
    const codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      const page = await codium.page(ALPHA);
      await item(page, 'a.txt').dblclick();
      await expect.poll(() => fontSize(page)).toBe(13);

      await page.keyboard.press('Control+Alt+s');
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await dialog.waitFor();
      // Die Auswahl des JDK zeigt „Newest detected“.
      expect(await dialog.getByLabel('JDK for Java language server').locator('option').first().innerText()).toMatch(/^Newest detected/);
      const size = dialog.getByLabel('Editor font size');
      expect(await size.inputValue()).toBe('13');
      await size.fill('16');
      await dialog.getByRole('button', { name: 'OK' }).click();
      await expect.poll(() => dialog.count()).toBe(0);
      await expect.poll(() => fontSize(page)).toBe(16);

      // Über das Projektmenü; Escape schliesst ohne zu speichern.
      await page.getByRole('button', { name: 'Alpha', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Settings…' }).click();
      await dialog.waitFor();
      expect(await dialog.getByLabel('Editor font size').inputValue()).toBe('16');
      await dialog.getByLabel('Editor font size').fill('20');
      await page.keyboard.press('Escape');
      await expect.poll(() => dialog.count()).toBe(0);
      expect(await fontSize(page)).toBe(16);

      // Enter auf „Cancel“ speichert nicht; Tab bleibt im Dialog (Review von Ticket 09).
      await page.keyboard.press('Control+Alt+s');
      await dialog.waitFor();
      await dialog.getByLabel('Editor font size').fill('18');
      await dialog.getByRole('button', { name: 'Cancel' }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => dialog.count()).toBe(0);
      expect(await fontSize(page)).toBe(16);
      await page.keyboard.press('Control+Alt+s');
      await dialog.waitFor();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null), `Tab ${i + 1}`).toBe(true);
      }
      // Auch ohne Fokus im Dialog schliesst Escape ihn.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
      await expect.poll(() => dialog.count()).toBe(0);
    });
  });

  it('zeigt ohne Git „Git not found“; „Open README“ öffnet das README schreibgeschützt am Abschnitt „Voraussetzungen“', async () => {
    const { dataRoot } = setup();
    const codium = await launchCodium({ dataRoot, env: { CODIUM_TEST_NO_GIT: '1' } });
    await withApp(codium, async () => {
      const page = await codium.page(ALPHA);
      const notice = page.getByRole('alert').filter({ hasText: 'Git not found' });
      await notice.waitFor();
      await notice.getByRole('button', { name: 'Open README' }).click();
      await expect.poll(() => activeTab(page)).toBe('README.md');
      expect(await tabList(page).getByRole('tab', { name: 'README.md' }).getAttribute('title')).toBe('README.md – comes with Codium (read-only)');
      // Die erste sichtbare Zeile ist die Überschrift des Abschnitts (oder sie ist zu sehen), der Cursor steht darauf.
      await expect.poll(() => editorText(page)).toContain('## Voraussetzungen');
      const readme = fs.readFileSync(path.resolve(__dirname, '..', '..', 'README.md'), 'utf8').split(/\r?\n/);
      const heading = readme.findIndex((line) => line.trim() === '## Voraussetzungen') + 1;
      expect(await page.getByLabel('Line and column', { exact: true }).innerText()).toBe(`${heading}:1`);
      // Schreibgeschützt: Tippen ändert nichts, und der Tab gehört nicht zu den Datei-Tabs des Projekts.
      await page.keyboard.type('xyz');
      expect(await editorText(page)).not.toContain('xyz');
      expect(await tabList(page).getByRole('tab', { name: 'README.md' }).getAttribute('data-modified')).toBeNull();
      const tabs = await page.evaluate(() =>
        (window as unknown as { codium: { invoke(name: string): Promise<{ ok: boolean; result: { tabs: string[] } }> } }).codium.invoke('project.tabs'),
      );
      expect(tabs.result.tabs).toEqual([]);
      expect(await page.getByRole('button', { name: 'Select Opened File' }).isDisabled()).toBe(true);
    });
  });
});
