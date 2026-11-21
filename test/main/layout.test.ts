// Teststelle 1: Layout der Werkzeugfenster im Projekt-Zustand, am Vertrag und an den nachgemachten Ports.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult, ToolWindowLayout } from '../../src/shared/types';
import { lexicalProjectKey, projectStateFileName } from '../../src/main/core/projectPath';
import { PROJECT_STATE_DIR, defaultLayout } from '../../src/main/core/schema';
import { createTestCore, restart, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;

/** Ein Layout, das sich in jeder Seite vom Standard unterscheidet. */
const CUSTOM: ToolWindowLayout = {
  left: { active: 'commit', open: true, size: 412 },
  bottom: { active: 'git', open: true, size: 333 },
  right: { active: 'database', open: true, size: 290 },
};

describe('Layout der Werkzeugfenster', () => {
  const tempDir = useTempDirs();

  function setup() {
    const root = tempDir();
    const project = (name: string) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    return { project, test: createTestCore(path.join(root, 'data')) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** Startet den Kern und öffnet die Projekte aus dem Willkommensfenster; liefert ihre Fenster. */
  async function startWith(test: TestCore, ...projects: string[]): Promise<number[]> {
    await test.core.start();
    let from = test.ports.windows.windowTitled(WELCOME);
    const windows: number[] = [];
    for (const project of projects) {
      await call(test, from, 'app.openProject', { path: project });
      from = test.ports.windows.windowTitled(title(path.basename(project)));
      windows.push(from);
    }
    return windows;
  }

  it('ist ohne gespeichertes Layout der Standard: links „Project“ offen, unten und rechts zu', async () => {
    const { project, test } = setup();
    const [alphaWindow] = await startWith(test, project('Alpha'));

    expect(await call(test, alphaWindow, 'project.layout')).toEqual({
      left: { active: 'project', open: true, size: 280 },
      bottom: { active: 'terminal', open: false, size: 260 },
      right: { active: 'database', open: false, size: 320 },
    });
  });

  it('übersteht einen Neustart', async () => {
    const { project, test } = setup();
    const [alphaWindow] = await startWith(test, project('Alpha'));
    await call(test, alphaWindow, 'project.setLayout', CUSTOM);
    await call(test, alphaWindow, 'app.exit');

    const after = await restart(test);
    await after.core.start();
    const reopened = after.ports.windows.windowTitled(title('Alpha'));
    expect(await call(after, reopened, 'project.layout')).toEqual(CUSTOM);
  });

  it('übersteht auch das Schliessen des Fensters gleich nach der Änderung', async () => {
    const { project, test } = setup();
    const alpha = project('Alpha');
    const [alphaWindow, betaWindow] = await startWith(test, alpha, project('Beta'));
    await call(test, alphaWindow, 'project.setLayout', CUSTOM);
    // Das Fenster geht zu, bevor das entprellte Schreiben gelaufen wäre; der Abbau sichert den Zustand.
    test.ports.windows.close(alphaWindow);

    await call(test, betaWindow, 'app.openProject', { path: alpha });
    expect(await call(test, test.ports.windows.windowTitled(title('Alpha')), 'project.layout')).toEqual(CUSTOM);
  });

  it('gehört zu seinem Projekt; ein anderes Projekt behält sein eigenes', async () => {
    const { project, test } = setup();
    const [alphaWindow, betaWindow] = await startWith(test, project('Alpha'), project('Beta'));
    await call(test, alphaWindow, 'project.setLayout', CUSTOM);

    expect(await call(test, alphaWindow, 'project.layout')).toEqual(CUSTOM);
    expect(await call(test, betaWindow, 'project.layout')).toEqual(defaultLayout());
  });

  it('rundet Grössen auf ganze Pixel', async () => {
    const { project, test } = setup();
    const [alphaWindow] = await startWith(test, project('Alpha'));
    await call(test, alphaWindow, 'project.setLayout', { ...CUSTOM, left: { ...CUSTOM.left, size: 300.6 } });

    expect((await call(test, alphaWindow, 'project.layout')).left.size).toBe(301);
  });

  it('lehnt ein ungültiges Layout mit INVALID_PARAMS ab und behält das bisherige', async () => {
    const { project, test } = setup();
    const [alphaWindow] = await startWith(test, project('Alpha'));
    await call(test, alphaWindow, 'project.setLayout', CUSTOM);

    const invalid: unknown[] = [
      undefined,
      null,
      'links',
      { left: CUSTOM.left, bottom: CUSTOM.bottom },
      { ...CUSTOM, left: { ...CUSTOM.left, active: 'terminal' } },
      { ...CUSTOM, bottom: { ...CUSTOM.bottom, active: 'gibt-es-nicht' } },
      { ...CUSTOM, right: { ...CUSTOM.right, open: 'ja' } },
      { ...CUSTOM, left: { ...CUSTOM.left, size: 0 } },
      { ...CUSTOM, left: { ...CUSTOM.left, size: 10_001 } },
      { ...CUSTOM, bottom: { ...CUSTOM.bottom, size: '300' } },
      { ...CUSTOM, bottom: { ...CUSTOM.bottom, size: Number.NaN } },
    ];
    for (const params of invalid) {
      const response = await test.core.router.dispatch({ windowId: alphaWindow }, 'project.setLayout', params);
      expect(response, JSON.stringify(params)).toEqual({
        ok: false,
        error: { message: 'The tool window layout is invalid.', code: 'INVALID_PARAMS' },
      });
    }
    expect(await call(test, alphaWindow, 'project.layout')).toEqual(CUSTOM);
  });

  it('braucht ein Projekt', async () => {
    const { test } = setup();
    await test.core.start();
    const welcome = test.ports.windows.windowTitled(WELCOME);

    for (const name of ['project.layout', 'project.setLayout'] as const) {
      const response = await test.core.router.dispatch({ windowId: welcome }, name, CUSTOM);
      expect(response).toMatchObject({ ok: false, error: { code: 'NO_PROJECT' } });
    }
  });

  it('ersetzt unbrauchbare Seiten in der Zustandsdatei durch den Standard und behält die übrigen', async () => {
    const { project, test } = setup();
    const alpha = project('Alpha');
    const [alphaWindow] = await startWith(test, alpha);
    await call(test, alphaWindow, 'project.setLayout', CUSTOM);
    await call(test, alphaWindow, 'app.exit');
    await test.core.shutdown();

    // Von Hand verdorben: unten ein Werkzeugfenster der linken Seite, rechts kein Objekt.
    const file = path.join(test.dataDir, PROJECT_STATE_DIR, projectStateFileName(lexicalProjectKey(alpha)));
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.layout.bottom.active = 'project';
    saved.layout.right = 'kaputt';
    fs.writeFileSync(file, JSON.stringify(saved), 'utf8');

    const after = await restart(test);
    await after.core.start();
    expect(await call(after, after.ports.windows.windowTitled(title('Alpha')), 'project.layout')).toEqual({
      left: CUSTOM.left,
      bottom: defaultLayout().bottom,
      right: defaultLayout().right,
    });
  });
});
