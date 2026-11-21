// Teststelle 2: automatisches Speichern, Ctrl + S, Änderungen von aussen und Konflikte in der echten App, gesteuert mit
// Playwright im Testmodus. Die Datei „von aussen“ ändert der Test direkt auf der Festplatte.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';
/** Das automatische Speichern kommt etwa eine Sekunde nach der letzten Eingabe; so lange wird höchstens gewartet. */
const AUTOSAVE = { timeout: 5000 };

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function tabList(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Editor Tabs' });
}

function tab(page: Page, name: string): Locator {
  return tabList(page).getByRole('tab', { name, exact: true });
}

async function tabLabels(page: Page): Promise<(string | null)[]> {
  if ((await tabList(page).count()) === 0) return [];
  return tabList(page)
    .getByRole('tab')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
}

async function activeTab(page: Page): Promise<string | null> {
  return tabList(page).getByRole('tab', { selected: true }).getAttribute('aria-label');
}

/** Der Text, den Monaco zeigt, nach der Lage der Zeilen (Monaco ordnet sie im DOM nicht immer). */
function editorText(page: Page): Promise<string> {
  return page
    .locator('.editor-host .view-lines .view-line')
    .evaluateAll((lines) =>
      lines
        .map((line) => ({ top: Number.parseFloat((line as HTMLElement).style.top), text: (line as HTMLElement).innerText }))
        .sort((a, b) => a.top - b.top)
        .map((line) => line.text.replaceAll(' ', ' '))
        .join('\n'),
    );
}

function editorFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('.editor-host') != null);
}

function statusPosition(page: Page): Promise<string> {
  return page.getByLabel('Line and column', { exact: true }).innerText();
}

