// Teststelle 2: Layout des Projektfensters in der echten App (Kopfzeile, Werkzeugfenster, Statusleiste, Meldungen,
// Rückfragen), gesteuert mit Playwright im Testmodus. Klicks, Ziehen und Tasten gehen nur über die
// Entwicklerwerkzeuge der App, nie über echte Eingaben.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { RecentProject, ResponseMessage } from '../../src/shared/types';
import { CODE_MIN_HEIGHT, CODE_MIN_WIDTH } from '../../src/renderer/project/toolWindowLayout';
import { WINDOW_BACKGROUND } from '../../src/shared/theme';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Die sichtbaren Werkzeugfenster: links, rechts, unten. */
function shownToolWindows(page: Page): Promise<(string | null)[]> {
  return page.locator('section.tool-window').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
}

/** Das Werkzeugfenster, in dem der Fokus liegt, falls einer darin liegt. */
function focusedToolWindow(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.closest('section.tool-window')?.getAttribute('aria-label') ?? null);
}

/** Das Symbol eines Werkzeugfensters in den Symbolleisten. */
function stripeButton(page: Page, name: string): Locator {
  return page.getByRole('navigation').getByRole('button', { name, exact: true });
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await locator.boundingBox();
  if (!result) throw new Error('Element ist nicht sichtbar.');
  return result;
}

