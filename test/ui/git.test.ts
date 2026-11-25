// Teststelle 2: Branch-Menü und Git-Konsole in der echten App (Ticket 15), mit einem Temp-Repository und abgeschirmter
// Git-Konfiguration.

import * as path from 'node:path';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote } from '../support/git';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

function branchButton(page: Page, name: string) {
  return page.getByRole('button', { name: `Branch ${name}`, exact: true });
}

describe('Git: Branches und Konsole', () => {
  const tempDir = useTempDirs();

  it('legt im Branch-Menü einen Branch an, wechselt zurück und zeigt die Befehle in der Git-Konsole', async () => {
    const base = tempDir();
    const { repo } = createRepoWithRemote(base);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo], recentProjects: [repo] });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page(`${path.basename(repo)} – Codium`);
      await branchButton(page, 'main').waitFor({ timeout: 15_000 });

      // Neuer Branch, ausgecheckt (Häkchen standardmässig gesetzt): Die Kopfzeile zeigt ihn.
      await branchButton(page, 'main').click();
      const popup = page.getByRole('dialog', { name: 'Git Branches' });
      await popup.getByRole('option', { name: 'New Branch…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Create New Branch' });
      await dialog.getByRole('textbox').fill('feature-x');
      expect(await dialog.getByRole('checkbox', { name: 'Checkout branch' }).isChecked()).toBe(true);
      await dialog.getByRole('button', { name: 'Create' }).click();
      await branchButton(page, 'feature-x').waitFor();

      // Zurück auf main über das Untermenü des Branches; das Suchfeld findet ihn.
      await branchButton(page, 'feature-x').click();
      await popup.getByRole('textbox', { name: 'Search branches' }).fill('mai');
      // main steht auch unter „Recent“ (Ticket 31); hier die Zeile unter „Local“.
      await popup.getByRole('group', { name: 'Local' }).getByRole('option', { name: 'main', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Checkout', exact: true }).click();
      await branchButton(page, 'main').waitFor();

      // Git-Konsole: die Befehle des Nutzers; Abfragen im Hintergrund erst mit dem Schalter.
      await page.keyboard.press('Alt+9');
      // Das Werkzeugfenster zeigt zuerst den Log (Ticket 19).
      await page.getByRole('tablist', { name: 'Git' }).getByRole('tab', { name: 'Console' }).click();
      const consoleLog = page.getByRole('log', { name: 'Git Console' });
      await consoleLog.waitFor();
      await expect.poll(() => consoleLog.innerText()).toContain('git switch -c feature-x');
      expect(await consoleLog.innerText()).toContain('git switch --no-guess main');
      expect(await consoleLog.innerText()).not.toContain('git --no-optional-locks status');
      await page.getByRole('checkbox', { name: 'Show background commands' }).check();
      await expect.poll(() => consoleLog.innerText()).toContain('git --no-optional-locks status');
    } finally {
      await codium.close();
    }
  });

  it('zeigt ohne Repository kein Branch-Menü und „Not a Git repository“', async () => {
    const plain = path.join(tempDir(), 'Plain');
    (await import('node:fs')).mkdirSync(plain);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [plain], recentProjects: [plain] });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page('Plain – Codium');
      await page.keyboard.press('Alt+9');
      await expect.poll(() => page.locator('section[aria-label="Git"]').innerText()).toContain('Not a Git repository');
      expect(await page.getByRole('button', { name: /^Branch / }).count()).toBe(0);
      await page.keyboard.press('Alt+0');
      await expect.poll(() => page.locator('section[aria-label="Commit"]').innerText()).toContain('Not a Git repository');
    } finally {
      await codium.close();
    }
  });
});
