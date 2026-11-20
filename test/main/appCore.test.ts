import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandName } from '../../src/shared/types';
import type { ProjectCore } from '../../src/main/core/projectCore';
import { projectStateFileName } from '../../src/main/core/projectPath';
import { CommandError } from '../../src/main/core/router';
import { PROJECT_STATE_DIR } from '../../src/main/core/schema';
import { createTestCore, restart, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('App-Kern', () => {
  const tempDir = useTempDirs();

  /** Ein Projektordner und ein Datenordner in einem gemeinsamen Temp-Ordner. */
  function setup() {
    const root = tempDir();
    const project = path.join(root, 'Mein Projekt');
    fs.mkdirSync(project);
    return { root, project, test: createTestCore(path.join(root, 'data')) };
  }

  /** Öffnet ein Fenster über den nachgemachten Port (es meldet sich sofort bereit) und liefert seine Kennung. */
  function openWindow(test: TestCore): number {
    return test.ports.windows.open({ kind: 'project', title: 'Projekt – Codium' });
  }

  function projectStateFile(test: TestCore, project: string): string {
    return path.join(test.dataDir, PROJECT_STATE_DIR, projectStateFileName(project));
  }

  describe('Zustand über einen Neustart', () => {
    it('behält den App-Zustand', async () => {
      const { project, test } = setup();
      test.core.updateState((state) => {
        state.recentProjects.unshift(project);
        state.settings.terminalShell = 'cmd';
      });

      const after = await restart(test);
      expect(after.core.state.recentProjects).toEqual([project]);
      expect(after.core.state.settings.terminalShell).toBe('cmd');
    });

    it('behält den Projekt-Zustand', async () => {
      const { project, test } = setup();
      (await test.core.openProjectCore(project, openWindow(test))).updateState((state) => {
        state.windowBounds = { x: 10, y: 20, width: 900, height: 700 };
      });

      const after = await restart(test);
      const reopened = await after.core.openProjectCore(project, openWindow(after));
      expect(reopened.state.windowBounds).toEqual({ x: 10, y: 20, width: 900, height: 700 });
    });

    it('legt eine kaputte Zustandsdatei beiseite und startet leer', async () => {
      const { project, test } = setup();
      test.core.updateState((state) => state.recentProjects.push(project));
      await test.core.shutdown();
      fs.writeFileSync(path.join(test.dataDir, 'state.json'), '{ kaputt', 'utf8');

      const after = createTestCore(test.dataDir);
      expect(after.core.state.recentProjects).toEqual([]);
      expect(fs.readdirSync(test.dataDir).some((name) => name.startsWith('state.json.corrupt-'))).toBe(true);
      expect(after.logs.join('\n')).toContain('gesichert als');
    });

    it('ersetzt ungültige Felder durch Standardwerte', async () => {
      const { test } = setup();
      await test.core.shutdown();
      fs.mkdirSync(test.dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(test.dataDir, 'state.json'),
        JSON.stringify({ schemaVersion: 1, recentProjects: 'kein Array', openProjects: ['C:\\a', 3], settings: null }),
        'utf8',
      );
      const after = createTestCore(test.dataDir);
      expect(after.core.state).toEqual({ schemaVersion: 1, recentProjects: [], openProjects: ['C:\\a'], settings: {} });
    });
  });

  describe('Projektpfade in unterschiedlicher Schreibweise', () => {
    it('führen zum selben Projekt-Zustand', async () => {
      const { project, test } = setup();
      (await test.core.openProjectCore(project, openWindow(test))).updateState((state) => {
        state.windowBounds = { x: 1, y: 2, width: 800, height: 600 };
      });

      const after = await restart(test);
      const variant = `${project.toUpperCase().replace(/\\/g, '/')}/`;
      expect((await after.core.openProjectCore(variant, openWindow(after))).state.windowBounds).toEqual({
        x: 1,
        y: 2,
        width: 800,
        height: 600,
      });
      expect(fs.readdirSync(path.join(test.dataDir, PROJECT_STATE_DIR))).toEqual([projectStateFileName(project)]);
    });

    it('lassen dasselbe Projekt kein zweites Mal öffnen', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      await test.core.openProjectCore(project, windowId);
      expect(test.core.findProjectCore(`${project.toLowerCase()}\\`)?.windowId).toBe(windowId);
      await expect(test.core.openProjectCore(project.toUpperCase(), openWindow(test))).rejects.toThrow(/schon offen/);
    });
  });

  describe('Abbau eines Projekt-Kerns', () => {
    it('wartet auf asynchrone Aufräumarbeiten, in umgekehrter Reihenfolge', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      const projectCore = await test.core.openProjectCore(project, windowId);
      const order: string[] = [];
      projectCore.onDispose(async () => {
        await delay(20);
        order.push('zuerst angemeldet');
      });
      projectCore.onDispose(() => {
        order.push('zuletzt angemeldet');
      });

      await test.core.closeProjectCore(windowId);
      expect(order).toEqual(['zuletzt angemeldet', 'zuerst angemeldet']);
      expect(test.core.projectCoreForWindow(windowId)).toBeUndefined();
    });

    it('beginnt, wenn der Nutzer das Fenster schliesst', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      let cleaned = false;
      (await test.core.openProjectCore(project, windowId)).onDispose(() => {
        cleaned = true;
      });

      test.ports.windows.close(windowId);
      await test.core.shutdown();
      expect(cleaned).toBe(true);
      expect(test.core.projectCoreForWindow(windowId)).toBeUndefined();
    });

    it('lässt sich von einer fehlschlagenden Aufräumarbeit nicht aufhalten und schreibt den Zustand', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      const projectCore = await test.core.openProjectCore(project, windowId);
      let otherRan = false;
      projectCore.onDispose(() => {
        otherRan = true;
      });
      projectCore.onDispose(() => {
        throw new Error('kaputt');
      });
      projectCore.updateState((state) => {
        state.windowBounds = { x: 0, y: 0, width: 1000, height: 700 };
      });

      await test.core.closeProjectCore(windowId);
      expect(otherRan).toBe(true);
      expect(test.logs.join('\n')).toContain('kaputt');
      expect(JSON.parse(fs.readFileSync(projectStateFile(test, project), 'utf8')).windowBounds.width).toBe(1000);
    });

    it('bricht eine hängende Aufräumarbeit nach dem Zeitlimit ab', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      const projectCore = await test.core.openProjectCore(project, windowId);
      let afterHang = false;
      projectCore.onDispose(() => {
        afterHang = true;
      });
      projectCore.onDispose(() => new Promise<void>(() => {}));

      await test.core.closeProjectCore(windowId);
      expect(afterHang).toBe(true);
      expect(test.logs.join('\n')).toMatch(/nach 200 ms abgebrochen/);
    });

    it('räumt eine erst während des Abbaus angemeldete Arbeit trotzdem auf', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      const projectCore = await test.core.openProjectCore(project, windowId);
      let late = false;
      projectCore.onDispose(async () => {
        // Etwa ein Dienst, dessen asynchroner Start erst jetzt fertig wird.
        projectCore.onDispose(async () => {
          await delay(10);
          late = true;
        });
      });

      await test.core.closeProjectCore(windowId);
      expect(late).toBe(true);

      let afterwards = false;
      projectCore.onDispose(() => {
        afterwards = true;
      });
      await delay(0);
      expect(afterwards).toBe(true);
    });

    it('baut beim Beenden alle Projekt-Kerne ab', async () => {
      const { root, project, test } = setup();
      const second = path.join(root, 'zweites');
      fs.mkdirSync(second);
      const disposed: string[] = [];
      (await test.core.openProjectCore(project, openWindow(test))).onDispose(() => void disposed.push('eins'));
      (await test.core.openProjectCore(second, openWindow(test))).onDispose(() => void disposed.push('zwei'));

      await test.core.shutdown();
      expect(disposed.sort()).toEqual(['eins', 'zwei']);
      expect(test.core.projectCores).toEqual([]);
      await expect(test.core.openProjectCore(project, openWindow(test))).rejects.toThrow(/beendet/);
    });

    it('wartet beim Beenden auch auf einen Abbau, der schon läuft', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      const projectCore = await test.core.openProjectCore(project, windowId);
      let cleaned = false;
      projectCore.onDispose(async () => {
        await delay(50);
        cleaned = true;
      });
      projectCore.updateState((state) => {
        state.windowBounds = { x: 5, y: 5, width: 640, height: 480 };
      });

      // Letztes Fenster zu: Der Abbau läuft, gleich darauf beendet sich die App.
      test.ports.windows.close(windowId);
      await test.core.shutdown();
      expect(cleaned).toBe(true);
      expect(JSON.parse(fs.readFileSync(projectStateFile(test, project), 'utf8')).windowBounds.width).toBe(640);
    });

    it('lässt ein gleich wieder geöffnetes Projekt auf den Abbau warten und den letzten Stand lesen', async () => {
      const { project, test } = setup();
      const windowId = openWindow(test);
      const first = await test.core.openProjectCore(project, windowId);
      let firstGone = false;
      first.onDispose(async () => {
        await delay(50);
        firstGone = true;
      });
      first.updateState((state) => {
        state.windowBounds = { x: 7, y: 7, width: 777, height: 555 };
      });

      void test.core.closeProjectCore(windowId);
      const reopened = await test.core.openProjectCore(project, openWindow(test));
      expect(firstGone).toBe(true);
      expect(reopened.state.windowBounds?.width).toBe(777);
      expect(test.core.projectCores).toEqual([reopened]);
    });
  });

  describe('Vertrag', () => {
    it('beantwortet Befehle pro Fenster', async () => {
      const { project, test } = setup();
      const withProject = openWindow(test);
      const without = openWindow(test);
      await test.core.openProjectCore(project, withProject);

      expect(await test.core.router.call({ windowId: withProject }, 'project.info')).toEqual({
        path: project,
        name: 'Mein Projekt',
      });
      expect(await test.core.router.call({ windowId: without }, 'project.info')).toBeNull();
      expect(await test.core.router.call({ windowId: without }, 'app.info')).toEqual({
        name: 'Codium',
        version: '0.0.0-test',
      });
    });

    it('liefert Fehler als Antwort statt als Ausnahme, mit Code und Daten', async () => {
      const { test } = setup();
      expect(await test.core.router.dispatch({ windowId: 1 }, 'gibt.es.nicht', undefined)).toEqual({
        ok: false,
        error: { message: 'Unbekannter Befehl: gibt.es.nicht', code: 'UNKNOWN_COMMAND' },
      });
    });

    it('lehnt projektgebundene Befehle ohne Projekt mit dem Code NO_PROJECT ab', async () => {
      const { project, test } = setup();
      // Der Vertrag hat noch keinen projektgebundenen Befehl; der Test meldet einen eigenen an.
      const name = 'test.projectName' as CommandName;
      test.core.registerProjectCommand(name, ((projectCore: ProjectCore) => projectCore.name) as never);
      const withProject = openWindow(test);
      const without = openWindow(test);
      await test.core.openProjectCore(project, withProject);

      expect(await test.core.router.dispatch({ windowId: withProject }, name, undefined)).toEqual({
        ok: true,
        result: 'Mein Projekt',
      });
      expect(await test.core.router.dispatch({ windowId: without }, name, undefined)).toEqual({
        ok: false,
        error: { message: 'Dieses Fenster hat kein offenes Projekt.', code: 'NO_PROJECT' },
      });
      await expect(test.core.router.call({ windowId: without }, name as never)).rejects.toBeInstanceOf(CommandError);
    });

    it('schickt Ereignisse nur an das Fenster des Projekts, nach dem Abbau gar nicht mehr', async () => {
      const { root, project, test } = setup();
      const other = path.join(root, 'anderes');
      fs.mkdirSync(other);
      const firstWindow = openWindow(test);
      const secondWindow = openWindow(test);
      const first = await test.core.openProjectCore(project, firstWindow);
      await test.core.openProjectCore(other, secondWindow);

      first.emit('app.notice', { level: 'info', text: 'Hallo' });
      expect(test.events.forWindow(firstWindow)).toEqual([{ name: 'app.notice', payload: { level: 'info', text: 'Hallo' } }]);
      expect(test.events.forWindow(secondWindow)).toEqual([]);

      await test.core.closeProjectCore(firstWindow);
      first.emit('app.notice', { level: 'info', text: 'zu spät' });
      expect(test.events.forWindow(firstWindow)).toHaveLength(1);
    });

    it('hält Ereignisse zurück, bis das Fenster bereit ist, und vergisst sie für ein geschlossenes Fenster', () => {
      const { test } = setup();
      test.ports.windows.autoReady = false;
      const windowId = openWindow(test);
      const closedBeforeReady = openWindow(test);

      test.core.emitToWindow(windowId, 'app.notice', { level: 'error', text: 'Projektordner fehlt' });
      test.core.emitToWindow(closedBeforeReady, 'app.notice', { level: 'info', text: 'verloren' });
      expect(test.events.sent).toEqual([]);

      test.ports.windows.simulateReady(windowId);
      expect(test.events.forWindow(windowId)).toEqual([
        { name: 'app.notice', payload: { level: 'error', text: 'Projektordner fehlt' } },
      ]);

      test.ports.windows.close(closedBeforeReady);
      test.ports.windows.simulateReady(closedBeforeReady);
      expect(test.events.forWindow(closedBeforeReady)).toEqual([]);
    });
  });
});