describe('Speichern', () => {
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
    return { alpha, dataRoot, at: (...parts: string[]) => path.join(alpha, ...parts) };
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

  async function open(page: Page, name: string): Promise<void> {
    await item(page, name).dblclick();
    await expect.poll(() => activeTab(page)).toBe(name);
    await expect.poll(() => editorFocused(page)).toBe(true);
  }

  const read = (file: string) => fs.readFileSync(file, 'utf8');

  it('speichert nach einer Pause, beim Tabwechsel und mit Ctrl + S; Zeilenende und Kodierung bleiben', async () => {
    const { dataRoot, at } = setup({ 'a.txt': 'eins\r\nzwei\r\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await open(page, 'a.txt');
      expect(await page.getByLabel('Line ending', { exact: true }).innerText()).toBe('CRLF');

      // Tippen, kurz warten: Die Datei hat den neuen Inhalt, mit CRLF wie vorher; die Markierung ist weg.
      await page.keyboard.press('End');
      await page.keyboard.type(' plus');
      await page.keyboard.press('Enter');
      await page.keyboard.type('neu');
      expect(await tab(page, 'a.txt').getAttribute('data-modified')).toBe('true');
      await expect.poll(() => read(at('a.txt')), AUTOSAVE).toBe('eins plus\r\nneu\r\nzwei\r\n');
      await expect.poll(() => tab(page, 'a.txt').getAttribute('data-modified')).toBeNull();

      // Tabwechsel speichert sofort, lange bevor das automatische Speichern käme.
      await open(page, 'b.txt');
      await page.keyboard.type('B');
      await item(page, 'c.txt').dblclick();
      await expect.poll(() => read(at('b.txt')), { timeout: 600 }).toBe('Bb\n');

      // Ctrl + S speichert sofort.
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.type('C');
      await page.keyboard.press('Control+s');
      await expect.poll(() => read(at('c.txt')), { timeout: 600 }).toBe('Cc\n');
    });
  });

  it('lädt eine von aussen geänderte Datei still neu und schliesst den Tab einer gelöschten', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const { dataRoot, at } = setup({ 'a.txt': `${lines}\n`, 'b.txt': 'b\n', 'c.txt': 'c\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await open(page, 'a.txt');
      for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
      await expect.poll(() => statusPosition(page)).toBe('10:1');

      // Von aussen: eine Zeile am Anfang geändert. Der Tab zeigt den neuen Inhalt, der Cursor bleibt in seiner Zeile.
      fs.writeFileSync(at('a.txt'), `LINE 1 von aussen\n${lines.split('\n').slice(1).join('\n')}\n`);
      await expect.poll(() => editorText(page)).toContain('LINE 1 von aussen');
      expect(await statusPosition(page)).toBe('10:1');
      expect(await tab(page, 'a.txt').getAttribute('data-modified')).toBeNull();
      expect(await page.getByText('File changed on disk').count()).toBe(0);

      // Von aussen gelöscht: Der Tab schliesst sich.
      await open(page, 'b.txt');
      fs.rmSync(at('b.txt'));
      await expect.poll(() => tabLabels(page)).toEqual(['a.txt']);

      // Gelöscht und sofort neu angelegt (wie bei einem Checkout): Der Tab bleibt und zeigt den neuen Inhalt.
      await open(page, 'c.txt');
      fs.rmSync(at('c.txt'));
      fs.writeFileSync(at('c.txt'), 'neu angelegt\n');
      await expect.poll(() => editorText(page)).toContain('neu angelegt');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await tabLabels(page)).toEqual(['a.txt', 'c.txt']);
    });
  });

  it('zeigt bei ungespeicherten Eingaben „File changed on disk“; „Keep Mine“ und „Load from Disk“ entscheiden', async () => {
    const { dataRoot, at } = setup({ 'a.txt': 'original\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await open(page, 'a.txt');
      const banner = page.getByRole('alert').filter({ hasText: 'File changed on disk' });

      // Tippen und sofort von aussen ändern: Hinweis statt Speichern.
      await page.keyboard.type('mine ');
      fs.writeFileSync(at('a.txt'), 'foreign\n');
      await banner.waitFor();
      // Bis zur Entscheidung wird nicht gespeichert.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(read(at('a.txt'))).toBe('foreign\n');
      expect(await tab(page, 'a.txt').getAttribute('data-modified')).toBe('true');

      // „Keep Mine“ schreibt die eigene Fassung.
      await banner.getByRole('button', { name: 'Keep Mine' }).click();
      await expect.poll(() => read(at('a.txt'))).toBe('mine original\n');
      await expect.poll(() => banner.count()).toBe(0);
      await expect.poll(() => tab(page, 'a.txt').getAttribute('data-modified')).toBeNull();

      // Noch einmal; „Load from Disk“ zeigt die fremde Fassung und verwirft die Eingaben.
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('more');
      fs.writeFileSync(at('a.txt'), 'foreign again\n');
      await banner.waitFor();
      await banner.getByRole('button', { name: 'Load from Disk' }).click();
      await expect.poll(() => editorText(page)).toContain('foreign again');
      expect(await editorText(page)).not.toContain('more');
      await expect.poll(() => banner.count()).toBe(0);
      expect(await tab(page, 'a.txt').getAttribute('data-modified')).toBeNull();
      expect(read(at('a.txt'))).toBe('foreign again\n');
    });
  });

  it('folgt dem Umbenennen im Baum und speichert unter dem neuen Namen', async () => {
    const { dataRoot, at } = setup({ 'Old.java': 'class Old {}\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await open(page, 'Old.java');
      await item(page, 'Old.java').click({ button: 'right' });
      await page.getByRole('menu', { name: 'Project Files', exact: true }).getByRole('menuitem', { name: 'Rename…', exact: true }).click();
      const rename = page.getByRole('dialog', { name: 'Rename' });
      await rename.getByRole('textbox').fill('New.java');
      await rename.getByRole('textbox').press('Enter');
      await expect.poll(() => tabLabels(page)).toEqual(['New.java']);

      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('// renamed');
      await expect.poll(() => fs.existsSync(at('New.java')) && read(at('New.java')), AUTOSAVE).toBe('class Old {}\n// renamed');
      expect(fs.existsSync(at('Old.java'))).toBe(false);
    });
  });
});
