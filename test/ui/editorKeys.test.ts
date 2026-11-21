// Teststelle 2: zentrale Tastenbelegung im Editor, Tab-Menü, angeheftete Tabs, Überlauf, Ctrl + Tab und Ctrl + Mausrad
// in der echten App, gesteuert mit Playwright im Testmodus. Tasten, Klicks und Mausrad gehen nur über die
// Entwicklerwerkzeuge der App; kein Kopieren und Einfügen im Editor.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { AppSettings, ResponseMessage } from '../../src/shared/types';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';

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

/**
 * Der Text, den Monaco zeigt (nur sichtbare Zeilen). Monaco ordnet die Zeilen im DOM nicht immer in Textreihenfolge
 * und schreibt Leerzeichen als geschützte Leerzeichen; gelesen wird deshalb nach der Lage der Zeilen.
 */
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

function statusPosition(page: Page): Promise<string> {
  return page.getByLabel('Line and column', { exact: true }).innerText();
}

function editorFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('.editor-host') != null);
}

async function invoke<T>(page: Page, name: string, params?: unknown): Promise<T> {
  const response = (await page.evaluate(
    ([n, p]) => (window as unknown as { codium: { invoke(name: string, params?: unknown): Promise<unknown> } }).codium.invoke(n as string, p),
    [name, params] as const,
  )) as ResponseMessage;
  if (!response.ok) throw new Error(response.error.message);
  return response.result as T;
}

