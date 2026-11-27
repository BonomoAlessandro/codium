// Teststelle 2: Branch-Dropdown nach Ticket 33 in der echten App: Das Untermenü einer Branchzeile geht nur per Klick
// auf (bzw. mit Enter oder Pfeil rechts), und jeder Klick daneben schliesst das Dropdown, auch im Editor, im Dateibaum,
// im Terminal, in der Markdown-Vorschau und auf der leeren Kopfzeile, ebenso der Fokusverlust des Fensters. Solange
// ein Popup offen ist, ist die Kopfzeile keine Zieh-Fläche; das gilt auch für Projektmenü, Kontextmenüs und
// Suchfenster.
//
// Temp-Repository mit Bare-Remote im Temp-Ordner, abgeschirmte Git-Konfiguration, kein echter Server. Klicks und Tasten
// gehen nur über die Entwicklerwerkzeuge der App; sie erreichen die Seite auch dort, wo Windows einen echten Klick als
// Klick auf die Titelleiste behandelt. Ob Windows einen Klick an die Seite gibt, fragt der Test deshalb zusätzlich
// beim Fenster selbst nach (WM_NCHITTEST, nur lesend). Den echten Fokusverlust gibt es im Testmodus nicht (Fenster
// nicht aktivierbar, Ticket 27); nachgestellt wird er mit einem `blur` am Fenster.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { TestEvent } from '../../src/main/testMode';
import { createRepoWithRemote, type RepoWithRemote } from '../support/git';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { HTCAPTION, HTCLIENT, hitTest } from '../support/nativeWindow';
import { useTempDirs } from '../support/tempDir';

/** Wartezeit für Abfragen an die App; die Grundeinstellung von expect.poll reicht unter Last nicht. */
const APP = { timeout: 10_000 };
/** Länger, als das Untermenü früher beim Überfahren wartete (200 ms), und länger als im Ticket verlangt (500 ms). */
const REST_MS = 800;
const TITLE = 'repo – Codium';

function branchButton(page: Page, name = 'main'): Locator {
  return page.getByRole('button', { name: `Branch ${name}`, exact: true });
}

function dropdown(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Git Branches' });
}

function submenu(page: Page, name: string): Locator {
  return page.getByRole('menu', { name, exact: true });
}

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
}

function focusInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((s) => !!document.activeElement?.closest(s), selector);
}

function selectedLabel(page: Page): Promise<string | null> {
  return dropdown(page).locator('[role="option"][aria-selected="true"]').getAttribute('aria-label');
}

/** Zieh-Fläche laut Stil: `drag` oder `no-drag`. */
function headerRegion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('header.header')!);
    return style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region');
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Öffnet das Dropdown und wartet, bis die Branches geladen sind. */
async function openDropdown(page: Page): Promise<Locator> {
  await branchButton(page).click();
  const popup = dropdown(page);
  await popup.getByRole('group', { name: 'Local', exact: true }).waitFor();
  return popup;
}

async function expectClosed(page: Page): Promise<void> {
  await expect.poll(() => dropdown(page).count(), APP).toBe(0);
  expect(await branchButton(page).getAttribute('aria-expanded')).toBe('false');
}

/**
 * Was Windows an zwei Stellen der Kopfzeile meldet: auf ihrer leeren Fläche (rechts im freien Rand vor den
 * Fensterknöpfen) und auf dem Branch-Knopf. HTCAPTION heisst: Ein echter Klick dort ginge an die Titelleiste, nicht an
 * die Seite.
 */
async function headerHits(codium: LaunchedApp, page: Page): Promise<{ empty: number; button: number }> {
  const css = await page.evaluate(() => {
    const content = document.querySelector('.header-content')!.getBoundingClientRect();
    const header = document.querySelector('header.header')!.getBoundingClientRect();
    const button = document.querySelector('.branch-widget')!.getBoundingClientRect();
    return {
      width: window.innerWidth,
      points: [
        { x: content.right - 24, y: header.top + header.height / 2 },
        { x: button.left + button.width / 2, y: button.top + button.height / 2 },
      ],
    };
  });
  const hwnd = await codium.app.evaluate(({ BrowserWindow }, title) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title);
    if (!win) throw new Error(`Kein Fenster „${title}“.`);
    return win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  }, TITLE);
  const [empty, button] = hitTest(hwnd, css.width, css.points);
  return { empty, button };
}

/** Klickt auf den Teil einer Zeile im Dateibaum, den das Dropdown nicht überdeckt (es hängt unter dem Branch-Knopf). */
async function clickBesideDropdown(page: Page, row: Locator): Promise<void> {
  const box = await row.boundingBox();
  const popup = await dropdown(page).boundingBox();
  if (!box || !popup) throw new Error('Zeile oder Dropdown ist nicht sichtbar.');
  const free = popup.x - box.x;
  if (free < 8) throw new Error('Das Dropdown überdeckt die ganze Zeile.');
  await row.click({ position: { x: free / 2, y: box.height / 2 } });
}