/** Zieht ein Element um so viele Pixel, in kleinen Schritten wie eine Maus. */
async function dragBy(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const b = await box(handle);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

describe('Layout des Projektfensters', () => {
  const tempDir = useTempDirs();

  /** Ein Projekt „Alpha“, das beim Start offen ist. */
  function setup() {
    const root = tempDir();
    const alpha = path.join(root, 'Alpha');
    fs.mkdirSync(alpha);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    return { root, alpha, dataRoot };
  }

  /** Startet Codium und wartet, bis das Layout von Alpha geladen ist. */
  async function launchAlpha(dataRoot: string, env?: Record<string, string>): Promise<{ codium: LaunchedApp; page: Page }> {
    const codium = await launchCodium({ dataRoot, env });
    try {
      const page = await codium.page(ALPHA);
      await expect.poll(() => stripeButton(page, 'Project').isEnabled(), { timeout: 15_000 }).toBe(true);
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

  it('ist immer dunkel, mit eigener Kopfzeile als Zieh-Fläche und den Fensterknöpfen von Windows darüber', async () => {
    const { root, dataRoot } = setup();
    const beta = path.join(root, 'Beta');
    fs.mkdirSync(beta);
    const { codium, page } = await launchAlpha(dataRoot, { CODIUM_TEST_PICK_DIR: beta });
    await withApp(codium, async () => {
      const lookOfPage = await page.evaluate(() => {
        const header = document.querySelector('header.header')!;
        const widget = document.querySelector('.project-widget')!;
        const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } })
          .windowControlsOverlay;
        const area = overlay?.getTitlebarAreaRect();
        const appRegion = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region');
        return {
          lang: document.documentElement.lang,
          overlayVisible: overlay?.visible ?? false,
          headerHeight: header.getBoundingClientRect().height,
          headerRegion: appRegion(header),
          widgetRegion: appRegion(widget),
          // Nichts Bedienbares der Kopfzeile reicht unter die Fensterknöpfe.
          contentRight: document.querySelector('.header-content')!.getBoundingClientRect().right,
          titlebarRight: area ? area.x + area.width : null,
          body: getComputedStyle(document.body).backgroundColor,
        };
      });
      expect(lookOfPage).toMatchObject({
        lang: 'en',
        overlayVisible: true,
        headerHeight: 40,
        headerRegion: 'drag',
        widgetRegion: 'no-drag',
        body: 'rgb(30, 31, 34)',
      });
      expect(lookOfPage.contentRight).toBeLessThanOrEqual(lookOfPage.titlebarRight ?? 0);

      // Auch bei hellem Windows-Design öffnet ein neues Fenster in der dunklen Farbe.
      await codium.app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = 'light';
      });
      const menuButton = page.getByRole('button', { name: 'Alpha', exact: true });
      await menuButton.click();
      await page.getByRole('menuitem', { name: 'Open Folder…' }).click();
      await expect.poll(() => codium.windowTitles(), { timeout: 15_000 }).toEqual([ALPHA, 'Beta – Codium']);
      const colors = await codium.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.getBackgroundColor().toLowerCase()),
      );
      expect(colors).toEqual([WINDOW_BACKGROUND, WINDOW_BACKGROUND]);
    });
  });

  it('öffnet, schliesst und wechselt Werkzeugfenster per Klick und mit den Alt-Kürzeln', async () => {
    const { dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      // Ohne gespeichertes Layout: links „Project“ offen.
      expect(await shownToolWindows(page)).toEqual(['Project']);
      expect(await stripeButton(page, 'Project').getAttribute('aria-pressed')).toBe('true');

      // Klick auf ein anderes Symbol derselben Seite wechselt, Klick auf das sichtbare schliesst.
      await stripeButton(page, 'Commit').click();
      await expect.poll(() => shownToolWindows(page)).toEqual(['Commit']);
      expect(await stripeButton(page, 'Project').getAttribute('aria-pressed')).toBe('false');
      await stripeButton(page, 'Commit').click();
      await expect.poll(() => shownToolWindows(page)).toEqual([]);

      // Alt + 1 zeigt „Project“ mit dem Fokus darin, ein zweites Alt + 1 schliesst es wieder.
      await page.keyboard.press('Alt+1');
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project']);
      expect(await focusedToolWindow(page)).toBe('Project');
      await page.keyboard.press('Alt+1');
      await expect.poll(() => shownToolWindows(page)).toEqual([]);

      // Alt + 0 und Alt + 1 wechseln auf der linken Seite.
      await page.keyboard.press('Alt+0');
      await expect.poll(() => shownToolWindows(page)).toEqual(['Commit']);
      await page.keyboard.press('Alt+1');
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project']);

      // Unten: Alt + F12 und Alt + 9 wechseln zwischen „Terminal“ und „Git“; die linke Seite bleibt.
      await page.keyboard.press('Alt+F12');
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project', 'Terminal']);
      await page.keyboard.press('Alt+9');
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project', 'Git']);

      // Rechts „Database“ per Klick; der Fokus geht hinein. Alt + 9 holt ihn dann zuerst nach „Git“ zurück, wie in
      // IntelliJ, erst ein weiteres Alt + 9 schliesst „Git“.
      await stripeButton(page, 'Database').click();
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project', 'Database', 'Git']);
      expect(await focusedToolWindow(page)).toBe('Database');
      await page.keyboard.press('Alt+9');
      await expect.poll(() => focusedToolWindow(page)).toBe('Git');
      expect(await shownToolWindows(page)).toEqual(['Project', 'Database', 'Git']);
      await page.keyboard.press('Alt+9');
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project', 'Database']);

      // „Find“ hat noch keine Trefferlisten: kein Symbol, und Alt + 3 bewirkt nichts.
      expect(await stripeButton(page, 'Find').count()).toBe(0);
      await page.keyboard.press('Alt+3');
      await sleep(200);
      expect(await shownToolWindows(page)).toEqual(['Project', 'Database']);

      // „Hide“ im Kopf eines Werkzeugfensters schliesst es.
      await page.getByRole('region', { name: 'Database' }).getByRole('button', { name: 'Hide' }).click();
      await expect.poll(() => shownToolWindows(page)).toEqual(['Project']);
    });
  });

  it('zieht Werkzeugfenster bis zur Höchstgrösse; nach einem Neustart sind Zustand und Grösse wieder da', async () => {
    const { dataRoot } = setup();
    let { codium, page } = await launchAlpha(dataRoot);
    let expected: { left: number; bottom: number } = { left: 0, bottom: 0 };
    await withApp(codium, async () => {
      const project = page.getByRole('region', { name: 'Project' });
      const projectSplitter = page.getByRole('separator', { name: 'Resize Project' });
      const editor = page.getByRole('main', { name: 'Editor' });

      const start = (await box(project)).width;
      await dragBy(page, projectSplitter, 120, 0);
      expect((await box(project)).width).toBe(start + 120);

      // Über die Höchstgrösse hinaus geht es nicht: Der Code-Bereich behält seine Mindestbreite.
      await dragBy(page, projectSplitter, 3000, 0);
      const max = (await box(project)).width;
      expect(Math.abs((await box(editor)).width - CODE_MIN_WIDTH)).toBeLessThanOrEqual(1);
      await dragBy(page, projectSplitter, 200, 0);
      expect((await box(project)).width).toBe(max);

      // Unten dasselbe in der Höhe.
      await page.keyboard.press('Alt+F12');
      const terminal = page.getByRole('region', { name: 'Terminal' });
      await terminal.waitFor();
      const terminalSplitter = page.getByRole('separator', { name: 'Resize Terminal' });
      await dragBy(page, terminalSplitter, 0, -3000);
      expect(Math.abs((await box(editor)).height - CODE_MIN_HEIGHT)).toBeLessThanOrEqual(1);
      const maxHeight = (await box(terminal)).height;
      await dragBy(page, terminalSplitter, 0, -100);
      expect((await box(terminal)).height).toBe(maxHeight);

      // Eine mittlere Grösse einstellen, links auf „Commit“ wechseln (gleiche Seite, gleiche Breite) und beenden.
      await dragBy(page, projectSplitter, 410 - max, 0);
      await dragBy(page, terminalSplitter, 0, maxHeight - 230);
      await stripeButton(page, 'Commit').click();
      const commit = page.getByRole('region', { name: 'Commit' });
      expected = { left: (await box(commit)).width, bottom: (await box(terminal)).height };
      expect(expected).toEqual({ left: 410, bottom: 230 });

      await page.getByRole('button', { name: 'Alpha', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Exit' }).click();
      await codium.exited();
    });

    ({ codium, page } = await launchAlpha(dataRoot));
    await withApp(codium, async () => {
      await expect.poll(() => shownToolWindows(page)).toEqual(['Commit', 'Terminal']);
      expect((await box(page.getByRole('region', { name: 'Commit' }))).width).toBe(expected.left);
      expect((await box(page.getByRole('region', { name: 'Terminal' }))).height).toBe(expected.bottom);
    });
  });

  it('eine Information verschwindet von selbst, eine Fehlermeldung bleibt, bis sie geschlossen wird', async () => {
    const { dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      await codium.emit(ALPHA, 'app.notice', { level: 'info', text: 'Indexing finished' });
      await codium.emit(ALPHA, 'app.notice', { level: 'error', text: 'Push rejected' });
      const info = page.getByRole('status').filter({ hasText: 'Indexing finished' });
      const error = page.getByRole('alert').filter({ hasText: 'Push rejected' });
      await expect.poll(() => info.count()).toBe(1);
      expect(await error.count()).toBe(1);

      // Nach drei Sekunden steht die Information noch, nach etwa fünf ist sie weg; der Fehler bleibt.
      await sleep(3000);
      expect(await info.count()).toBe(1);
      await expect.poll(() => info.count(), { timeout: 5000 }).toBe(0);
      await sleep(2000);
      expect(await error.count()).toBe(1);

      await error.getByRole('button', { name: 'Close' }).click();
      await expect.poll(() => error.count()).toBe(0);
    });
  });

  it('zeigt laufende Arbeiten des Kerns links in der Statusleiste, mehrere zusammengefasst', async () => {
    const { dataRoot } = setup();
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      const text = () => page.locator('.status-progress-text').allTextContents();
      const bar = page.getByRole('progressbar');

      await codium.emit(ALPHA, 'app.progress', { kind: 'begin', id: 'push', title: 'Pushing…', fraction: 0.5 });
      await expect.poll(text).toEqual(['Pushing…']);
      expect(await bar.getAttribute('aria-valuenow')).toBe('50');

      await codium.emit(ALPHA, 'app.progress', { kind: 'begin', id: 'import', title: 'Importing Java project…' });
      await expect.poll(text).toEqual(['2 processes running']);
      // Ein Stand ist unbekannt, also auch der gemeinsame.
      expect(await bar.getAttribute('aria-valuenow')).toBeNull();

      await codium.emit(ALPHA, 'app.progress', { kind: 'end', id: 'push' });
      await expect.poll(text).toEqual(['Importing Java project…']);
      await codium.emit(ALPHA, 'app.progress', { kind: 'end', id: 'import' });
      await expect.poll(() => bar.count()).toBe(0);
    });
  });

  it('eine Rückfrage liefert den gewählten Knopf zurück; Escape gilt als Abbrechen', async () => {
    const root = tempDir();
    const projects = ['Alpha', 'Beta'].map((name) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      return dir;
    });
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { recentProjects: projects });
    const codium = await launchCodium({ dataRoot });
    await withApp(codium, async () => {
      const page = await codium.page('Welcome to Codium');
      const betaEntry = page.getByRole('listitem').filter({ hasText: 'Beta' });
      await betaEntry.waitFor({ timeout: 15_000 });
      const dialog = page.getByRole('dialog', { name: 'Remove Recent Project' });
      const askToRemoveBeta = async () => {
        await betaEntry.hover();
        await betaEntry.getByRole('button', { name: 'Remove Beta from Recent Projects' }).click();
        await dialog.waitFor();
      };
      const recent = async () => {
        const response = (await page.evaluate(() =>
          (window as unknown as { codium: { invoke(name: string): Promise<unknown> } }).codium.invoke('app.recentProjects'),
        )) as ResponseMessage & { ok: true };
        return (response.result as RecentProject[]).map((p) => p.name);
      };

      // Titel, Text, betroffener Eintrag und Knöpfe; der vorgeschlagene Knopf hat den Fokus.
      await askToRemoveBeta();
      expect(await dialog.locator('.dialog-message').textContent()).toContain('Beta');
      expect(await dialog.getByRole('listitem').allTextContents()).toEqual([projects[1]]);
      expect(await dialog.getByRole('button').allTextContents()).toEqual(['Remove', 'Cancel']);
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Remove');

      // Escape bricht ab.
      await page.keyboard.press('Escape');
      await expect.poll(() => dialog.count()).toBe(0);
      expect(await recent()).toEqual(['Alpha', 'Beta']);

      // „Cancel“ ebenso.
      await askToRemoveBeta();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(() => dialog.count()).toBe(0);
      expect(await recent()).toEqual(['Alpha', 'Beta']);

      // „Remove“ entfernt den Eintrag.
      await askToRemoveBeta();
      await dialog.getByRole('button', { name: 'Remove' }).click();
      await expect.poll(() => dialog.count()).toBe(0);
      await expect.poll(recent).toEqual(['Alpha']);
      await expect.poll(() => betaEntry.count()).toBe(0);
    });
  });
});
