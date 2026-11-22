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

function terminalTab(page: Page, name: string): Locator {
  return page.getByRole('tablist', { name: 'Terminals' }).getByRole('tab', { name, exact: true });
}

/** Der Text des sichtbaren Terminals, ohne die geschützten Leerzeichen von xterm.js. */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator('.terminal-view:not([hidden]) .xterm-rows').innerText()).replace(/ /g, ' ');
}

async function focusInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((s) => document.activeElement?.closest(s) !== null && document.activeElement?.closest(s) !== undefined, selector);
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

  it('öffnet mit Alt + F12 ein Terminal im Projektordner, führt echo aus und öffnet über den Baum ein zweites', async () => {
    const { codium, page, alpha } = await launch();
    try {
      await page.keyboard.press('Alt+F12');
      await terminalTab(page, 'Local').waitFor();
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toContain('>');
      await page.keyboard.type('echo CODIUM_%OS%_[%CD%]');
      await page.keyboard.press('Enter');
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toContain(`CODIUM_Windows_NT_[${alpha}]`);

      // „Open in Terminal“ auf einem Unterordner: ein zweites Terminal dort.
      await item(page, 'sub folder').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Open in Terminal' }).click();
      await terminalTab(page, 'Local (2)').waitFor();
      expect(await terminalTab(page, 'Local (2)').getAttribute('aria-selected')).toBe('true');
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await page.keyboard.type('echo [%CD%]');
      await page.keyboard.press('Enter');
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toContain(`[${path.join(alpha, 'sub folder')}]`);

      // Umbenennen per Doppelklick, Schliessen beendet das Terminal.
      await terminalTab(page, 'Local (2)').dblclick();
      await page.getByRole('textbox', { name: 'Rename Terminal' }).fill('Server');
      await page.keyboard.press('Enter');
      await terminalTab(page, 'Server').waitFor();
      await page.getByRole('button', { name: 'Close Server' }).click();
      await expect.poll(() => page.getByRole('tablist', { name: 'Terminals' }).getByRole('tab').count()).toBe(1);
    } finally {
      await codium.close();
    }
  });

  it('gibt Ctrl + R und Esc der Shell; Alt + 1 wechselt zum Werkzeugfenster „Project“', async () => {
    const { codium, page } = await launch();
    try {
      // Eine Datei im Editor: Ctrl + R öffnete dort „Ersetzen“.
      await item(page, 'notes.txt').dblclick();
      await page.locator('.editor-host .view-lines').waitFor();
      await page.keyboard.press('Alt+F12');
      await expect.poll(() => focusInside(page, '.terminal-view')).toBe(true);
      await expect.poll(() => visibleText(page), { timeout: 15_000 }).toContain('>');

      await page.keyboard.press('Control+r');
      await page.keyboard.press('Control+Shift+n');
      await page.keyboard.press('Escape');
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Keine IDE-Aktion: kein Suchen/Ersetzen im Editor, kein Suchfenster; Fokus und Werkzeugfenster bleiben.
      expect(await page.locator('.editor-host .find-widget.visible').count()).toBe(0);
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await focusInside(page, '.terminal-view')).toBe(true);
      expect(await page.getByRole('region', { name: 'Shell: Local' }).isVisible()).toBe(true);

      // Alt + 1 wirkt auch im Terminal.
      await page.keyboard.press('Alt+1');
      await expect.poll(() => focusInside(page, 'section[aria-label="Project"]')).toBe(true);
    } finally {
      await codium.close();
    }
  });
});