describe('Tastenbelegung und Tabs', () => {
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

  async function exit(page: Page, codium: LaunchedApp): Promise<void> {
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Exit' }).click();
    await codium.exited();
  }

  /** Öffnet Dateien nacheinander per Doppelklick im Baum. */
  async function openFiles(page: Page, ...names: string[]): Promise<void> {
    for (const name of names) {
      await item(page, name).dblclick();
      await expect.poll(() => activeTab(page)).toBe(name);
    }
  }

  it('führt mit dem Fokus im Editor die Bearbeitungs-Kürzel von IntelliJ aus', async () => {
    const { dataRoot } = setup({ 'Demo.java': 'alpha beta\ngamma\ndelta\nepsilon\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await openFiles(page, 'Demo.java');
      await expect.poll(() => editorFocused(page)).toBe(true);
      await expect.poll(() => editorText(page)).toContain('alpha beta');

      // Ctrl + D dupliziert die Zeile, Ctrl + Y löscht sie wieder.
      await page.keyboard.press('Control+d');
      await expect.poll(() => editorText(page)).toContain('alpha beta\nalpha beta\ngamma');
      await page.keyboard.press('Control+y');
      await expect.poll(() => editorText(page)).toContain('alpha beta\ngamma\ndelta');
      expect(await editorText(page)).not.toContain('alpha beta\nalpha beta');

      // Ctrl + W erweitert die Auswahl auf das Wort; Tippen ersetzt es.
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('Control+w');
      await page.keyboard.type('omega');
      await expect.poll(() => editorText(page)).toContain('omega beta\ngamma');

      // Ctrl + G springt zu einer Zeile.
      await page.keyboard.press('Control+g');
      await page.keyboard.type('3');
      await page.keyboard.press('Enter');
      await expect.poll(() => statusPosition(page)).toBe('3:1');

      // Ctrl + R öffnet Ersetzen.
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('Control+r');
      const replace = page.locator('.editor-host').getByRole('textbox', { name: 'Replace', exact: true });
      await expect.poll(() => replace.isVisible()).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => replace.isVisible()).toBe(false);

      // Alt + F12 öffnet das Werkzeugfenster „Terminal“ statt Monacos Vorschau der Definition.
      await page.locator('.editor-host .view-lines').click();
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('Alt+F12');
      await expect.poll(() => page.getByRole('region', { name: 'Terminal' }).isVisible()).toBe(true);
      expect(await page.locator('.editor-host .peekview-widget').count()).toBe(0);
    });
  });

  it('fängt Monacos kollidierende Kürzel ab, im Text und im Suchfeld', async () => {
    const { dataRoot } = setup({ 'a.txt': 'foo foo foo\nbar\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await openFiles(page, 'a.txt');
      await expect.poll(() => editorFocused(page)).toBe(true);
      await expect.poll(() => editorText(page)).toContain('foo foo foo');

      // Ctrl + Shift + K löscht bei Monaco die Zeile; hier ist es Push (Ticket 18) und tut im Editor nichts.
      await page.keyboard.press('Control+Shift+k');
      // Ctrl + K ist bei Monaco der Auftakt für Zweierkürzel; hier nicht: Der nächste Buchstabe wird getippt.
      await page.keyboard.press('Control+k');
      await page.keyboard.type('x');
      await page.keyboard.press('Control+b');
      await expect.poll(() => editorText(page)).toContain('xfoo foo foo\nbar');

      // Im Suchfeld erzeugt Ctrl + D keine Mehrfach-Cursor (Review von Ticket 06).
      await page.keyboard.press('Control+f');
      const find = page.locator('.editor-host').getByRole('textbox', { name: 'Find', exact: true });
      await expect.poll(() => find.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.type('foo');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Control+d');
      await page.keyboard.press('Escape');
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.type('X');
      // Genau eine Stelle bekommt das X, nicht jede Fundstelle.
      await expect.poll(async () => (await editorText(page)).split('X').length - 1).toBe(1);
    });
  });

  it('schliesst Tabs per Mittelklick, über das Menü und mit Ctrl + F4, verschont angeheftete und wechselt mit Ctrl + Tab', async () => {
    const { dataRoot } = setup({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c', 'd.txt': 'd' });
    const first = await launchAlpha(dataRoot);
    await withApp(first.codium, async () => {
      const { page } = first;
      await openFiles(page, 'a.txt', 'b.txt', 'c.txt', 'd.txt');

      // Mittelklick schliesst.
      await tab(page, 'd.txt').click({ button: 'middle' });
      await expect.poll(() => tabLabels(page)).toEqual(['a.txt', 'b.txt', 'c.txt']);

      // Ctrl + Tab wechselt zum vorher benutzten Tab, bei gehaltenem Ctrl weiter zurück.
      await openFiles(page, 'a.txt', 'c.txt');
      await page.keyboard.down('Control');
      await page.keyboard.press('Tab');
      await expect.poll(() => activeTab(page)).toBe('a.txt');
      await page.keyboard.press('Tab');
      await expect.poll(() => activeTab(page)).toBe('b.txt');
      await page.keyboard.up('Control');
      // Nach dem Loslassen zählt b.txt als zuletzt benutzt; ein neues Ctrl + Tab führt zum davor aktiven c.txt.
      await page.keyboard.press('Control+Tab');
      await expect.poll(() => activeTab(page)).toBe('c.txt');

      // b.txt anheften: Er rückt nach links und zeigt die Stecknadel.
      await tab(page, 'b.txt').click({ button: 'right' });
      await page.getByRole('menu', { name: 'Editor Tab' }).getByRole('menuitem', { name: 'Pin Tab', exact: true }).click();
      await expect.poll(() => tabLabels(page)).toEqual(['b.txt', 'a.txt', 'c.txt']);
      expect(await tab(page, 'b.txt').getAttribute('data-pinned')).toBe('true');

      // „Close Other Tabs“ auf c.txt schliesst a.txt, nicht aber den angehefteten b.txt.
      await tab(page, 'c.txt').click({ button: 'right' });
      await page.getByRole('menu', { name: 'Editor Tab' }).getByRole('menuitem', { name: 'Close Other Tabs', exact: true }).click();
      await expect.poll(() => tabLabels(page)).toEqual(['b.txt', 'c.txt']);

      // „Close All Tabs“ lässt den angehefteten offen.
      await openFiles(page, 'a.txt', 'd.txt');
      await tab(page, 'a.txt').click({ button: 'right' });
      await page.getByRole('menu', { name: 'Editor Tab' }).getByRole('menuitem', { name: 'Close All Tabs', exact: true }).click();
      await expect.poll(() => tabLabels(page)).toEqual(['b.txt']);

      // Ctrl + F4 schliesst den aktiven Tab.
      await openFiles(page, 'c.txt');
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('Control+F4');
      await expect.poll(() => tabLabels(page)).toEqual(['b.txt']);
      await openFiles(page, 'a.txt');
      await exit(page, first.codium);
    });

    // Die Anheftung übersteht einen Neustart.
    const second = await launchAlpha(dataRoot);
    await withApp(second.codium, async () => {
      const { page } = second;
      await expect.poll(() => tabLabels(page)).toEqual(['b.txt', 'a.txt']);
      expect(await tab(page, 'b.txt').getAttribute('data-pinned')).toBe('true');
      expect(await tab(page, 'a.txt').getAttribute('data-pinned')).toBeNull();
    });
  });

  it('listet bei vielen Tabs alle über den Pfeil', async () => {
    const names = Array.from({ length: 24 }, (_, i) => `File${String(i + 1).padStart(2, '0')}.txt`);
    const { dataRoot } = setup(Object.fromEntries(names.map((n) => [n, n])));
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      for (const name of names) await item(page, name).dblclick();
      await expect.poll(() => tabLabels(page)).toEqual(names);
      // Die Leiste ist breiter als ihr Platz; der aktive (letzte) Tab ist trotzdem zu sehen.
      await expect.poll(() => tabList(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(await tab(page, 'File24.txt').isVisible()).toBe(true);

      await page.getByRole('button', { name: 'Show All Tabs' }).click();
      const all = page.getByRole('menu', { name: 'All Tabs' });
      await all.waitFor();
      expect(await all.getByRole('menuitem').count()).toBe(24);
      await all.getByRole('menuitem', { name: 'File01.txt' }).click();
      await expect.poll(() => activeTab(page)).toBe('File01.txt');
      // Der gewählte Tab wird ins Bild gescrollt.
      await expect
        .poll(() =>
          tab(page, 'File01.txt').evaluate((el) => {
            const list = el.parentElement!.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            return box.left >= list.left - 1 && box.right <= list.right + 1;
          }),
        )
        .toBe(true);
    });
  });

  it('ändert mit Ctrl + Mausrad die Schriftgrösse aller Editoren, und sie übersteht einen Neustart', async () => {
    const { dataRoot } = setup({ 'a.txt': 'text\n' });
    const fontSize = (page: Page) =>
      page.locator('.editor-host .view-lines').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    const first = await launchAlpha(dataRoot);
    await withApp(first.codium, async () => {
      const { page } = first;
      await openFiles(page, 'a.txt');
      await expect.poll(() => fontSize(page)).toBe(13);
      const box = (await page.locator('.editor-host').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await expect.poll(() => fontSize(page)).toBe(14);
      await page.mouse.wheel(0, -100);
      await expect.poll(() => fontSize(page)).toBe(15);
      await page.mouse.wheel(0, 100);
      await expect.poll(() => fontSize(page)).toBe(14);
      // Kleine Schritte (Touchpad) zählen erst zusammen als eine Raste (Review von Ticket 06).
      for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -4);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await fontSize(page)).toBe(14);
      await page.mouse.wheel(0, -60);
      await expect.poll(() => fontSize(page)).toBe(15);
      await page.mouse.wheel(0, 100);
      await page.keyboard.up('Control');
      await expect.poll(() => fontSize(page)).toBe(14);
      await expect.poll(() => invoke<AppSettings>(page, 'app.settings')).toEqual({ fontSize: 14, jdk: null });
      await exit(page, first.codium);
    });

    const second = await launchAlpha(dataRoot);
    await withApp(second.codium, async () => {
      await expect.poll(() => fontSize(second.page)).toBe(14);
    });
  });
});
