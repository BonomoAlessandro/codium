// Teststelle 1: Projektfenster, Willkommensfenster, Beenden und Wiederöffnen, am Vertrag und an den
// nachgemachten Ports.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult } from '../../src/shared/types';
import type { WindowPlacement } from '../../src/main/core/ports';
import { CommandError } from '../../src/main/core/router';
import { APP_STATE_FILE, PROJECT_STATE_DIR } from '../../src/main/core/schema';
import { projectStateFileName } from '../../src/main/core/projectPath';
import { createTestCore, restart, type TestCore } from '../support/core';
import { PRIMARY_DISPLAY } from '../support/fakePorts';
import { removeDir, useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Projektfenster und Willkommensfenster', () => {
  const tempDir = useTempDirs();

  /** Ein Temp-Ordner mit Datenordner und Projektordnern; der Kern ist erzeugt, aber noch nicht gestartet. */
  function setup() {
    const root = tempDir();
    const project = (name: string) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    return { root, project, test: createTestCore(path.join(root, 'data')) };
  }

  /** Ein Befehl aus einem Fenster, so wie ihn die Oberfläche schickt. */
  function call<K extends CommandName>(
    test: TestCore,
    windowId: number,
    name: K,
    ...args: CommandArgs<K>
  ): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** Startet den Kern ohne offene Projekte und liefert das Willkommensfenster. */
  async function startWithWelcome(test: TestCore): Promise<number> {
    await test.core.start();
    return test.ports.windows.windowTitled(WELCOME);
  }

  /** Öffnet Projekte nacheinander aus dem jeweils zuletzt geöffneten Fenster; liefert ihre Fenster. */
  async function openProjects(test: TestCore, from: number, ...projects: string[]): Promise<number[]> {
    const windows: number[] = [];
    let current = from;
    for (const project of projects) {
      await call(test, current, 'app.openProject', { path: project });
      current = test.ports.windows.windowTitled(title(path.basename(project)));
      windows.push(current);
    }
    return windows;
  }

  function readAppState(test: TestCore): { openProjects: string[]; recentProjects: string[] } {
    return JSON.parse(fs.readFileSync(path.join(test.dataDir, APP_STATE_FILE), 'utf8'));
  }

  describe('Öffnen', () => {
    it('zeigt ohne offene Projekte das Willkommensfenster', async () => {
      const { test } = setup();
      const welcome = await startWithWelcome(test);

      expect(test.ports.windows.opened).toEqual([{ windowId: welcome, kind: 'welcome', title: WELCOME }]);
      expect(await call(test, welcome, 'window.info')).toEqual({ kind: 'welcome', title: WELCOME });
      expect(await call(test, welcome, 'project.info')).toBeNull();
    });

    it('öffnet über „Open Folder“ ein Projektfenster mit eigenem Projekt-Kern und schliesst das Willkommensfenster', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const welcome = await startWithWelcome(test);
      test.ports.folderPicker.answers.push(alpha);

      expect(await call(test, welcome, 'app.openFolder')).toEqual({ path: alpha, name: 'Alpha' });

      expect(test.ports.folderPicker.calls).toEqual([{ windowId: welcome, title: 'Open Folder' }]);
      expect(test.ports.windows.openTitles).toEqual([title('Alpha')]);
      expect(test.ports.windows.closed).toEqual([welcome]);
      const projectWindow = test.ports.windows.windowTitled(title('Alpha'));
      expect(test.ports.windows.opened.find((w) => w.windowId === projectWindow)?.kind).toBe('project');
      expect(test.core.projectCoreForWindow(projectWindow)?.path).toBe(alpha);
      expect(await call(test, projectWindow, 'window.info')).toEqual({
        kind: 'project',
        title: title('Alpha'),
        project: { path: alpha, name: 'Alpha' },
      });
      // Das Willkommensfenster ging zu, weil ein Projekt aufging, nicht weil Codium endet.
      expect(test.ports.windows.quitRequests).toBe(0);
    });

    it('lässt bei abgebrochener Ordnerauswahl alles, wie es ist', async () => {
      const { test } = setup();
      const welcome = await startWithWelcome(test);

      expect(await call(test, welcome, 'app.openFolder')).toBeNull();
      expect(test.ports.windows.openTitles).toEqual([WELCOME]);
    });

    it('öffnet ein anderes Projekt in einem neuen Fenster, das erste bleibt offen', async () => {
      const { project, test } = setup();
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, project('Alpha'), project('Beta'));

      expect(test.ports.windows.openTitles).toEqual([title('Alpha'), title('Beta')]);
      expect(test.core.projectCoreForWindow(alphaWindow)?.name).toBe('Alpha');
      expect(test.core.projectCoreForWindow(betaWindow)?.name).toBe('Beta');
    });

    it('holt ein schon offenes Projekt nach vorne, auch in anderer Schreibweise des Pfads', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, alpha, project('Beta'));
      const openedBefore = test.ports.windows.opened.length;

      const variant = `${alpha.toUpperCase().replace(/\\/g, '/')}/`;
      expect(await call(test, betaWindow, 'app.openProject', { path: variant })).toEqual({ path: alpha, name: 'Alpha' });
      test.ports.folderPicker.answers.push(`${alpha}\\`);
      await call(test, betaWindow, 'app.openFolder');

      expect(test.ports.windows.opened).toHaveLength(openedBefore);
      expect(test.ports.windows.focused).toEqual([alphaWindow, alphaWindow]);
    });

    it('öffnet dasselbe Projekt bei gleichzeitigen Anfragen nur einmal, auch während sein Abbau noch läuft', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, alpha, project('Beta'));
      test.core.projectCoreForWindow(alphaWindow)?.onDispose(() => delay(30));
      test.ports.windows.close(alphaWindow);

      const [first, second] = await Promise.all([
        call(test, betaWindow, 'app.openProject', { path: alpha }),
        call(test, betaWindow, 'app.openProject', { path: alpha.toLowerCase() }),
      ]);

      expect(first).toEqual(second);
      expect(test.ports.windows.openTitles).toEqual([title('Beta'), title('Alpha')]);
      expect(test.ports.windows.focused).toEqual([test.ports.windows.windowTitled(title('Alpha'))]);
    });

    it('meldet einen fehlenden Ordner mit PROJECT_NOT_FOUND und öffnet kein Fenster', async () => {
      const { root, test } = setup();
      const welcome = await startWithWelcome(test);
      const gone = path.join(root, 'gibt-es-nicht');

      const failure = await call(test, welcome, 'app.openProject', { path: gone }).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(CommandError);
      expect(failure).toMatchObject({ code: 'PROJECT_NOT_FOUND', data: { path: gone }, message: `Folder not found: ${gone}` });
      expect(test.ports.windows.openTitles).toEqual([WELCOME]);

      await expect(call(test, welcome, 'app.openProject', {} as { path: string })).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
      });
    });
  });

  describe('Zweiter Start', () => {
    it('holt das zuletzt benutzte Fenster nach vorne', async () => {
      const { project, test } = setup();
      const welcome = await startWithWelcome(test);
      test.core.secondInstanceStarted();
      expect(test.ports.windows.focused).toEqual([welcome]);

      const [alphaWindow, betaWindow] = await openProjects(test, welcome, project('Alpha'), project('Beta'));
      test.core.secondInstanceStarted();
      expect(test.ports.windows.focused.at(-1)).toBe(betaWindow);

      test.ports.windows.simulateFocus(alphaWindow);
      test.core.secondInstanceStarted();
      expect(test.ports.windows.focused.at(-1)).toBe(alphaWindow);
    });
  });

  describe('Beenden und Wiederöffnen', () => {
    it('„Exit“ beendet Codium mit beiden offenen Projekten; nach dem Neustart sind beide wieder offen', async () => {
      const { project, test } = setup();
      const welcome = await startWithWelcome(test);
      const [, betaWindow] = await openProjects(test, welcome, project('Alpha'), project('Beta'));

      await call(test, betaWindow, 'app.exit');
      expect(test.ports.windows.quitRequests).toBe(1);
      await expect(call(test, betaWindow, 'app.openProject', { path: project('Gamma') })).rejects.toMatchObject({
        code: 'SHUTTING_DOWN',
      });

      const after = await restart(test);
      await after.core.start();
      expect(after.ports.windows.openTitles).toEqual([title('Alpha'), title('Beta')]);
      expect(after.core.projectCores.map((core) => core.name)).toEqual(['Alpha', 'Beta']);
    });

    it('das Abmelden von Windows wirkt wie „Exit“ und schreibt den Zustand sofort', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const beta = project('Beta');
      const welcome = await startWithWelcome(test);
      await openProjects(test, welcome, alpha, beta);

      test.ports.windows.simulateSessionEnd();
      // Windows wartet nicht: Der Zustand liegt schon auf der Festplatte, bevor irgendetwas abgewartet wurde.
      expect(readAppState(test).openProjects).toEqual([alpha, beta]);
      expect(test.ports.windows.quitRequests).toBe(1);

      const after = await restart(test);
      await after.core.start();
      expect(after.ports.windows.openTitles).toEqual([title('Alpha'), title('Beta')]);
    });

    it('das letzte Projektfenster schliessen beendet Codium; nur dieses Projekt ist nach dem Neustart offen', async () => {
      const { project, test } = setup();
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, project('Alpha'), project('Beta'));

      test.ports.windows.close(alphaWindow);
      expect(test.ports.windows.quitRequests).toBe(0);
      test.ports.windows.close(betaWindow);
      expect(test.ports.windows.quitRequests).toBe(1);

      const after = await restart(test);
      await after.core.start();
      expect(after.ports.windows.openTitles).toEqual([title('Beta')]);
    });

    it('das Willkommensfenster als einziges Fenster schliessen beendet Codium', async () => {
      const { test } = setup();
      const welcome = await startWithWelcome(test);

      test.ports.windows.close(welcome);
      expect(test.ports.windows.quitRequests).toBe(1);

      const after = await restart(test);
      await after.core.start();
      expect(after.ports.windows.openTitles).toEqual([WELCOME]);
    });

    it('überspringt beim Start einen fehlenden Projektordner und meldet ihn', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const beta = project('Beta');
      const welcome = await startWithWelcome(test);
      const [, betaWindow] = await openProjects(test, welcome, alpha, beta);
      await call(test, betaWindow, 'app.exit');
      const after = await restart(test);
      removeDir(beta);

      await after.core.start();
      expect(after.ports.windows.openTitles).toEqual([title('Alpha')]);
      expect(after.events.forWindow(after.ports.windows.windowTitled(title('Alpha')))).toEqual([
        { name: 'app.notice', payload: { level: 'error', text: `Project folder not found: ${beta}` } },
      ]);
      // Übersprungen heisst: beim nächsten Start nicht mehr offen, aber weiter unter den zuletzt geöffneten.
      expect(after.core.state.openProjects).toEqual([alpha]);
      expect(after.core.state.recentProjects).toEqual([beta, alpha]);
    });

    it('zeigt das Willkommensfenster mit dem Hinweis, wenn kein Projekt übrig bleibt', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const welcome = await startWithWelcome(test);
      const [alphaWindow] = await openProjects(test, welcome, alpha);
      await call(test, alphaWindow, 'app.exit');
      const after = await restart(test);
      removeDir(alpha);

      await after.core.start();
      expect(after.ports.windows.openTitles).toEqual([WELCOME]);
      expect(after.events.forWindow(after.ports.windows.windowTitled(WELCOME))).toEqual([
        { name: 'app.notice', payload: { level: 'error', text: `Project folder not found: ${alpha}` } },
      ]);
    });
  });

  describe('Zuletzt geöffnete Projekte', () => {
    it('sind höchstens 20, neueste zuerst und ohne Doppelungen', async () => {
      const { project, test } = setup();
      const welcome = await startWithWelcome(test);
      const projects = Array.from({ length: 22 }, (_, i) => project(`p${String(i + 1).padStart(2, '0')}`));
      const windows = await openProjects(test, welcome, ...projects);
      const names = async () => (await call(test, windows[0], 'app.recentProjects')).map((p) => p.name);

      expect(await names()).toEqual(projects.slice(2).reverse().map((p) => path.basename(p)));

      // Ein offenes Projekt erneut öffnen (in anderer Schreibweise) und ein geschlossenes wieder öffnen: Beide
      // rücken nach vorne, keines steht doppelt.
      await call(test, windows[0], 'app.openProject', { path: projects[9].toUpperCase() });
      test.ports.windows.close(windows[14]);
      await call(test, windows[0], 'app.openProject', { path: projects[14] });
      const recent = await names();
      expect(recent.slice(0, 3)).toEqual(['p15', 'p10', 'p22']);
      expect(recent).toHaveLength(20);
      expect(new Set(recent).size).toBe(20);

      const after = await restart(test);
      expect(after.core.state.recentProjects.map((p) => path.basename(p))).toEqual(recent);
    });

    it('melden einen fehlenden Ordner beim Öffnen; der Eintrag lässt sich entfernen', async () => {
      const { project, test } = setup();
      const alpha = project('Alpha');
      const beta = project('Beta');
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, alpha, beta);
      test.ports.windows.close(betaWindow);
      removeDir(beta);

      expect(await call(test, alphaWindow, 'app.recentProjects')).toEqual([
        { path: beta, name: 'Beta', exists: false },
        { path: alpha, name: 'Alpha', exists: true },
      ]);
      await expect(call(test, alphaWindow, 'app.openProject', { path: beta })).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
        data: { path: beta },
      });
      expect(test.ports.windows.openTitles).toEqual([title('Alpha')]);

      expect(await call(test, alphaWindow, 'app.removeRecentProject', { path: beta })).toEqual([
        { path: alpha, name: 'Alpha', exists: true },
      ]);
      const after = await restart(test);
      expect(after.core.state.recentProjects).toEqual([alpha]);
    });
  });

  describe('Fensterlage', () => {
    const MOVED: WindowPlacement = { bounds: { x: 300, y: 120, width: 1000, height: 700 }, maximized: true };

    it('übersteht für Projektfenster einen Neustart, auch beim Schliessen eines einzelnen Fensters', async () => {
      const { project, test } = setup();
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, project('Alpha'), project('Beta'));
      test.ports.windows.simulatePlacement(alphaWindow, MOVED);
      test.ports.windows.simulatePlacement(betaWindow, { bounds: { x: 50, y: 60, width: 900, height: 600 }, maximized: false });
      await call(test, betaWindow, 'app.exit');

      const after = await restart(test);
      await after.core.start();
      expect(after.ports.windows.opened.map((w) => w.placement)).toEqual([
        MOVED,
        { bounds: { x: 50, y: 60, width: 900, height: 600 }, maximized: false },
      ]);

      // Ein einzeln geschlossenes Fenster merkt sich seine Lage ebenfalls.
      const betaAgain = after.ports.windows.windowTitled(title('Beta'));
      after.ports.windows.simulatePlacement(betaAgain, { bounds: { x: 70, y: 80, width: 800, height: 500 }, maximized: false });
      after.ports.windows.close(betaAgain);
      await call(after, after.ports.windows.windowTitled(title('Alpha')), 'app.openProject', { path: project('Beta') });
      expect(after.ports.windows.opened.at(-1)?.placement).toEqual({
        bounds: { x: 70, y: 80, width: 800, height: 500 },
        maximized: false,
      });
    });

    it('übersteht für das Willkommensfenster einen Neustart', async () => {
      const { test } = setup();
      const welcome = await startWithWelcome(test);
      test.ports.windows.simulatePlacement(welcome, MOVED);
      test.ports.windows.close(welcome);

      const after = await restart(test);
      await after.core.start();
      expect(after.ports.windows.opened).toEqual([
        { windowId: expect.any(Number), kind: 'welcome', title: WELCOME, placement: MOVED },
      ]);
    });

    it('verschiebt eine Lage auf einem fehlenden Bildschirm auf den Hauptbildschirm', async () => {
      const { project, test } = setup();
      const second = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, primary: false };
      test.ports.windows.displayList = [PRIMARY_DISPLAY, second];
      const welcome = await startWithWelcome(test);
      const [alphaWindow, betaWindow] = await openProjects(test, welcome, project('Alpha'), project('Beta'));
      // Alpha auf dem zweiten Bildschirm, Beta grösser als der Hauptbildschirm und ebenfalls dort.
      test.ports.windows.simulatePlacement(alphaWindow, { bounds: { x: 2200, y: 100, width: 1000, height: 700 }, maximized: true });
      test.ports.windows.simulatePlacement(betaWindow, { bounds: { x: 2000, y: 50, width: 2400, height: 1300 }, maximized: false });
      await call(test, betaWindow, 'app.exit');

      // Mit beiden Bildschirmen bleibt alles, wo es war.
      let after = await restart(test);
      after.ports.windows.displayList = [PRIMARY_DISPLAY, second];
      await after.core.start();
      expect(after.ports.windows.opened.map((w) => w.placement?.bounds.x)).toEqual([2200, 2000]);

      // Ohne den zweiten Bildschirm kommen beide zentriert auf den Hauptbildschirm (Arbeitsbereich 1920 × 1040).
      after = await restart(after);
      await after.core.start();
      expect(after.ports.windows.opened.map((w) => w.placement)).toEqual([
        { bounds: { x: 460, y: 170, width: 1000, height: 700 }, maximized: true },
        { bounds: { x: 0, y: 0, width: 1920, height: 1040 }, maximized: false },
      ]);
    });
  });

  it('legt den Projekt-Zustand unter dem Namen aus dem Projektpfad ab', async () => {
    const { project, test } = setup();
    const alpha = project('Alpha');
    const welcome = await startWithWelcome(test);
    await openProjects(test, welcome, alpha);
    const after = await restart(test);

    expect(fs.readdirSync(path.join(after.dataDir, PROJECT_STATE_DIR))).toEqual([projectStateFileName(alpha)]);
  });
});
