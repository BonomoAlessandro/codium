// Teststelle 2: Werkzeugfenster „Terminal“ in der echten App (Ticket 11), mit cmd als eingestellter Shell (das
// Testgerüst stellt sie ein). Kein Kopieren und Einfügen (das ginge in die echte Zwischenablage).

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

function terminalTabs(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Terminals' }).getByRole('tab');
}

function terminalTab(page: Page, name: string): Locator {
  return page.getByRole('tablist', { name: 'Terminals' }).getByRole('tab', { name, exact: true });
}

/** Der Text des sichtbaren Terminals, ohne die geschützten Leerzeichen von xterm.js. */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator('.terminal-view:not([hidden]) .xterm-rows').innerText()).replace(/ /g, ' ');
}

async function focusInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((s) => !!document.activeElement?.closest(s), selector);
}

/** Wartet auf die Eingabeaufforderung von cmd im sichtbaren Terminal. */
async function prompt(page: Page): Promise<void> {
  await expect.poll(() => visibleText(page), { timeout: 15_000 }).toMatch(/>\s*$/m);
}

describe('Terminal', () => {
  const tempDir = useTempDirs();

  async function launch(): Promise<{ codium: LaunchedApp; page: Page; alpha: string }> {
    const alpha = path.join(tempDir(), 'Alpha');
    fs.mkdirSync(path.join(alpha, 'sub folder'), { recursive: true });
    fs.writeFileSync(path.join(alpha, 'notes.txt'), 'hello\n');
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page(ALPHA);
    await item(page, 'Alpha').waitFor({ timeout: 15_000 });
    return { codium, page, alpha };
  }

  it('öffnet „Open in Terminal“ als erste Aktion im gewählten Ordner, „+“ ein weiteres im Projektordner', async () => {
    const { codium, page, alpha } = await launch();
    try {
      // Das Werkzeugfenster war in dieser Sitzung noch nie offen (Review von Ticket 11).
      await item(page, 'sub folder').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Open in Terminal' }).click();
      await terminalTab(page, 'Local').waitFor();
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await prompt(page);
      await page.keyboard.type('echo CODIUM_%OS%_[%CD%]');
      await page.keyboard.press('Enter');
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toContain(`CODIUM_Windows_NT_[${path.join(alpha, 'sub folder')}]`);
      expect(await terminalTabs(page).count()).toBe(1);

      // „+“: ein weiteres Terminal, im Projektordner.
      await page.getByRole('button', { name: 'New Terminal' }).click();
      await terminalTab(page, 'Local (2)').waitFor();
      expect(await terminalTab(page, 'Local (2)').getAttribute('aria-selected')).toBe('true');
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await prompt(page);
      await page.keyboard.type('echo [%CD%]');
      await page.keyboard.press('Enter');
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toContain(`[${alpha}]`);

      // Umbenennen per Doppelklick, Schliessen beendet das Terminal.
      await terminalTab(page, 'Local (2)').dblclick();
      await page.getByRole('textbox', { name: 'Rename Terminal' }).fill('Server');
      await page.keyboard.press('Enter');
      await terminalTab(page, 'Server').waitFor();
      await page.getByRole('button', { name: 'Close Server' }).click();
      await expect.poll(() => terminalTabs(page).count()).toBe(1);
    } finally {
      await codium.close();
    }
  });

  it('gibt Esc und Fensterkürzel der Shell; Alt + 1 wechselt zum Werkzeugfenster „Project“', async () => {
    const { codium, page } = await launch();
    try {
      // Eine Datei im Editor: Ctrl + F4 schlösse ihren Tab, Ctrl + Shift + N öffnete „Go to File“.
      await item(page, 'notes.txt').dblclick();
      await page.locator('.editor-host .view-lines').waitFor();
      await page.keyboard.press('Alt+F12');
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await prompt(page);

      await page.keyboard.press('Control+F4');
      await page.keyboard.press('Control+Shift+n');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await page.getByRole('tab', { name: /notes\.txt/ }).count()).toBe(1);
      expect(await page.getByRole('dialog').count()).toBe(0);

      // Esc kommt bei der Shell an: cmd leert damit die Zeile.
      await page.keyboard.type('abc');
      await page.keyboard.press('Escape');
      await page.keyboard.type('echo ESC_%OS%');
      await page.keyboard.press('Enter');
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toMatch(/^ESC_Windows_NT\s*$/m);
      expect(await visibleText(page)).not.toContain('abcecho');
      expect(await focusInside(page, '.terminal-view')).toBe(true);

      // Alt + 1 wirkt auch im Terminal.
      await page.keyboard.press('Alt+1');
      await expect.poll(() => focusInside(page, 'section[aria-label="Project"]')).toBe(true);
    } finally {
      await codium.close();
    }
  });

  it('lässt „Git“ stehen, wenn im Hintergrund die letzte Shell endet', async () => {
    const { codium, page } = await launch();
    try {
      await page.keyboard.press('Alt+F12');
      await prompt(page);
      await page.keyboard.type('ping -n 3 127.0.0.1 >nul & exit');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Alt+9');
      const git = page.getByRole('region', { name: 'Git', exact: true });
      await git.waitFor();
      await expect.poll(() => terminalTabs(page).count(), { timeout: 15_000 }).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await git.isVisible()).toBe(true);
    } finally {
      await codium.close();
    }
  });

  it('zeigt im Einstellungsdialog die gefundenen Shells', async () => {
    const { codium, page } = await launch();
    try {
      await page.keyboard.press('Control+Alt+S');
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      const field = dialog.getByLabel('Terminal shell');
      await expect
        .poll(() => field.locator('option').allInnerTexts())
        .toEqual(expect.arrayContaining([expect.stringMatching(/^Default \(/), expect.stringMatching(/^cmd – .*cmd\.exe$/i)]));
      expect(await field.inputValue()).toBe('cmd');
      await field.selectOption('');
      await dialog.getByRole('button', { name: 'OK' }).click();
      await expect.poll(() => dialog.count()).toBe(0);
      await page.keyboard.press('Control+Alt+S');
      expect(await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Terminal shell').inputValue()).toBe('');
      await page.keyboard.press('Escape');
    } finally {
      await codium.close();
    }
  });
});
