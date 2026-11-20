// Teststelle 2: Projektfenster und Willkommensfenster in der echten App, gesteuert mit Playwright im Testmodus.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';

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
    return { dataRoot: tempDir(), projects };
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
      await expect.poll(() => project.locator('h1').textContent()).toBe('Alpha');
      const picked = (await codium.recorded()).filter((e) => e.kind === 'folder-picked');
      expect(picked).toMatchObject([{ detail: { title: 'Open Folder', picked: alpha } }]);
    });
  });

  it('zwei Projekte öffnen, das erste erneut öffnen: kein drittes Fenster, das vorhandene kommt nach vorne', async () => {
    const { dataRoot, projects } = setup('Alpha', 'Beta');
    const [alpha, beta] = projects;
    prepareAppState(dataRoot, { recentProjects: [beta] });
    const codium = await launchCodium({ dataRoot, env: { CODIUM_TEST_PICK_DIR: alpha } });
    await withApp(codium, async () => {
      // Alpha über „Open Folder“, Beta aus den zuletzt geöffneten Projekten.
      await (await codium.page(WELCOME)).getByRole('button', { name: 'Open Folder' }).click();
      const alphaPage = await codium.page('Alpha – Codium');
      await alphaPage.getByRole('button', { name: /^Beta/ }).click();
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual(['Alpha – Codium', 'Beta – Codium']);
      const alphaWindow = await codium.windowId('Alpha – Codium');

      // Aus Betas Fenster Alpha noch einmal über „Open Folder“ wählen.
      await (await codium.page('Beta – Codium')).getByRole('button', { name: 'Open Folder' }).click();
      await expect
        .poll(async () => (await codium.recorded()).filter((e) => e.kind === 'window-focused'), { timeout: 15_000 })
        .toMatchObject([{ detail: { windowId: alphaWindow } }]);
      expect(await codium.windowTitles()).toEqual(['Alpha – Codium', 'Beta – Codium']);
      expect((await codium.recorded()).filter((e) => e.kind === 'window-opened')).toHaveLength(3);
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

  it('„Exit“ und das letzte Fenster beenden Codium; beim nächsten Start öffnen die richtigen Projekte', async () => {
    const { dataRoot, projects } = setup('Alpha', 'Beta');
    prepareAppState(dataRoot, { openProjects: projects });

    // „Exit“ mit zwei offenen Projekten: Beide gelten als offen.
    let codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      await (await codium.page('Beta – Codium')).getByRole('button', { name: 'Exit' }).click();
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
});
