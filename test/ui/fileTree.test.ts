// Teststelle 2: der Dateibaum im Werkzeugfenster „Project“ in der echten App, gesteuert mit Playwright im Testmodus.
// Klicks und Tasten gehen nur über die Entwicklerwerkzeuge der App. Kein Ctrl + C oder Ctrl + V: Kopieren und
// Einfügen laufen hier über das Rechtsklick-Menü, „Copy Path“ landet in der Aufzeichnung des Testmodus.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { dataFolder } from '../../src/main/dataFolder';
import { launchCodium, prepareAppState, prepareProjectState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';

function tree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Project Files' });
}

function item(page: Page, name: string): Locator {
  return tree(page).getByRole('treeitem', { name, exact: true });
}

/** Die Namen der ausgewählten Zeilen. */
function selectedNames(page: Page): Promise<(string | null)[]> {
  return tree(page)
    .locator('[role="treeitem"][aria-selected="true"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
}

/** Die Beschriftungen der offenen Datei-Tabs; „Datei öffnen“ aus dem Baum öffnet einen Tab. */
function openTabs(page: Page): Promise<(string | null)[]> {
  return page
    .getByRole('tablist', { name: 'Editor Tabs' })
    .getByRole('tab')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
}

/** Öffnet das Rechtsklick-Menü einer Zeile. */
async function contextMenu(page: Page, name: string): Promise<Locator> {
  await item(page, name).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Project Files', exact: true });
  await menu.waitFor();
  return menu;
}

describe('Dateibaum', () => {
  const tempDir = useTempDirs();

  /** Ein Projekt „Alpha“ mit einigen Dateien, das beim Start offen ist. */
  function setup(files: Record<string, string> = { 'src/main/Main.java': 'class Main {}', 'README.md': '# Alpha' }) {
    const alpha = path.join(tempDir(), 'Alpha');
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(alpha, relative)), { recursive: true });
      fs.writeFileSync(path.join(alpha, relative), content);
    }
    fs.mkdirSync(alpha, { recursive: true });
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    return { alpha, dataRoot };
  }

  /** Startet Codium und wartet, bis der Baum den Projektordner zeigt. */
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

  it('klappt Ordner auf, legt über das Rechtsklick-Menü eine Datei an, benennt sie um und löscht sie mit Rückfrage', async () => {
    const { alpha, dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      // Ohne gespeicherten Zustand ist der Projektordner aufgeklappt.
      expect(await item(page, 'Alpha').getAttribute('aria-expanded')).toBe('true');
      await item(page, 'README.md').waitFor();
      expect(await item(page, 'src').getAttribute('aria-expanded')).toBe('false');
      expect(await page.getByRole('button', { name: 'Select Opened File' }).isDisabled()).toBe(true);

      // Doppelklick klappt auf, Einfachklick wählt nur aus.
      await item(page, 'src').dblclick();
      await item(page, 'main').click();
      expect(await selectedNames(page)).toEqual(['main']);
      expect(await item(page, 'main').getAttribute('aria-expanded')).toBe('false');
      await item(page, 'main').locator('.file-tree-arrow').click();
      await item(page, 'Main.java').waitFor();
      expect(await selectedNames(page)).toEqual(['main']);

      // New → File im Ordner „main“; die neue Datei ist ausgewählt und wird geöffnet.
      const menu = await contextMenu(page, 'main');
      await menu.getByRole('menuitem', { name: 'New', exact: true }).hover();
      await page.getByRole('menu', { name: 'New', exact: true }).getByRole('menuitem', { name: 'File', exact: true }).click();
      const newFile = page.getByRole('dialog', { name: 'New File' });
      await newFile.getByRole('textbox').fill('Util.java');
      await newFile.getByRole('textbox').press('Enter');
      await newFile.waitFor({ state: 'detached' });
      const util = path.join(alpha, 'src', 'main', 'Util.java');
      expect(fs.readFileSync(util, 'utf8')).toBe('');
      await item(page, 'Util.java').waitFor();
      await expect.poll(() => selectedNames(page)).toEqual(['Util.java']);
      await expect.poll(() => openTabs(page)).toEqual(['Util.java']);

      // Rename… zeigt bei Java-Dateien den Hinweis und markiert den Namen ohne Endung.
      await (await contextMenu(page, 'Util.java')).getByRole('menuitem', { name: 'Rename…', exact: true }).click();
      const rename = page.getByRole('dialog', { name: 'Rename' });
      const field = rename.getByRole('textbox');
      expect(await field.inputValue()).toBe('Util.java');
      expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 4]);
      await expect.poll(() => rename.getByText('References to the class in other files are not updated.').isVisible()).toBe(true);
      // Ein vergebener Name wird gleich im Dialog abgelehnt.
      await field.fill('Main.java');
      expect(await rename.getByRole('alert').textContent()).toBe('“Main.java” already exists.');
      expect(await rename.getByRole('button', { name: 'Rename' }).isDisabled()).toBe(true);
      await field.fill('Helper.java');
      await field.press('Enter');
      await rename.waitFor({ state: 'detached' });
      const helper = path.join(alpha, 'src', 'main', 'Helper.java');
      expect(fs.existsSync(helper)).toBe(true);
      expect(fs.existsSync(util)).toBe(false);
      await item(page, 'Helper.java').waitFor();
      await expect.poll(() => selectedNames(page)).toEqual(['Helper.java']);
      expect(await item(page, 'Util.java').count()).toBe(0);

      // Delete… fragt nach und verschiebt in den Papierkorb des Testmodus.
      await (await contextMenu(page, 'Helper.java')).getByRole('menuitem', { name: 'Delete…', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete' });
      expect(await confirm.getByRole('list', { name: 'Affected items' }).textContent()).toBe('src/main/Helper.java');
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect.poll(() => fs.existsSync(helper)).toBe(false);
      const trashDir = path.join(dataFolder(dataRoot, false), 'test-trash');
      expect(fs.readdirSync(trashDir).filter((name) => name.endsWith('-Helper.java'))).toHaveLength(1);
      expect((await codium.recorded()).filter((e) => e.kind === 'trash').map((e) => (e.detail as { path: string }).path)).toEqual([helper]);
      await expect.poll(() => item(page, 'Helper.java').count()).toBe(0);
      // Die Auswahl geht wie in IntelliJ auf den Nachbarn.
      expect(await selectedNames(page)).toEqual(['Main.java']);
    });
  });

  it('zeigt eine von aussen angelegte Datei, ohne aufgeklappte Ordner oder Auswahl zu verlieren', async () => {
    const { alpha, dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await item(page, 'src').dblclick();
      await item(page, 'main').dblclick();
      await item(page, 'Main.java').click();

      fs.writeFileSync(path.join(alpha, 'external.txt'), 'von aussen');
      fs.writeFileSync(path.join(alpha, 'src', 'main', 'Other.java'), 'class Other {}');
      await item(page, 'external.txt').waitFor();
      await item(page, 'Other.java').waitFor();
      expect(await item(page, 'src').getAttribute('aria-expanded')).toBe('true');
      expect(await item(page, 'main').getAttribute('aria-expanded')).toBe('true');
      expect(await selectedNames(page)).toEqual(['Main.java']);

      // Von aussen gelöscht verschwindet sie wieder.
      fs.rmSync(path.join(alpha, 'external.txt'));
      await expect.poll(() => item(page, 'external.txt').count()).toBe(0);
      expect(await selectedNames(page)).toEqual(['Main.java']);

      // Verschwindet ein aufgeklappter Ordner von aussen und kommt zurück (etwa bei einem Branch-Wechsel), ist er
      // wieder aufgeklappt.
      const src = path.join(alpha, 'src');
      const saved = path.join(path.dirname(alpha), 'src-saved');
      fs.renameSync(src, saved);
      await expect.poll(() => item(page, 'src').count()).toBe(0);
      fs.renameSync(saved, src);
      await item(page, 'Main.java').waitFor();
      expect(await item(page, 'src').getAttribute('aria-expanded')).toBe('true');
      expect(await item(page, 'main').getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('zeigt einen Link nach draussen mit Hinweis, klappt ihn nicht auf und löscht nur den Link', async () => {
    const { alpha, dataRoot } = setup();
    const outside = path.join(path.dirname(alpha), 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'geheim');
    fs.symlinkSync(outside, path.join(alpha, 'shared'), 'junction');
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      const link = item(page, 'shared');
      await link.waitFor();
      expect(await link.getAttribute('aria-expanded')).toBeNull();
      expect(await link.getAttribute('title')).toBe('Link to a location outside the project. Codium does not follow it.');
      // Doppelklick tut nichts: keine Fehlermeldung, nichts geöffnet.
      await link.dblclick();
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Nur die Meldungen von Codium; Monaco hat eigene, leere Bereiche mit `role="alert"` für Screenreader.
      expect(await page.locator('.notice[role="alert"]').count()).toBe(0);
      expect(await openTabs(page)).toEqual([]);

      const menu = await contextMenu(page, 'shared');
      expect(await menu.getByRole('menuitem', { name: 'Copy', exact: true }).getAttribute('aria-disabled')).toBe('true');
      await menu.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete' });
      expect(await confirm.getByText('Only the link is moved to the Recycle Bin, not its target.', { exact: false }).count()).toBe(1);
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect.poll(() => item(page, 'shared').count()).toBe(0);
      expect(fs.existsSync(path.join(alpha, 'shared'))).toBe(false);
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('geheim');
    });
  });

  it('lässt sich mit der Tastatur bedienen wie IntelliJ', async () => {
    const { alpha, dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await item(page, 'README.md').click();
      await page.keyboard.press('Home');
      expect(await selectedNames(page)).toEqual(['Alpha']);
      await page.keyboard.press('ArrowDown');
      expect(await selectedNames(page)).toEqual(['src']);
      // Pfeil rechts klappt auf, ein zweites Mal geht es zum ersten Eintrag.
      await page.keyboard.press('ArrowRight');
      await item(page, 'main').waitFor();
      await page.keyboard.press('ArrowRight');
      expect(await selectedNames(page)).toEqual(['main']);
      await page.keyboard.press('Enter');
      await item(page, 'Main.java').waitFor();
      await page.keyboard.press('ArrowDown');
      expect(await selectedNames(page)).toEqual(['Main.java']);
      // Enter auf einer Datei öffnet sie in einem Tab, mit dem Fokus im Editor; ein Klick holt ihn zurück in den Baum.
      await page.keyboard.press('Enter');
      await expect.poll(() => openTabs(page)).toEqual(['Main.java']);
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.editor-host') !== null)).toBe(true);
      await item(page, 'Main.java').click();
      // Pfeil links geht zum Elternordner, ein zweites Mal klappt es ihn zu.
      await page.keyboard.press('ArrowLeft');
      expect(await selectedNames(page)).toEqual(['main']);
      await page.keyboard.press('ArrowLeft');
      expect(await item(page, 'main').getAttribute('aria-expanded')).toBe('false');
      expect(await item(page, 'Main.java').count()).toBe(0);
      // Shift + Pfeil erweitert die Auswahl.
      await page.keyboard.press('Shift+ArrowDown');
      expect(await selectedNames(page)).toEqual(['main', 'README.md']);

      // F2 und Shift + F6 benennen um, Entf löscht, jeweils mit Dialog; Escape bricht ab.
      await page.keyboard.press('ArrowDown');
      expect(await selectedNames(page)).toEqual(['README.md']);
      for (const key of ['F2', 'Shift+F6']) {
        await page.keyboard.press(key);
        const rename = page.getByRole('dialog', { name: 'Rename' });
        await rename.waitFor();
        expect(await rename.getByRole('textbox').inputValue()).toBe('README.md');
        await page.keyboard.press('Escape');
        await rename.waitFor({ state: 'detached' });
      }
      await page.keyboard.press('Delete');
      const confirm = page.getByRole('dialog', { name: 'Delete' });
      await confirm.waitFor();
      await page.keyboard.press('Escape');
      await confirm.waitFor({ state: 'detached' });
      expect(fs.existsSync(path.join(alpha, 'README.md'))).toBe(true);
      // Nach dem Dialog hat der Baum den Fokus wieder.
      await page.keyboard.press('ArrowUp');
      expect(await selectedNames(page)).toEqual(['main']);

      // Shift + F10 öffnet das Rechtsklick-Menü; „Open in Terminal“ ist aktiv (Ticket 11).
      await page.keyboard.press('Shift+F10');
      const menu = page.getByRole('menu', { name: 'Project Files', exact: true });
      await menu.waitFor();
      expect(await menu.getByRole('menuitem', { name: 'Open in Terminal' }).getAttribute('aria-disabled')).not.toBe('true');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
    });
  });

  it('kopiert und fügt ein, mit Namensvorschlag bei einem Konflikt; Copy Path und Open in Explorer laufen über den Port', async () => {
    const { alpha, dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await (await contextMenu(page, 'README.md')).getByRole('menuitem', { name: 'Copy', exact: true }).click();
      await (await contextMenu(page, 'Alpha')).getByRole('menuitem', { name: 'Paste', exact: true }).click();
      const copy = page.getByRole('dialog', { name: 'Copy' });
      // Unter Last kommt der Dialog erst nach dem Klick: auf ihn warten, nicht sofort lesen.
      await copy.waitFor({ timeout: 15_000 });
      expect(await copy.getByRole('textbox').inputValue()).toBe('README (2).md');
      await copy.getByRole('textbox').press('Enter');
      await copy.waitFor({ state: 'detached' });
      expect(fs.readFileSync(path.join(alpha, 'README (2).md'), 'utf8')).toBe('# Alpha');
      await item(page, 'README (2).md').waitFor();
      await expect.poll(() => selectedNames(page)).toEqual(['README (2).md']);

      // In einen anderen Ordner ohne Konflikt: ohne Dialog. Der Zielordner geht auf, die Kopie ist ausgewählt.
      await (await contextMenu(page, 'src')).getByRole('menuitem', { name: 'Paste', exact: true }).click();
      await expect.poll(() => fs.existsSync(path.join(alpha, 'src', 'README.md'))).toBe(true);
      await expect.poll(() => item(page, 'README.md').count()).toBe(2);
      expect(await item(page, 'src').getAttribute('aria-expanded')).toBe('true');
      await item(page, 'src').locator('.file-tree-arrow').click();
      await expect.poll(() => item(page, 'README.md').count()).toBe(1);

      await (await contextMenu(page, 'README.md')).getByRole('menuitem', { name: 'Copy Path', exact: true }).click();
      await (await contextMenu(page, 'README.md')).getByRole('menuitem', { name: 'Open in Explorer', exact: true }).click();
      await expect.poll(async () => (await codium.recorded()).map((e) => e.kind)).toEqual(
        expect.arrayContaining(['clipboard-write', 'show-in-explorer']),
      );
      const recorded = await codium.recorded();
      const readme = path.join(alpha, 'README.md');
      expect(recorded.find((e) => e.kind === 'clipboard-write')?.detail).toEqual({ text: readme });
      expect(recorded.find((e) => e.kind === 'show-in-explorer')?.detail).toEqual({ path: readme });
    });
  });

  it('aufgeklappte Ordner überstehen einen Neustart', async () => {
    const { dataRoot } = setup();
    let { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await item(page, 'src').dblclick();
      await item(page, 'main').dblclick();
      await item(page, 'Main.java').waitFor();
      await page.getByRole('button', { name: 'Alpha', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Exit' }).click();
      await codium.exited();
    });

    ({ codium, page } = await launchAlpha(dataRoot));
    await withApp(codium, async () => {
      await item(page, 'Main.java').waitFor();
      expect(await item(page, 'src').getAttribute('aria-expanded')).toBe('true');
      expect(await item(page, 'main').getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('Zuklappen schliesst die Ordner darin (Ticket 29)', () => {
    const NESTED = { 'a/b/c/deep.txt': 'tief', 'a/b/note.txt': 'Notiz', 'README.md': '# Alpha' };

    const expanded = (page: Page, name: string) => item(page, name).getAttribute('aria-expanded');

    /** Klick auf den Pfeil der Zeile; er klappt auf bzw. zu und lässt die Auswahl stehen. */
    async function clickArrow(page: Page, name: string, after: 'true' | 'false'): Promise<void> {
      await item(page, name).locator('.file-tree-arrow').click();
      await expect.poll(() => expanded(page, name)).toBe(after);
    }

    it('mit Maus und Tastatur, auch aus einem älteren Zustand und nach einem Neustart', async () => {
      const { alpha, dataRoot } = setup(NESTED);
      // Ein Zustand von vor Ticket 29: a zu, a/b gemerkt. Auch daraus geht a nur mit der ersten Ebene auf.
      prepareProjectState(dataRoot, alpha, { expandedFolders: ['', 'a/b'] });
      let { codium, page } = await launchAlpha(dataRoot);
      await withApp(codium, async () => {
        expect(await expanded(page, 'a')).toBe('false');
        await clickArrow(page, 'a', 'true');
        await item(page, 'b').waitFor();
        expect(await expanded(page, 'b')).toBe('false');

        // Maus: b auf, a zu, a wieder auf: b ist zu, c nicht zu sehen.
        await clickArrow(page, 'b', 'true');
        await item(page, 'c').waitFor();
        await clickArrow(page, 'a', 'false');
        await expect.poll(() => item(page, 'b').count()).toBe(0);
        await clickArrow(page, 'a', 'true');
        await item(page, 'b').waitFor();
        expect(await expanded(page, 'b')).toBe('false');
        expect(await item(page, 'c').count()).toBe(0);

        // Tastatur: Pfeil rechts klappt b auf, Pfeil links klappt a zu, Pfeil rechts wieder auf: b ist zu.
        await item(page, 'b').click();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => expanded(page, 'b')).toBe('true');
        await item(page, 'c').waitFor();
        await page.keyboard.press('ArrowUp');
        expect(await selectedNames(page)).toEqual(['a']);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => expanded(page, 'a')).toBe('false');
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => expanded(page, 'a')).toBe('true');
        await item(page, 'b').waitFor();
        expect(await expanded(page, 'b')).toBe('false');
        expect(await item(page, 'c').count()).toBe(0);

        // Für den Neustart: b auf, dann a zu; so beendet.
        await clickArrow(page, 'b', 'true');
        await clickArrow(page, 'a', 'false');
        await page.getByRole('button', { name: 'Alpha', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Exit' }).click();
        await codium.exited();
      });

      ({ codium, page } = await launchAlpha(dataRoot));
      await withApp(codium, async () => {
        await item(page, 'README.md').waitFor();
        expect(await expanded(page, 'a')).toBe('false');
        await clickArrow(page, 'a', 'true');
        await item(page, 'b').waitFor();
        expect(await expanded(page, 'b')).toBe('false');
      });
    });

    it('„Select Opened File“ klappt die Ordner bis zu einer Datei in einem zugeklappten Unterordner wieder auf', async () => {
      const { dataRoot } = setup(NESTED);
      const { codium, page } = await launchAlpha(dataRoot);
      await withApp(codium, async () => {
        await clickArrow(page, 'a', 'true');
        await clickArrow(page, 'b', 'true');
        await clickArrow(page, 'c', 'true');
        await item(page, 'deep.txt').click();
        await page.keyboard.press('Enter');
        await expect.poll(() => openTabs(page)).toEqual(['deep.txt']);

        // a zu: b und c gelten jetzt auch als zu.
        await clickArrow(page, 'a', 'false');
        await clickArrow(page, 'a', 'true');
        expect(await expanded(page, 'b')).toBe('false');
        await clickArrow(page, 'a', 'false');

        await page.getByRole('button', { name: 'Select Opened File' }).click();
        await expect.poll(() => item(page, 'deep.txt').getAttribute('aria-selected')).toBe('true');
        expect([await expanded(page, 'a'), await expanded(page, 'b'), await expanded(page, 'c')]).toEqual(['true', 'true', 'true']);
        expect(await selectedNames(page)).toEqual(['deep.txt']);
      });
    });
  });

  it('bleibt bei einem grossen Ordner schlank: Es sind nur die sichtbaren Zeilen gezeichnet', async () => {
    const files: Record<string, string> = { 'README.md': '' };
    for (let i = 0; i < 5000; i++) files[`node_modules/package-${String(i).padStart(4, '0')}.js`] = '';
    const { dataRoot } = setup(files);
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await item(page, 'node_modules').dblclick();
      await item(page, 'package-0000.js').waitFor();
      expect(await tree(page).getByRole('treeitem').count()).toBeLessThan(120);

      // Ganz nach unten: Die letzten Einträge sind da, die ersten nicht mehr gezeichnet.
      await tree(page).evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await item(page, 'package-4999.js').waitFor();
      expect(await item(page, 'package-0000.js').count()).toBe(0);
      expect(await tree(page).getByRole('treeitem').count()).toBeLessThan(120);
    });
  });
});
