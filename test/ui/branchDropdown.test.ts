// Teststelle 2: das Branch-Dropdown der Kopfzeile (Ticket 25) in der echten App, mit einem Temp-Repository, einem
// Bare-Remote im Temp-Ordner und einem zweiten Klon; abgeschirmte Git-Konfiguration, kein echter Server. Klicks und
// Tasten gehen nur über die Entwicklerwerkzeuge der App.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote, git } from '../support/git';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

/** Wartezeit für Abfragen an die App; die Grundeinstellung von expect.poll (1 s) reicht unter Last nicht. */
const APP = { timeout: 10_000 };

function branchButton(page: Page, name = 'main'): Locator {
  return page.getByRole('button', { name: `Branch ${name}`, exact: true });
}

function dropdown(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Git Branches' });
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await locator.boundingBox();
  if (!result) throw new Error('Element ist nicht sichtbar.');
  return result;
}

/** Name des Elements mit dem Fokus (zugänglicher Name aus aria-label). */
function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
}

/** Öffnet das Dropdown und wartet, bis die Branches geladen sind. */
async function openDropdown(page: Page, firstBranch: string): Promise<Locator> {
  await branchButton(page).click();
  const popup = dropdown(page);
  await popup.getByRole('option', { name: firstBranch, exact: true }).waitFor();
  return popup;
}

/** Wählt per Pfeil runter den Eintrag mit diesem Namen. */
async function selectByKeyboard(page: Page, popup: Locator, name: string): Promise<void> {
  const selected = () => popup.locator('[role="option"][aria-selected="true"]').getAttribute('aria-label');
  for (let i = 0; i < 10 && (await selected()) !== name; i++) await page.keyboard.press('ArrowDown');
  expect(await selected()).toBe(name);
}

