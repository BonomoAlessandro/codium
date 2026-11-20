import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectStateFileName } from '../../src/main/core/projectPath';
import { PROJECT_STATE_DIR } from '../../src/main/core/schema';
import { createTestCore, restart } from '../support/core';
import { useTempDirs } from '../support/tempDir';

describe('App-Kern', () => {
  const tempDir = useTempDirs();

  /** Ein Projektordner und ein Datenordner in einem gemeinsamen Temp-Ordner. */
  function setup() {
    const root = tempDir();
    const project = path.join(root, 'Mein Projekt');
    fs.mkdirSync(project);
    return { root, project, test: createTestCore(path.join(root, 'data')) };
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
      test.core.openProjectCore(project, 1).updateState((state) => {
        state.windowBounds = { x: 10, y: 20, width: 900, height: 700 };
      });

      const after = await restart(test);
      const reopened = after.core.openProjectCore(project, 7);
      expect(reopened.state.windowBounds).toEqual({ x: 10, y: 20, width: 900, height: 700 });
    });

    it('legt eine kaputte Zustandsdatei beiseite und startet leer', async () => {
      const { project, test } = setup();
      test.core.updateState((state) => state.recentProjects.push(project));
      await test.core.shutdown();
      const stateFile = path.join(test.dataDir, 'state.json');
      fs.writeFileSync(stateFile, '{ kaputt', 'utf8');

      const after = createTestCore(test.dataDir);
      expect(after.core.state.recentProjects).toEqual([]);
      expect(fs.readdirSync(test.dataDir).some((name) => name.startsWith('state.json.corrupt-'))).toBe(true);
      expect(after.logs.join('\n')).toContain('gesichert als');
    });
  });

  describe('Projektpfade in unterschiedlicher Schreibweise', () => {
    it('führen zum selben Projekt-Zustand', async () => {
      const { project, test } = setup();
      test.core.openProjectCore(project, 1).updateState((state) => {
        state.windowBounds = { x: 1, y: 2, width: 800, height: 600 };
      });

      const after = await restart(test);
      const variant = `${project.toUpperCase().replace(/\\/g, '/')}/`;
      expect(after.core.openProjectCore(variant, 1).state.windowBounds).toEqual({ x: 1, y: 2, width: 800, height: 600 });
      expect(fs.readdirSync(path.join(test.dataDir, PROJECT_STATE_DIR))).toEqual([projectStateFileName(project)]);
    });

    it('lassen dasselbe Projekt kein zweites Mal öffnen', () => {
      const { project, test } = setup();
      test.core.openProjectCore(project, 1);
      expect(test.core.findProjectCore(`${project.toLowerCase()}\\`)?.windowId).toBe(1);
      expect(() => test.core.openProjectCore(project.toUpperCase(), 2)).toThrow(/schon offen/);
    });
  });

  describe('Abbau eines Projekt-Kerns', () => {
    it('wartet auf asynchrone Aufräumarbeiten, in umgekehrter Reihenfolge', async () => {
      const { project, test } = setup();
      const projectCore = test.core.openProjectCore(project, 1);
      const order: string[] = [];
      projectCore.onDispose(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('zuerst angemeldet');
      });
      projectCore.onDispose(() => {
        order.push('zuletzt angemeldet');
      });

      await test.core.closeProjectCore(1);
      expect(order).toEqual(['zuletzt angemeldet', 'zuerst angemeldet']);
      expect(test.core.projectCoreForWindow(1)).toBeUndefined();
    });

    it('lässt sich von einer fehlschlagenden Aufräumarbeit nicht aufhalten und schreibt den Zustand', async () => {
      const { project, test } = setup();
      const projectCore = test.core.openProjectCore(project, 1);
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

      await test.core.closeProjectCore(1);
      expect(otherRan).toBe(true);
      expect(test.logs.join('\n')).toContain('kaputt');
      const file = path.join(test.dataDir, PROJECT_STATE_DIR, projectStateFileName(project));
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).windowBounds.width).toBe(1000);
    });

    it('baut beim Beenden alle Projekt-Kerne ab', async () => {
      const { root, project, test } = setup();
      const second = path.join(root, 'zweites');
      fs.mkdirSync(second);
      const disposed: string[] = [];
      test.core.openProjectCore(project, 1).onDispose(() => void disposed.push('eins'));
      test.core.openProjectCore(second, 2).onDispose(() => void disposed.push('zwei'));

      await test.core.shutdown();
      expect(disposed.sort()).toEqual(['eins', 'zwei']);
      expect(test.core.projectCores).toEqual([]);
      expect(() => test.core.openProjectCore(project, 3)).toThrow(/beendet/);
    });
  });

  describe('Vertrag', () => {
    it('beantwortet Befehle pro Fenster', async () => {
      const { project, test } = setup();
      test.core.openProjectCore(project, 1);

      expect(await test.core.router.call({ windowId: 1 }, 'project.info')).toEqual({ path: project, name: 'Mein Projekt' });
      expect(await test.core.router.call({ windowId: 2 }, 'project.info')).toBeNull();
      expect(await test.core.router.call({ windowId: 2 }, 'app.info')).toEqual({ name: 'Codium', version: '0.0.0-test' });
    });

    it('liefert Fehler als Antwort statt als Ausnahme', async () => {
      const { test } = setup();
      expect(await test.core.router.dispatch({ windowId: 1 }, 'gibt.es.nicht', undefined)).toEqual({
        ok: false,
        error: { message: 'Unbekannter Befehl: gibt.es.nicht' },
      });
    });

    it('schickt Ereignisse nur an das Fenster des Projekts, nach dem Abbau gar nicht mehr', async () => {
      const { root, project, test } = setup();
      const other = path.join(root, 'anderes');
      fs.mkdirSync(other);
      const first = test.core.openProjectCore(project, 1);
      test.core.openProjectCore(other, 2);

      first.emit('app.notice', { level: 'info', text: 'Hallo' });
      expect(test.events.forWindow(1)).toEqual([{ name: 'app.notice', payload: { level: 'info', text: 'Hallo' } }]);
      expect(test.events.forWindow(2)).toEqual([]);

      await test.core.closeProjectCore(1);
      first.emit('app.notice', { level: 'info', text: 'zu spät' });
      expect(test.events.forWindow(1)).toHaveLength(1);
    });
  });
});
