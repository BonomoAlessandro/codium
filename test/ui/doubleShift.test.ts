// Teststelle 2: zweimal Shift öffnet „Go to File“ (Ticket 26), in der echten App im Testmodus. Tasten gehen nur über
// die Entwicklerwerkzeuge an das verborgene Testfenster; kein Kopieren und Einfügen.

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

function gotoFile(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Go to File' });
}

async function activeTab(page: Page): Promise<string | null> {
  const tabs = page.getByRole('tablist', { name: 'Editor Tabs' });
  if ((await tabs.count()) === 0) return null;
  return tabs.getByRole('tab', { selected: true }).getAttribute('aria-label');
}

function focusInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((s) => !!document.activeElement?.closest(s), selector);
}

/** Der Text, den Monaco zeigt, nach der Lage der Zeilen und ohne geschützte Leerzeichen. */
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

/** Der Text des sichtbaren Terminals, ohne die geschützten Leerzeichen von xterm.js. */
async function terminalText(page: Page): Promise<string> {
  return (await page.locator('.terminal-view:not([hidden]) .xterm-rows').innerText()).replace(/ /g, ' ');
}

/** Die Zeilen mit der Eingabeaufforderung von cmd (etwa `C:\…\Alpha>`). */
function promptLines(text: string): string[] {
  return text.split('\n').filter((line) => /^[A-Z]:\\.*>/.test(line));
}

/**
 * Drückt die Tasten nacheinander, ohne zwischen ihnen auf die Antwort der App zu warten: So bleiben die Abstände auch
 * unter Last weit unter dem Zeitfenster von zweimal Shift, und ein Test, der „löst nicht aus“ erwartet, besteht nicht
 * nur, weil die Tasten zu langsam kamen. Playwright schickt sie in dieser Reihenfolge.
 */
async function keys(page: Page, ...steps: [action: 'down' | 'up', key: string][]): Promise<void> {
  await Promise.all(steps.map(([action, key]) => (action === 'down' ? page.keyboard.down(key) : page.keyboard.up(key))));
}

/** Zweimal kurz Shift, auf Wunsch einmal links und einmal rechts. */
function doubleShift(page: Page, first = 'Shift', second = 'Shift'): Promise<void> {
  return keys(page, ['down', first], ['up', first], ['down', second], ['up', second]);
}

