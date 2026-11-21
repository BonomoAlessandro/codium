// Teststelle 2: „Clone Repository“ aus dem Willkommensfenster in der echten App, mit einem lokalen Bare-Repository als
// Quelle; die Git-Konfiguration ist abgeschirmt (Starthilfe).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote } from '../support/git';
import { launchCodium } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';

describe('Repository klonen', () => {
  const tempDir = useTempDirs();

  it('klont aus dem Willkommensfenster und öffnet das Projekt in einem neuen Fenster', async () => {
    const base = tempDir();
    const source = createRepoWithRemote(base);
    const target = path.join(base, 'clones', 'remote');
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      const page = await codium.page(WELCOME);
      const button = page.getByRole('button', { name: 'Clone Repository' });
      await expect.poll(() => button.isEnabled()).toBe(true);
      await button.click();
      const dialog = page.getByRole('dialog', { name: 'Clone Repository' });
      await dialog.waitFor();
      await dialog.getByLabel('URL').fill(source.remote);
      // Der Vorschlag endet auf den Ordnernamen aus der Adresse.
      await expect.poll(async () => (await dialog.getByLabel('Directory').inputValue()).endsWith(path.sep + 'remote')).toBe(true);
      await dialog.getByLabel('Directory').fill(target);
      await dialog.getByRole('button', { name: 'Clone' }).click();

      const project = await codium.page('remote – Codium');
      await project.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name: 'README.md', exact: true }).waitFor({ timeout: 15_000 });
      expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
      await expect.poll(() => codium.windowTitles()).toEqual(['remote – Codium']);
    } finally {
      await codium.close();
    }
  });

  it('zeigt die Meldung von Git, wenn die Quelle fehlt, und lässt keinen Ordner zurück', async () => {
    const base = tempDir();
    const target = path.join(base, 'never');
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      const page = await codium.page(WELCOME);
      await page.getByRole('button', { name: 'Clone Repository' }).click();
      const dialog = page.getByRole('dialog', { name: 'Clone Repository' });
      await dialog.getByLabel('URL').fill(path.join(base, 'missing.git'));
      await dialog.getByLabel('Directory').fill(target);
      await dialog.getByRole('button', { name: 'Clone' }).click();
      await expect.poll(() => dialog.getByRole('alert').innerText()).toMatch(/does not exist|not appear to be a git repository/i);
      expect(fs.existsSync(target)).toBe(false);
      // Der Fokus steht wieder in der Adresse: korrigieren und mit Enter erneut klonen geht ohne Klick.
      await expect.poll(() => dialog.getByLabel('URL').evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => dialog.count()).toBe(0);
    } finally {
      await codium.close();
    }
  });

  it('bricht einen hängenden Klon mit „Cancel“ ab und beendet Git', async () => {
    const base = tempDir();
    const target = path.join(base, 'hanging', 'app');
    // Eine Quelle, die nie antwortet (Transport `ext::`, nur hier erlaubt); Node schreibt seine Prozessnummer.
    const pidFile = path.join(base, 'remote.pid');
    const node = process.execPath.replace(/%/g, '%%').replace(/ /g, '% ');
    const script = 'require("fs").writeFileSync(process.env.CODIUM_PIDFILE,""+process.pid);setInterval(()=>0,1e3)';
    const codium = await launchCodium({
      dataRoot: tempDir(),
      env: { CODIUM_PIDFILE: pidFile, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.ext.allow', GIT_CONFIG_VALUE_0: 'always' },
    });
    try {
      const page = await codium.page(WELCOME);
      await page.getByRole('button', { name: 'Clone Repository' }).click();
      const dialog = page.getByRole('dialog', { name: 'Clone Repository' });
      await dialog.getByLabel('URL').fill(`ext::${node} -e ${script}`);
      await dialog.getByLabel('Directory').fill(target);
      await dialog.getByRole('button', { name: 'Clone' }).click();
      await expect.poll(() => fs.existsSync(pidFile), { timeout: 15_000 }).toBe(true);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(() => dialog.getByRole('alert').innerText()).toBe('Cloning was cancelled.');
      const alive = () => {
        try {
          process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 0);
          return true;
        } catch {
          return false;
        }
      };
      expect(alive()).toBe(false);
      expect(fs.existsSync(path.join(base, 'hanging'))).toBe(false);
      // Danach schliesst „Cancel“ den Dialog wie gewohnt.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(() => dialog.count()).toBe(0);
    } finally {
      await codium.close();
    }
  });

  it('ist ohne Git aus, mit Erklärung beim Überfahren', async () => {
    const codium = await launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_NO_GIT: '1' } });
    try {
      const page = await codium.page(WELCOME);
      const button = page.getByRole('button', { name: 'Clone Repository' });
      await expect.poll(() => button.getAttribute('title')).toBe('Git not found. Install Git to clone repositories.');
      expect(await button.isDisabled()).toBe(true);
    } finally {
      await codium.close();
    }
  });
});
