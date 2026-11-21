// Teststelle 2: Datei-Tabs und Monaco in der echten App, gesteuert mit Playwright im Testmodus. Klicks und Tasten
// gehen nur über die Entwicklerwerkzeuge der App; kein Kopieren und Einfügen im Editor.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { TestEvent } from '../../src/main/testMode';
import type { CursorState, ResponseMessage } from '../../src/shared/types';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Kleinstes gültiges PNG (1 × 1 Pixel). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function tabList(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Editor Tabs' });
}

/** Die Beschriftungen der offenen Tabs in ihrer Reihenfolge (leer ohne Tabs). */
async function tabLabels(page: Page): Promise<(string | null)[]> {
  if ((await tabList(page).count()) === 0) return [];
  return tabList(page)
    .getByRole('tab')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
}

async function activeTab(page: Page): Promise<string | null> {
  return tabList(page).getByRole('tab', { selected: true }).getAttribute('aria-label');
}

/** Der Text, den Monaco gerade zeigt (nur die sichtbaren Zeilen). */
function editorText(page: Page): Promise<string> {
  // Monaco ordnet die Zeilen im DOM nicht immer in Textreihenfolge und zeigt Leerzeichen als geschützte Leerzeichen;
  // gelesen wird deshalb nach der Lage der Zeilen.
  return page
    .locator('.editor-host .view-lines .view-line')
    .evaluateAll((lines) =>
      lines
        .map((line) => ({ top: Number.parseFloat((line as HTMLElement).style.top), text: (line as HTMLElement).innerText }))
        .sort((a, b) => a.top - b.top)
        .map((line) => line.text.replaceAll('\u00a0', ' '))
        .join('\n'),
    );
}

function statusPosition(page: Page): Promise<string> {
  return page.getByLabel('Line and column', { exact: true }).innerText();
}

/** Ob der Fokus im Editor liegt. */
function editorFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('.editor-host') != null);
}

/** Ein Befehl über die Brücke der Seite, wie ihn die Oberfläche schickt. */
async function invoke<T>(page: Page, name: string, params?: unknown): Promise<T> {
  const response = (await page.evaluate(
    ([n, p]) => (window as unknown as { codium: { invoke(name: string, params?: unknown): Promise<unknown> } }).codium.invoke(n as string, p),
    [name, params] as const,
  )) as ResponseMessage;
  if (!response.ok) throw new Error(response.error.message);
  return response.result as T;
}

