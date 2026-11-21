// Teststelle 2: Projektfenster, Willkommensfenster und Projektmenü in der echten App, gesteuert mit Playwright im
// Testmodus.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { RecentProject, ResponseMessage } from '../../src/shared/types';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';

/** Öffnet das Projektmenü in der Kopfzeile (Projektname mit Pfeil). */
async function openProjectMenu(page: Page, projectName: string) {
  await page.getByRole('button', { name: projectName, exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Project' });
  await menu.waitFor();
  return menu;
}

/** Die zuletzt geöffneten Projekte, wie der Kern sie dem Fenster meldet. */
async function recentProjects(page: Page): Promise<string[]> {
  const response = await page.evaluate(() =>
    (window as unknown as { codium: { invoke(name: string): Promise<unknown> } }).codium.invoke('app.recentProjects'),
  );
  return ((response as ResponseMessage & { ok: true }).result as RecentProject[]).map((p) => p.path);
}

describe('Projektfenster', () => {
  const tempDir = useTempDirs();

  /** Projektordner in einem Temp-Ordner und ein eigener Datenordner. */
  function setup(...names: string[]) {
    const root = tempDir();
    const projects = names.map((name) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      return dir;
    });
    return { root, dataRoot: tempDir(), projects };
  }

  async function withApp(codium: LaunchedApp, body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } finally {
      await codium.close();
    }
  }

  it('zeigt das Willkommensfenster; „Open Folder“ öffnet ein Projektfenster mit dem richtigen Titel', async () => {
    const { dataRoot, projects } = setup('Alpha');
    const [alpha] = projects;
    const codium = await launchCodium({ dataRoot, env: { CODIUM_TEST_PICK_DIR: alpha } });
    await withApp(codium, async () => {
      const welcome = await codium.page(WELCOME);
      expect(await codium.windowTitles()).toEqual([WELCOME]);
      await welcome.getByRole('button', { name: 'Open Folder' }).click();

      // Das Projekt öffnet in einem eigenen Fenster, das Willkommensfenster schliesst sich.
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Alpha – Codium']);
      const project = await codium.page('Alpha – Codium');
      // Die Kopfzeile zeigt den Projektnamen im Projektmenü.
      await expect.poll(() => project.locator('.project-widget .header-widget-label').textContent()).toBe('Alpha');
      const picked = (await codium.recorded()).filter((e) => e.kind === 'folder-picked');
      expect(picked).toMatchObject([{ detail: { title: 'Open Folder', picked: alpha } }]);
    });
  });

  it('das Projektmenü listet die zuletzt geöffneten Projekte; ein offenes Projekt kommt nach vorne statt neu', async () => {
    const { dataRoot, projects } = setup('Alpha', 'Beta', 'Gamma');
    const [alpha, beta, gamma] = projects;
    const menuLabels = (menu: Awaited<ReturnType<typeof openProjectMenu>>) =>
      menu.getByRole('menuitem').evaluateAll((els) => els.map((el) => el.querySelector('.menu-item-label')?.textContent));
    prepareAppState(dataRoot, { recentProjects: [beta, gamma] });
    const codium = await launchCodium({ dataRoot, env: { CODIUM_TEST_PICK_DIR: alpha } });
    await withApp(codium, async () => {
      // Alpha über „Open Folder“; im Projektmenü stehen die anderen zuletzt geöffneten, Alpha selbst nicht.
      await (await codium.page(WELCOME)).getByRole('button', { name: 'Open Folder' }).click();
      const alphaPage = await codium.page('Alpha – Codium');
      let menu = await openProjectMenu(alphaPage, 'Alpha');
      expect(await menuLabels(menu)).toEqual(['Open Folder…', 'Clone Repository…', 'Beta', 'Gamma', 'Settings…', 'Exit']);
      expect(await menu.getByRole('menuitem', { name: /^Gamma/ }).getAttribute('title')).toBe(gamma);

      // Beta aus dem Projektmenü öffnen.
      await menu.getByRole('menuitem', { name: /^Beta/ }).click();
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Alpha – Codium', 'Beta – Codium']);
      expect(await alphaPage.getByRole('menu').count()).toBe(0);
      const alphaWindow = await codium.windowId('Alpha – Codium');

      // Aus Betas Fenster Alpha noch einmal über „Open Folder…“ wählen: kein drittes Fenster, Alpha kommt nach vorne.
      const betaPage = await codium.page('Beta – Codium');
      menu = await openProjectMenu(betaPage, 'Beta');
      // Neueste zuerst: Beta wurde zuletzt geöffnet, davor Alpha.
      expect(await menuLabels(menu)).toEqual(['Open Folder…', 'Clone Repository…', 'Alpha', 'Gamma', 'Settings…', 'Exit']);
      expect(await menu.getByRole('menuitem', { name: /^Alpha/ }).getAttribute('title')).toBe(alpha);
      await menu.getByRole('menuitem', { name: 'Open Folder…' }).click();
      await expect
        .poll(async () => (await codium.recorded()).filter((e) => e.kind === 'window-focused'), { timeout: 15_000 })
        .toMatchObject([{ detail: { windowId: alphaWindow } }]);
      expect(await codium.windowTitles()).toEqual(['Alpha – Codium', 'Beta – Codium']);
      expect((await codium.recorded()).filter((e) => e.kind === 'window-opened')).toHaveLength(3);

      // Escape schliesst das Menü, ohne etwas auszuführen.
      menu = await openProjectMenu(betaPage, 'Beta');
      await betaPage.keyboard.press('Escape');
      await expect.poll(() => betaPage.getByRole('menu').count()).toBe(0);
      expect(await codium.windowTitles()).toEqual(['Alpha – Codium', 'Beta – Codium']);
    });
  });

  it('ein zweiter Start holt das zuletzt benutzte Fenster nach vorne und endet sofort', async () => {
    const { dataRoot, projects } = setup('Alpha', 'Beta');
    prepareAppState(dataRoot, { openProjects: projects, recentProjects: [...projects].reverse() });
    const codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Alpha – Codium', 'Beta – Codium']);
      const betaWindow = await codium.windowId('Beta – Codium');

      await codium.startSecondInstance();
      await expect
        .poll(async () => (await codium.recorded()).filter((e) => e.kind === 'window-focused'), { timeout: 15_000 })
        .toMatchObject([{ detail: { windowId: betaWindow } }]);
      expect(await codium.windowTitles()).toEqual(['Alpha – Codium', 'Beta – Codium']);
    });
  });

  it('„Exit“ im Projektmenü und das letzte Fenster beenden Codium; beim nächsten Start öffnen die richtigen Projekte', async () => {
    const { dataRoot, projects } = setup('Alpha', 'Beta');
    prepareAppState(dataRoot, { openProjects: projects });

    // „Exit“ mit zwei offenen Projekten: Beide gelten als offen.
    let codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      const menu = await openProjectMenu(await codium.page('Beta – Codium'), 'Beta');
      await menu.getByRole('menuitem', { name: 'Exit' }).click();
      await codium.exited();
    });

    // Beide sind wieder da. Erst Alpha schliessen, dann Beta: Nur Beta gilt als offen.
    codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Alpha – Codium', 'Beta – Codium']);
      const closeWindow = (title: string) =>
        codium.app.evaluate(({ BrowserWindow }, wanted) => {
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === wanted)
            ?.close();
        }, title);
      await closeWindow('Alpha – Codium');
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Beta – Codium']);
      await closeWindow('Beta – Codium');
      await codium.exited();
    });

    codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Beta – Codium']);
    });
  });

  it('meldet einen fehlenden Projektordner beim Start; der Knopf der Meldung entfernt ihn aus der Liste', async () => {
    const { root, dataRoot, projects } = setup('Alpha');
    const [alpha] = projects;
    const gone = path.join(root, 'Weg');
    prepareAppState(dataRoot, { openProjects: [gone, alpha], recentProjects: [gone, alpha] });
    const codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      const page = await codium.page('Alpha – Codium');
      const notice = page.getByRole('alert').filter({ hasText: `Project folder not found: ${gone}` });
      await expect.poll(() => notice.count(), { timeout: 15_000 }).toBe(1);
      expect(await recentProjects(page)).toEqual([gone, alpha]);

      await notice.getByRole('button', { name: 'Remove from List' }).click();
      await expect.poll(() => notice.count()).toBe(0);
      await expect.poll(() => recentProjects(page)).toEqual([alpha]);
      const menu = await openProjectMenu(page, 'Alpha');
      expect(await menu.getByRole('menuitem', { name: /^Weg/ }).count()).toBe(0);
    });
  });
});