/** Klickt über die Entwicklerwerkzeuge auf die leere Fläche der Kopfzeile. */
async function clickEmptyHeader(page: Page): Promise<void> {
  const at = await page.evaluate(() => {
    const content = document.querySelector('.header-content')!.getBoundingClientRect();
    const header = document.querySelector('header.header')!.getBoundingClientRect();
    return { x: content.right - 24, y: header.top + header.height / 2 };
  });
  await page.mouse.click(at.x, at.y);
}

describe('Branch-Dropdown: Untermenü per Klick, Schliessen bei Klick daneben (Ticket 33)', () => {
  const tempDir = useTempDirs();

  async function launch(prepare?: (repo: RepoWithRemote) => void) {
    const repo = createRepoWithRemote(tempDir());
    prepare?.(repo);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page(TITLE);
    await branchButton(page).waitFor({ timeout: 15_000 });
    return { ...repo, codium, page };
  }

  it('öffnet das Untermenü erst per Klick; Überfahren öffnet, wechselt und schliesst keines', async () => {
    const { codium, page } = await launch((repo) => {
      repo.run('branch', 'alpha');
      repo.run('branch', 'beta');
    });
    try {
      const popup = await openDropdown(page);
      const alpha = popup.getByRole('option', { name: 'alpha', exact: true });
      const beta = popup.getByRole('option', { name: 'beta', exact: true });

      // Die Maus ruht auf „alpha“: Die Zeile ist hervorgehoben, ein Untermenü geht nicht auf, der Fokus bleibt im Suchfeld.
      await alpha.hover();
      await wait(REST_MS);
      expect(await selectedLabel(page)).toBe('alpha');
      expect(await page.getByRole('menu').count()).toBe(0);
      expect(await focusedLabel(page)).toBe('Search branches');

      // Ein Klick öffnet es rechts daneben.
      await alpha.click();
      await submenu(page, 'alpha').waitFor();
      expect(await alpha.getAttribute('class')).toContain('open');

      // Überfahren einer anderen Branchzeile und einer Aktion ändert nichts am offenen Untermenü; hervorgehoben wird
      // weiter die Zeile unter der Maus.
      await beta.hover();
      await wait(REST_MS);
      expect(await selectedLabel(page)).toBe('beta');
      await popup.getByRole('option', { name: 'Pull', exact: true }).hover();
      await wait(REST_MS);
      expect(await selectedLabel(page)).toBe('Pull');
      expect(await submenu(page, 'alpha').count()).toBe(1);
      expect(await page.getByRole('menu').count()).toBe(1);

      // Ein Klick auf eine andere Branchzeile öffnet deren Untermenü an seiner Stelle.
      await beta.click();
      await submenu(page, 'beta').waitFor();
      await expect.poll(() => submenu(page, 'alpha').count(), APP).toBe(0);

      // Ein Klick auf die Zeile des offenen Untermenüs schliesst es; das Dropdown bleibt offen, der Fokus im Suchfeld.
      await beta.click();
      await expect.poll(() => page.getByRole('menu').count(), APP).toBe(0);
      expect(await popup.count()).toBe(1);
      expect(await focusedLabel(page)).toBe('Search branches');

      // Ein weiterer Klick öffnet es wieder; „Checkout“ darin wechselt den Branch.
      await beta.click();
      await submenu(page, 'beta').getByRole('menuitem', { name: 'Checkout', exact: true }).click();
      await branchButton(page, 'beta').waitFor();
    } finally {
      await codium.close();
    }
  });

  it('schliesst bei einem Klick in Editor, Dateibaum, Terminal und Markdown-Vorschau; der Klick wirkt dort weiter', async () => {
    const { codium, page } = await launch((repo) => {
      fs.writeFileSync(path.join(repo.repo, 'notes.txt'), 'erste Zeile\nzweite Zeile\ndritte Zeile\n');
      fs.writeFileSync(path.join(repo.repo, 'README.md'), '# Testprojekt\n\n[Website](https://example.com/docs)\n');
    });
    try {
      await item(page, 'notes.txt').dblclick();
      const third = page.locator('.editor-host .view-line', { hasText: 'dritte Zeile' });
      await third.waitFor();

      // Editor: Das Dropdown schliesst, der Cursor landet in der angeklickten Zeile, der Fokus im Editor.
      await openDropdown(page);
      await third.click();
      await expectClosed(page);
      await expect.poll(() => page.getByLabel('Line and column', { exact: true }).innerText(), APP).toMatch(/^3:/);
      expect(await focusInside(page, '.editor-host')).toBe(true);

      // Dateibaum: Die angeklickte Datei ist danach gewählt.
      await openDropdown(page);
      await clickBesideDropdown(page, item(page, 'README.md'));
      await expectClosed(page);
      await expect.poll(() => item(page, 'README.md').getAttribute('aria-selected'), APP).toBe('true');

      // Markdown-Vorschau: Der angeklickte Link geht zusätzlich an den Browser (im Testmodus aufgezeichnet).
      await item(page, 'README.md').dblclick();
      const preview = page.getByRole('document', { name: 'Markdown Preview' });
      await preview.getByRole('heading', { name: 'Testprojekt' }).waitFor();
      await openDropdown(page);
      await preview.getByRole('link', { name: 'Website' }).click();
      await expectClosed(page);
      await expect
        .poll(async () => (await codium.recorded()).filter((e: TestEvent) => e.kind === 'open-external').map((e) => (e.detail as { url: string }).url), APP)
        .toEqual(['https://example.com/docs']);

      // Terminal (Werkzeugfenster): Der Fokus geht danach ins Terminal.
      await page.keyboard.press('Alt+F12');
      const screen = page.locator('.terminal-view:not([hidden]) .xterm-screen');
      await screen.waitFor({ timeout: 15_000 });
      await openDropdown(page);
      await screen.click();
      await expectClosed(page);
      await expect.poll(() => focusInside(page, '.terminal-view'), APP).toBe(true);
    } finally {
      await codium.close();
    }
  });

  it('nimmt der Kopfzeile die Zieh-Fläche, solange es offen ist; Klick darauf, Fokusverlust und Grössenänderung schliessen', async () => {
    const { codium, page } = await launch();
    try {
      // Geschlossen: Die leere Kopfzeile ist Zieh-Fläche, der Branch-Knopf nicht.
      expect(await headerRegion(page)).toBe('drag');
      expect(await headerHits(codium, page)).toEqual({ empty: HTCAPTION, button: HTCLIENT });

      // Offen: Auch ein echter Klick auf die leere Kopfzeile ginge an die Seite.
      await openDropdown(page);
      expect(await headerRegion(page)).toBe('no-drag');
      await expect.poll(async () => (await headerHits(codium, page)).empty, { timeout: 15_000 }).toBe(HTCLIENT);

      // Der Klick schliesst das Dropdown; der Fokus geht an den Branch-Knopf, die Zieh-Fläche ist wieder da.
      await clickEmptyHeader(page);
      await expectClosed(page);
      await expect.poll(() => focusedLabel(page), APP).toBe('Branch main');
      expect(await headerRegion(page)).toBe('drag');
      await expect.poll(async () => (await headerHits(codium, page)).empty, { timeout: 15_000 }).toBe(HTCAPTION);

      // Fokusverlust des Fensters (nachgestellt): schliesst, der Fokus liegt wieder auf dem Branch-Knopf.
      await openDropdown(page);
      await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
      await expectClosed(page);
      expect(await focusedLabel(page)).toBe('Branch main');
      expect(await headerRegion(page)).toBe('drag');

      // Grössenänderung (Fensterrand, Maximieren): schliesst ebenfalls.
      await openDropdown(page);
      await codium.app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.setSize(w.getSize()[0] - 40, w.getSize()[1]);
      });
      await expectClosed(page);
      expect(await headerRegion(page)).toBe('drag');

      // Ein Fokusverlust, solange das Untermenü offen ist, schliesst beides.
      await (await openDropdown(page)).getByRole('option', { name: 'main', exact: true }).click();
      await submenu(page, 'main').waitFor();
      await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
      await expectClosed(page);
      expect(await page.getByRole('menu').count()).toBe(0);
      expect(await headerRegion(page)).toBe('drag');
    } finally {
      await codium.close();
    }
  });

  it('nimmt der Kopfzeile auch bei Projektmenü, Kontextmenü und Suchfenster die Zieh-Fläche; ein Klick darauf schliesst sie', async () => {
    const { codium, page } = await launch();
    try {
      // Projektmenü: Auch ein echter Klick auf die leere Kopfzeile ginge an die Seite und schliesst es.
      await page.locator('.project-widget').click();
      const projectMenu = page.getByRole('menu', { name: 'Project', exact: true });
      await projectMenu.waitFor();
      expect(await headerRegion(page)).toBe('no-drag');
      await expect.poll(async () => (await headerHits(codium, page)).empty, { timeout: 15_000 }).toBe(HTCLIENT);
      await clickEmptyHeader(page);
      await expect.poll(() => projectMenu.count(), APP).toBe(0);
      expect(await headerRegion(page)).toBe('drag');
      await expect.poll(async () => (await headerHits(codium, page)).empty, { timeout: 15_000 }).toBe(HTCAPTION);

      // Kontextmenü im Dateibaum.
      await item(page, 'README.md').click({ button: 'right' });
      await page.getByRole('menuitem').first().waitFor();
      expect(await headerRegion(page)).toBe('no-drag');
      await clickEmptyHeader(page);
      await expect.poll(() => page.getByRole('menu').count(), APP).toBe(0);
      expect(await headerRegion(page)).toBe('drag');

      // Suchfenster „Recent Files“: Sein Hintergrund fängt den Klick über der Kopfzeile.
      await item(page, 'README.md').click();
      await page.keyboard.press('Control+E');
      const recent = page.getByRole('dialog', { name: 'Recent Files' });
      await recent.waitFor();
      expect(await headerRegion(page)).toBe('no-drag');
      await clickEmptyHeader(page);
      await expect.poll(() => recent.count(), APP).toBe(0);
      expect(await headerRegion(page)).toBe('drag');
    } finally {
      await codium.close();
    }
  });
});