describe('Editor und Tabs', () => {
  const tempDir = useTempDirs();

  function setup(files: Record<string, string | Buffer>) {
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

  /** Klappt Ordner im Baum nacheinander auf (Doppelklick). */
  async function expand(page: Page, ...names: string[]): Promise<void> {
    for (const name of names) {
      if ((await item(page, name).getAttribute('aria-expanded')) !== 'true') await item(page, name).dblclick();
      await expect.poll(() => item(page, name).getAttribute('aria-expanded')).toBe('true');
    }
  }

  it('öffnet per Doppelklick einen Tab, nicht zweimal, bearbeitet ihn und schliesst ihn über das Kreuz', async () => {
    const { alpha, dataRoot } = setup({
      'src/Main.java': 'class Main {\n  void run() {}\n}\n',
      'README.md': '# Alpha\n',
    });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      expect(await tabLabels(page)).toEqual([]);
      expect(await page.getByText('No files are open').count()).toBe(1);

      await expand(page, 'src');
      await item(page, 'Main.java').dblclick();
      await expect.poll(() => tabLabels(page)).toEqual(['Main.java']);
      await expect.poll(() => editorText(page)).toContain('void run() {}');
      await expect.poll(() => editorFocused(page)).toBe(true);
      expect(await statusPosition(page)).toBe('1:1');
      expect(await page.getByLabel('Line ending', { exact: true }).innerText()).toBe('LF');
      expect(await page.getByLabel('Encoding', { exact: true }).innerText()).toBe('UTF-8');

      // Ein zweiter Doppelklick öffnet keinen weiteren Tab; ein anderer Tab wird aktiv und wieder zurück.
      await item(page, 'README.md').dblclick();
      await expect.poll(() => tabLabels(page)).toEqual(['Main.java', 'README.md']);
      expect(await activeTab(page)).toBe('README.md');
      await item(page, 'Main.java').dblclick();
      await expect.poll(() => activeTab(page)).toBe('Main.java');
      expect(await tabLabels(page)).toEqual(['Main.java', 'README.md']);

      // Tippen ändert das Modell und markiert den Tab „ungespeichert“, bis das automatische Speichern (Ticket 07) die
      // Datei geschrieben hat; Rückgängig wird ebenso gespeichert.
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('End');
      await page.keyboard.type(' // x');
      await expect.poll(() => editorText(page)).toContain('void run() {} // x');
      await expect.poll(() => statusPosition(page)).toBe('2:21');
      const mainTab = tabList(page).getByRole('tab', { name: 'Main.java', exact: true });
      expect(await mainTab.getAttribute('data-modified')).toBe('true');
      await expect.poll(() => mainTab.getAttribute('data-modified'), { timeout: 5000 }).toBeNull();
      expect(fs.readFileSync(path.join(alpha, 'src', 'Main.java'), 'utf8')).toBe('class Main {\n  void run() {} // x\n}\n');
      // Monaco macht Getipptes wortweise rückgängig; so oft, bis der gelesene Stand wieder da ist.
      for (let i = 0; i < 10 && (await editorText(page)).includes('//'); i++) await page.keyboard.press('Control+Z');
      expect(await editorText(page)).toContain('void run() {}\n}');
      await expect.poll(() => mainTab.getAttribute('data-modified'), { timeout: 5000 }).toBeNull();
      await expect.poll(() => fs.readFileSync(path.join(alpha, 'src', 'Main.java'), 'utf8'), { timeout: 5000 }).toBe('class Main {\n  void run() {}\n}\n');

      // „Select Opened File“ klappt die Ordner bis zur Datei auf und wählt sie aus.
      await page.getByRole('button', { name: 'Collapse All' }).click();
      await expect.poll(() => item(page, 'Main.java').count()).toBe(0);
      await page.getByRole('button', { name: 'Select Opened File' }).click();
      await expect.poll(() => item(page, 'Main.java').getAttribute('aria-selected')).toBe('true');

      // Das Kreuz schliesst; der linke Nachbar wird aktiv, ohne Tabs ist der Code-Bereich wieder leer.
      await mainTab.hover();
      await page.getByRole('button', { name: 'Close Main.java' }).click();
      await expect.poll(() => tabLabels(page)).toEqual(['README.md']);
      expect(await activeTab(page)).toBe('README.md');
      await page.getByRole('button', { name: 'Close README.md' }).click();
      await expect.poll(() => tabLabels(page)).toEqual([]);
      expect(await page.getByText('No files are open').count()).toBe(1);
      await expect.poll(() => page.getByRole('button', { name: 'Select Opened File' }).isDisabled()).toBe(true);
      await expect.poll(() => statusPosition(page)).toBe('');
    });
  });

  it('unterscheidet zwei Dateien „index.ts“ in verschiedenen Ordnern', async () => {
    const { dataRoot } = setup({ 'src/a/index.ts': 'export const a = 1;\n', 'src/b/index.ts': 'export const b = 2;\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await expand(page, 'src', 'a', 'b');
      const indexFiles = page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name: 'index.ts', exact: true });
      await expect.poll(() => indexFiles.count()).toBe(2);
      await indexFiles.nth(0).dblclick();
      await expect.poll(() => tabLabels(page)).toEqual(['index.ts']);
      await indexFiles.nth(1).dblclick();
      await expect.poll(() => tabLabels(page)).toEqual(['index.ts – a', 'index.ts – b']);
      // Der Tab zeigt den Ordner auch sichtbar, nicht nur für Screenreader.
      const texts = await tabList(page).getByRole('tab').allInnerTexts();
      expect(texts[0]).not.toBe(texts[1]);
      await expect.poll(() => editorText(page)).toContain('export const b = 2;');
    });
  });

  it('zeigt ein Bild als Bild und für eine Binärdatei einen Hinweis', async () => {
    const binary = Buffer.alloc(64, 0x41);
    binary[10] = 0;
    const { dataRoot } = setup({ 'logo.png': PNG_1X1, 'app.bin': binary, 'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n' });
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await item(page, 'logo.png').dblclick();
      const image = page.getByRole('img', { name: 'logo.png', exact: true });
      await image.waitFor();
      expect(await image.getAttribute('src')).toBe(`data:image/png;base64,${PNG_1X1.toString('base64')}`);
      await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);
      expect(await page.locator('.editor-host').isVisible()).toBe(false);

      await item(page, 'app.bin').dblclick();
      await expect.poll(() => activeTab(page)).toBe('app.bin');
      expect(await page.getByRole('note').innerText()).toContain('This file is binary and cannot be shown.');
      expect(await page.getByRole('img', { name: 'logo.png', exact: true }).count()).toBe(0);

      // SVG öffnet als Text.
      await item(page, 'icon.svg').dblclick();
      await expect.poll(() => editorText(page)).toContain('<svg');
      expect(await tabLabels(page)).toEqual(['logo.png', 'app.bin', 'icon.svg']);
    });
  });

  it('stellt nach einem Neustart Tabs, aktiven Tab und Cursor wieder her; lädt nur aus den eigenen Dateien', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
    const { alpha, dataRoot } = setup({ 'notes.txt': lines, 'src/App.ts': 'const x = 1;\nconst y = 2;\nconst zzzz = 3;\n', 'other.txt': 'o' });
    const app = path.join(alpha, 'src', 'App.ts');
    const first = await launchAlpha(dataRoot);
    await withApp(first.codium, async () => {
      const { page } = first;
      await item(page, 'notes.txt').dblclick();
      await expect.poll(() => editorText(page)).toContain('line 1');
      // Ans Ende der langen Datei: Der Scrollstand gehört zum gespeicherten Cursor.
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('Control+End');
      await expect.poll(() => statusPosition(page)).toBe('200:9');

      await expand(page, 'src');
      await item(page, 'App.ts').dblclick();
      await expect.poll(() => activeTab(page)).toBe('App.ts');
      await expect.poll(() => editorFocused(page)).toBe(true);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await expect.poll(() => statusPosition(page)).toBe('3:5');
      await item(page, 'other.txt').dblclick();
      await expect.poll(() => tabLabels(page)).toEqual(['notes.txt', 'App.ts', 'other.txt']);
      await page.getByRole('button', { name: 'Close other.txt' }).click();
      await expect.poll(() => activeTab(page)).toBe('App.ts');
      // Der Cursor ist im Kern angekommen, bevor Codium endet.
      await expect.poll(() => invoke<CursorState | null>(page, 'project.cursor', { path: app })).toMatchObject({ line: 3, column: 5 });

      // Nur eigene Dateien: Seite, Skripte, Stile, Schriften, Worker; dazu höchstens Bilder als data-URL.
      await expect.poll(async () => (await webRequests(first.codium)).some((url) => url.endsWith('/editor.worker.js'))).toBe(true);
      const own = pathToFileURL(path.join(PROJECT_ROOT, 'dist')).href.toLowerCase();
      const foreign = (await webRequests(first.codium)).filter((url) => !url.toLowerCase().startsWith(`${own}/`) && !url.startsWith('data:'));
      expect(foreign).toEqual([]);
      expect(await page.evaluate(() => document.fonts.check("13px 'JetBrains Mono'"))).toBe(true);
      const violations = (await first.codium.recorded()).filter(
        (e: TestEvent) => e.kind === 'console-message' && /Content Security Policy|Refused to/i.test((e.detail as { message: string }).message),
      );
      expect(violations).toEqual([]);

      await page.getByRole('button', { name: 'Alpha', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Exit' }).click();
      await first.codium.exited();
    });

    const second = await launchAlpha(dataRoot);
    await withApp(second.codium, async () => {
      const { page } = second;
      await expect.poll(() => tabLabels(page)).toEqual(['notes.txt', 'App.ts']);
      expect(await activeTab(page)).toBe('App.ts');
      await expect.poll(() => statusPosition(page)).toBe('3:5');
      await expect.poll(() => editorText(page)).toContain('const zzzz = 3;');
      // Der andere Tab wird erst beim Aktivieren gelesen, mit seinem Cursor und Scrollstand am Ende der Datei.
      await tabList(page).getByRole('tab', { name: 'notes.txt', exact: true }).click();
      await expect.poll(() => statusPosition(page)).toBe('200:9');
      await expect.poll(() => editorText(page)).toContain('line 200');
      expect(await editorText(page)).not.toContain('line 1\n');
    });
  });

  it('bleibt stabil, wenn ein Tab während des Lesens schliesst, umbenannt oder mit seinem Ordner gelöscht wird', async () => {
    // Grosse Dateien, damit das Lesen dauert (Review von Ticket 05).
    const big = `${'x'.repeat(99)}\n`.repeat(300_000);
    const { alpha, dataRoot } = setup({ 'big.txt': big, 'big2.txt': big, 'x/a.txt': 'a\nb\nc\n', 'x/b.txt': 'b', 'other.txt': 'o' });
    const at = (...parts: string[]) => path.join(alpha, ...parts);
    const errors = (page: Page) => page.locator('.notice[role="alert"]').allInnerTexts();
    const first = await launchAlpha(dataRoot);
    await withApp(first.codium, async () => {
      const { page } = first;
      // Schliessen und gleich wieder öffnen, während noch gelesen wird: Am Ende ist der Tab offen, ohne Fehler.
      await item(page, 'big.txt').dblclick();
      await page.getByRole('button', { name: 'Close big.txt' }).click();
      await item(page, 'big.txt').dblclick();
      await expect.poll(() => editorText(page), { timeout: 30_000 }).toContain('xxxx');
      expect(await tabLabels(page)).toEqual(['big.txt']);
      expect(await errors(page)).toEqual([]);

      // Umbenennen während des Lesens: Der Tab liest unter dem neuen Namen und bleibt nicht beim Laden hängen.
      await item(page, 'big2.txt').dblclick();
      await invoke(page, 'files.rename', { path: at('big2.txt'), newName: 'big3.txt' });
      await expect.poll(() => tabLabels(page)).toEqual(['big.txt', 'big3.txt']);
      await expect.poll(() => page.locator('[aria-busy="true"]').count(), { timeout: 30_000 }).toBe(0);
      await expect.poll(() => page.locator('.editor-host').isVisible()).toBe(true);
      expect(await errors(page)).toEqual([]);

      // Für den nächsten Fall: Tabs im Ordner x, der aktive mit Cursor; nach dem Neustart ist nur er gelesen.
      await tabList(page).getByRole('tab', { name: 'big.txt', exact: true }).hover();
      await page.getByRole('button', { name: 'Close big.txt' }).click();
      await page.getByRole('button', { name: 'Close big3.txt' }).click();
      await invoke(page, 'project.setTabs', { tabs: [at('x', 'a.txt'), at('x', 'b.txt'), at('other.txt')], active: at('x', 'a.txt') });
      await invoke(page, 'project.setCursor', { path: at('x', 'a.txt'), cursor: { line: 3, column: 1, scrollTop: 0 } });
      await page.getByRole('button', { name: 'Alpha', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Exit' }).click();
      await first.codium.exited();
    });

    const second = await launchAlpha(dataRoot);
    await withApp(second.codium, async () => {
      const { page } = second;
      await expect.poll(() => statusPosition(page)).toBe('3:1');
      // Den Ordner löschen: Beide Tabs schliessen auf einmal, der ungelesene meldet keinen Fehler, und der Cursor der
      // gelöschten Datei bleibt nicht im Projekt-Zustand.
      await invoke(page, 'files.delete', { paths: [at('x')] });
      await expect.poll(() => tabLabels(page)).toEqual(['other.txt']);
      await expect.poll(() => editorText(page)).toContain('o');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await errors(page)).toEqual([]);
      expect(await invoke(page, 'project.cursor', { path: at('x', 'a.txt') })).toBeNull();
    });
  });
});

/** Die Adressen aller Zugriffe der Seiten seit dem Start, aus der Aufzeichnung des Testmodus. */
async function webRequests(codium: LaunchedApp): Promise<string[]> {
  return (await codium.recorded()).filter((e) => e.kind === 'web-request').map((e) => (e.detail as { url: string }).url);
}