describe('Branch-Dropdown', () => {
  const tempDir = useTempDirs();

  async function launch(prepare?: (repo: ReturnType<typeof createRepoWithRemote>) => void) {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    repo.run('config', 'pull.rebase', 'false');
    prepare?.(repo);
    const otherDir = path.join(base, 'other');
    git(base, repo.env, 'clone', repo.remote, otherDir);
    const other = (...a: string[]) => git(otherDir, repo.env, ...a);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page('repo – Codium');
    await branchButton(page).waitFor({ timeout: 15_000 });
    /** Ein Commit im zweiten Klon, auf den Remote geschoben. */
    const remoteCommit = (file: string) => {
      fs.writeFileSync(path.join(otherDir, file), `${file}\n`);
      other('add', file);
      other('commit', '-m', `remote ${file}`);
      other('push');
    };
    return { ...repo, codium, page, remoteCommit };
  }

  /** Ändert die Fenstergrösse (bleibt im Testmodus ausserhalb des Bildschirms). */
  async function resize(codium: LaunchedApp, width: number, height: number): Promise<void> {
    await codium.app.evaluate(
      ({ BrowserWindow }, size) => {
        for (const w of BrowserWindow.getAllWindows()) w.setSize(size.width, size.height);
      },
      { width, height },
    );
  }

  it('öffnet direkt unter dem Branch-Knopf; Aktionen mit Symbol und Kürzel, Fetch in der Titelzeile', async () => {
    const { codium, page, run, remote, repo, remoteCommit } = await launch();
    try {
      const popup = await openDropdown(page, 'main');

      // Oberkante knapp unter der Unterkante des Knopfs, links bündig.
      const button = await box(branchButton(page));
      const panel = await box(popup);
      expect(panel.y - (button.y + button.height)).toBeGreaterThanOrEqual(0);
      expect(panel.y - (button.y + button.height)).toBeLessThanOrEqual(8);
      expect(Math.abs(panel.x - button.x)).toBeLessThanOrEqual(1);
      expect(await branchButton(page).getAttribute('aria-expanded')).toBe('true');

      // Aktionen mit Symbol und, wo Codium eines hat, dem Kürzel rechts.
      const expected = [
        ['Pull', 'Ctrl+T'],
        ['Commit…', 'Ctrl+K'],
        ['Push…', 'Ctrl+Shift+K'],
        ['New Branch…', null],
      ] as const;
      for (const [name, shortcut] of expected) {
        const option = popup.getByRole('option', { name, exact: true });
        expect(await option.locator('svg.icon').count(), name).toBe(1);
        expect(await option.getAttribute('aria-keyshortcuts'), name).toBe(shortcut);
        expect(await option.locator('.branch-row-shortcut').allTextContents(), name).toEqual(shortcut ? [shortcut] : []);
      }
      // Der aktuelle Branch trägt sein eigenes Symbol statt des Texts „current“.
      expect(await popup.getByRole('option', { name: 'main', exact: true }).locator('.icon-head').count()).toBe(1);
      expect(await popup.innerText()).not.toContain('current');

      // „Fetch“ in der Titelzeile holt die neuen Commits des Remotes; die Kopfzeile zeigt sie als eingehend. Der Fokus
      // liegt danach auf dem Branch-Knopf.
      remoteCommit('fern.txt');
      await popup.getByRole('button', { name: 'Fetch', exact: true }).click();
      await expect.poll(() => page.getByRole('status').filter({ hasText: 'Fetched from all remotes.' }).count(), { timeout: 30_000 }).toBe(1);
      expect(await popup.count()).toBe(0);
      await expect.poll(() => focusedLabel(page), APP).toBe('Branch main');
      await expect.poll(() => page.locator('.branch-widget .branch-sync-incoming').textContent(), { timeout: 15_000 }).toBe('1');

      // „Pull“ holt sie in den Branch.
      await (await openDropdown(page, 'main')).getByRole('option', { name: 'Pull', exact: true }).click();
      await expect.poll(() => page.getByRole('status').filter({ hasText: 'Pulled.' }).count(), { timeout: 30_000 }).toBe(1);
      expect(run('rev-parse', 'HEAD')).toBe(run('rev-parse', 'origin/main'));

      // „Push…“ schiebt einen neuen Commit.
      fs.writeFileSync(path.join(repo, 'lokal.txt'), 'lokal\n');
      run('add', 'lokal.txt');
      run('commit', '-m', 'lokal');
      await (await openDropdown(page, 'main')).getByRole('option', { name: 'Push…', exact: true }).click();
      await expect.poll(() => page.getByRole('status').filter({ hasText: 'Pushed main to origin/main' }).count(), { timeout: 30_000 }).toBe(1);
      expect(git(path.dirname(remote), {}, '--git-dir', remote, 'rev-parse', 'main')).toBe(run('rev-parse', 'HEAD'));

      // „Commit…“ öffnet die Änderungsansicht, „New Branch…“ den Dialog; nach dessen Abbruch liegt der Fokus wieder auf
      // dem Branch-Knopf.
      await (await openDropdown(page, 'main')).getByRole('option', { name: 'Commit…', exact: true }).click();
      await page.locator('section[aria-label="Commit"]').waitFor();
      await (await openDropdown(page, 'main')).getByRole('option', { name: 'New Branch…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Create New Branch' });
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await expect.poll(() => dialog.count(), APP).toBe(0);
      await expect.poll(() => focusedLabel(page), APP).toBe('Branch main');
    } finally {
      await codium.close();
    }
  });

  it('bedient sich mit Pfeilen, Enter, Pfeil rechts und links, Escape und mit der Maus', async () => {
    const { codium, page } = await launch((repo) => repo.run('branch', 'feature'));
    try {
      const popup = await openDropdown(page, 'feature');
      const search = popup.getByRole('textbox', { name: 'Search branches' });
      expect(await focusedLabel(page)).toBe('Search branches');

      // Pfeile wählen; die Aktionen stehen vor den Branches.
      expect(await popup.locator('[role="option"][aria-selected="true"]').getAttribute('aria-label')).toBe('Pull');
      await selectByKeyboard(page, popup, 'feature');

      // Enter öffnet das Untermenü rechts neben der Zeile, den ersten Eintrag hervorgehoben.
      await page.keyboard.press('Enter');
      const submenu = page.getByRole('menu', { name: 'feature', exact: true });
      await submenu.waitFor();
      expect(await submenu.getAttribute('aria-activedescendant')).not.toBeNull();
      const row = await box(popup.getByRole('option', { name: 'feature', exact: true }));
      expect((await box(submenu)).x).toBeGreaterThanOrEqual(row.x + row.width - 4);
      expect(await submenu.getByRole('menuitem', { name: 'Checkout', exact: true }).locator('svg.icon').count()).toBe(1);

      // Pfeil links schliesst es, der Fokus ist wieder im Suchfeld; Pfeil rechts öffnet es erneut.
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => submenu.count(), APP).toBe(0);
      expect(await focusedLabel(page)).toBe('Search branches');
      await page.keyboard.press('ArrowRight');
      await submenu.waitFor();

      // Escape schliesst erst das Untermenü, dann das Dropdown; der Fokus geht an den Branch-Knopf zurück.
      await page.keyboard.press('Escape');
      await expect.poll(() => submenu.count(), APP).toBe(0);
      expect(await popup.count()).toBe(1);
      await page.keyboard.press('Escape');
      await expect.poll(() => popup.count(), APP).toBe(0);
      expect(await focusedLabel(page)).toBe('Branch main');
      expect(await branchButton(page).getAttribute('aria-expanded')).toBe('false');

      // Mit der Maus: Ein Klick öffnet das Untermenü, der Fokus geht hinein (Überfahren öffnet keines mehr, Ticket 33,
      // branchDropdownClick.test.ts). Ein getipptes Zeichen schliesst es und geht ins Suchfeld, Tippen filtert weiter.
      await openDropdown(page, 'feature');
      await popup.getByRole('option', { name: 'feature', exact: true }).click();
      await submenu.waitFor();
      expect(await focusedLabel(page)).toBe('feature');
      await page.keyboard.type('fea');
      await expect.poll(() => search.inputValue(), APP).toBe('fea');
      await expect.poll(() => submenu.count(), APP).toBe(0);
      expect(await focusedLabel(page)).toBe('Search branches');

      // Ebenso im per Tastatur geöffneten Untermenü.
      await page.keyboard.press('Enter');
      await submenu.waitFor();
      expect(await focusedLabel(page)).toBe('feature');
      await page.keyboard.type('t');
      await expect.poll(() => submenu.count(), APP).toBe(0);
      expect(await search.inputValue()).toBe('feat');
      expect(await focusedLabel(page)).toBe('Search branches');

      // Ein Klick daneben schliesst das Dropdown, der Fokus geht an den Branch-Knopf.
      await page.locator('.statusbar').click();
      await expect.poll(() => popup.count(), APP).toBe(0);
      await expect.poll(() => focusedLabel(page), APP).toBe('Branch main');

      // Ein zweiter Klick auf den Knopf schliesst es ebenfalls, ein Tastenkürzel der App auch.
      await openDropdown(page, 'feature');
      await branchButton(page).click();
      await expect.poll(() => popup.count(), APP).toBe(0);
      await openDropdown(page, 'feature');
      await page.keyboard.press('Alt+1');
      await expect.poll(() => popup.count(), APP).toBe(0);
    } finally {
      await codium.close();
    }
  });

  it('legt das Untermenü bei schmalem Fenster nie über die eigene Zeile', async () => {
    const { codium, page } = await launch((repo) => repo.run('branch', 'feature-with-a-rather-long-name'));
    try {
      await resize(codium, 720, 640);
      const popup = await openDropdown(page, 'feature-with-a-rather-long-name');
      await selectByKeyboard(page, popup, 'feature-with-a-rather-long-name');
      await page.keyboard.press('Enter');
      const submenu = page.getByRole('menu', { name: 'feature-with-a-rather-long-name', exact: true });
      await submenu.waitFor();
      const row = await box(popup.getByRole('option', { name: 'feature-with-a-rather-long-name', exact: true }));
      const panel = await box(popup);
      const menu = await box(submenu);
      const besideRight = menu.x >= row.x + row.width - 4;
      const besideLeft = menu.x + menu.width <= panel.x + 4;
      const belowOrAbove = menu.y >= row.y + row.height - 1 || menu.y + menu.height <= row.y + 1;
      expect(besideRight || besideLeft || belowOrAbove).toBe(true);
      expect(menu.x + menu.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    } finally {
      await codium.close();
    }
  });
});