/** Länger warten als das Zeitfenster, damit ein falsches Auslösen sichtbar würde. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

describe('Zweimal Shift', () => {
  const tempDir = useTempDirs();

  async function launch(files: Record<string, string>): Promise<{ codium: LaunchedApp; page: Page }> {
    const alpha = path.join(tempDir(), 'Alpha');
    fs.mkdirSync(alpha, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(alpha, relative)), { recursive: true });
      fs.writeFileSync(path.join(alpha, relative), content);
    }
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
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

  /** Öffnet eine Datei im Editor und setzt den Fokus ans Ende ihres Texts. */
  async function editFile(page: Page, name: string): Promise<void> {
    await item(page, name).dblclick();
    await expect.poll(() => activeTab(page)).toBe(name);
    await page.locator('.editor-host .view-lines').click();
    await expect.poll(() => focusInside(page, '.editor-host')).toBe(true);
    await page.keyboard.press('Control+End');
  }

  it('öffnet mit Fokus im Editor „Go to File“; Tippen eines Namens und Enter öffnet die Datei', async () => {
    const { codium, page } = await launch({
      'src/main/java/demo/UserService.java': 'class UserService {}\n',
      'notes.txt': 'hello\n',
    });
    try {
      // Der leere Code-Bereich zeigt beide Kürzel.
      expect(await page.locator('.code-empty-hint', { hasText: 'Go to File' }).locator('kbd').allInnerTexts()).toEqual([
        'Ctrl+Shift+N',
        'Double Shift',
      ]);

      // Während eines Dialogs (hier die Einstellungen) ruht zweimal Shift.
      await page.keyboard.press('Control+Alt+S');
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.waitFor();
      await doubleShift(page);
      await settle();
      expect(await gotoFile(page).count()).toBe(0);
      await page.keyboard.press('Escape');
      await expect.poll(() => settings.count()).toBe(0);

      await editFile(page, 'notes.txt');
      await doubleShift(page, 'ShiftLeft', 'ShiftRight');
      const popup = gotoFile(page);
      await popup.waitFor();
      const input = popup.getByRole('textbox');
      expect(await input.inputValue()).toBe('');
      await expect.poll(() => focusInside(page, '[role="dialog"][aria-label="Go to File"]')).toBe(true);
      await page.keyboard.type('UsrSrv');
      await expect.poll(() => popup.getByRole('option').first().getAttribute('aria-label')).toBe('UserService.java');

      // Nochmals zweimal Shift: Die Suche bleibt offen, die Eingabe bleibt.
      await doubleShift(page);
      await settle();
      expect(await popup.count()).toBe(1);
      expect(await input.inputValue()).toBe('UsrSrv');

      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page)).toBe('UserService.java');
      expect(await popup.count()).toBe(0);
      await expect.poll(() => focusInside(page, '.editor-host')).toBe(true);
    } finally {
      await codium.close();
    }
  });

  it('öffnet beim Tippen von Grossbuchstaben im Editor nichts; die Buchstaben landen im Text', async () => {
    const { codium, page } = await launch({ 'notes.txt': 'hello\n' });
    try {
      await editFile(page, 'notes.txt');
      // Shift + A, Shift + B, schnell hintereinander, dann Shift + C mit einem einzelnen Shift davor.
      await keys(
        page,
        ['down', 'Shift'],
        ['down', 'KeyA'],
        ['up', 'KeyA'],
        ['up', 'Shift'],
        ['down', 'Shift'],
        ['down', 'KeyB'],
        ['up', 'KeyB'],
        ['up', 'Shift'],
        ['down', 'Shift'],
        ['up', 'Shift'],
        ['down', 'Shift'],
        ['down', 'KeyC'],
        ['up', 'KeyC'],
        ['up', 'Shift'],
      );
      await settle();
      expect(await gotoFile(page).count()).toBe(0);
      await expect.poll(() => editorText(page)).toBe('hello\nABC');
      expect(await focusInside(page, '.editor-host')).toBe(true);

      // Gegenprobe mit denselben Abständen: zweimal Shift allein öffnet die Suche.
      await doubleShift(page);
      await gotoFile(page).waitFor();
      await page.keyboard.press('Escape');
      await expect.poll(() => gotoFile(page).count()).toBe(0);
      expect(await editorText(page)).toBe('hello\nABC');
    } finally {
      await codium.close();
    }
  });

  it('öffnet die Suche auch mit Fokus im Terminal; im Terminal kommt nichts an', async () => {
    const { codium, page } = await launch({ 'notes.txt': 'hello\n' });
    try {
      await page.keyboard.press('Alt+F12');
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await expect.poll(() => terminalText(page), { timeout: 15_000 }).toMatch(/>\s*$/m);
      const before = await terminalText(page);
      expect(promptLines(before)).toHaveLength(1);

      await doubleShift(page);
      const popup = gotoFile(page);
      await popup.waitFor();
      await expect.poll(() => focusInside(page, '[role="dialog"][aria-label="Go to File"]')).toBe(true);
      await page.keyboard.type('notes');
      await expect.poll(() => popup.getByRole('option').first().getAttribute('aria-label')).toBe('notes.txt');
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page)).toBe('notes.txt');
      expect(await terminalText(page)).toBe(before);

      // Zurück ins Terminal: Die Zeile ist leer, ein Befehl läuft wie getippt, und es gab kein weiteres Enter.
      await page.keyboard.press('Alt+F12');
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await page.keyboard.type('echo [%OS%]');
      await page.keyboard.press('Enter');
      await expect.poll(() => terminalText(page), { timeout: 15_000 }).toMatch(/^\[Windows_NT\]\s*$/m);
      const after = await terminalText(page);
      expect(promptLines(after)).toHaveLength(2);
      expect(promptLines(after)[0].trimEnd()).toBe(`${promptLines(before)[0].trimEnd()}echo [%OS%]`);
    } finally {
      await codium.close();
    }
  });
});
