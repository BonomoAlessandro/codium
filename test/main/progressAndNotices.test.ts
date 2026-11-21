// Teststelle 1: Fortschritt (Beginn, Stand, Ende) und Meldungen des Kerns erreichen nur das Fenster, für das sie
// bestimmt sind.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

describe('Fortschritt und Meldungen', () => {
  const tempDir = useTempDirs();

  /** Zwei offene Projekte in eigenen Fenstern. */
  async function twoProjects() {
    const root = tempDir();
    const test = createTestCore(path.join(root, 'data'));
    const open = async (name: string) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      const windowId = test.ports.windows.open({ kind: 'project', title: `${name} – Codium` });
      return { windowId, core: await test.core.openProjectCore(dir, windowId) };
    };
    return { test, alpha: await open('Alpha'), beta: await open('Beta') };
  }

  const progressOf = (test: TestCore, windowId: number) =>
    test.events.forWindow(windowId).filter((e) => e.name === 'app.progress').map((e) => e.payload);

  it('Beginn, Stand und Ende einer Arbeit erreichen nur das Fenster ihres Projekts', async () => {
    const { test, alpha, beta } = await twoProjects();

    const work = alpha.core.progress.begin('Importing Java project…');
    work.report({ fraction: 0.4 });
    // Über 1 hinaus gibt es nicht; ein neuer Titel ersetzt den alten.
    work.report({ fraction: 1.7, title: 'Importing modules…' });
    work.report({});
    work.end();
    // Nach dem Ende ändert nichts mehr etwas.
    work.end();
    work.report({ fraction: 0.5 });

    const [begin] = progressOf(test, alpha.windowId) as Array<{ id: string }>;
    const id = begin.id;
    expect(progressOf(test, alpha.windowId)).toEqual([
      { kind: 'begin', id, title: 'Importing Java project…' },
      { kind: 'report', id, fraction: 0.4 },
      { kind: 'report', id, title: 'Importing modules…', fraction: 1 },
      { kind: 'report', id },
      { kind: 'end', id },
    ]);
    expect(test.events.forWindow(beta.windowId)).toEqual([]);
  });

  it('Meldungen erreichen nur das Fenster ihres Projekts', async () => {
    const { test, alpha, beta } = await twoProjects();

    beta.core.notify({ level: 'success', text: 'Pushed 2 commits' });
    alpha.core.notify({ level: 'error', text: 'Push rejected' });

    expect(test.events.forWindow(beta.windowId)).toEqual([
      { name: 'app.notice', payload: { level: 'success', text: 'Pushed 2 commits' } },
    ]);
    expect(test.events.forWindow(alpha.windowId)).toEqual([
      { name: 'app.notice', payload: { level: 'error', text: 'Push rejected' } },
    ]);
  });

  it('gleichzeitige Arbeiten verschiedener Projekte haben verschiedene Kennungen', async () => {
    const { test, alpha, beta } = await twoProjects();

    alpha.core.progress.begin('Pushing…');
    beta.core.progress.begin('Pushing…');
    alpha.core.progress.begin('Fetching…');

    const ids = [...progressOf(test, alpha.windowId), ...progressOf(test, beta.windowId)].map((e) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(3);
  });

  it('das Ende kommt auch, wenn die Arbeit scheitert', async () => {
    const { test, alpha } = await twoProjects();

    await expect(
      alpha.core.progress.run('Cloning…', async (work) => {
        work.report({ fraction: 0.2 });
        throw new Error('Netz weg');
      }),
    ).rejects.toThrow('Netz weg');
    expect(progressOf(test, alpha.windowId).map((e) => (e as { kind: string }).kind)).toEqual(['begin', 'report', 'end']);
    expect(await alpha.core.progress.run('Saving…', () => 42)).toBe(42);
  });

  it('nach dem Abbau des Projekts kommt nichts mehr an', async () => {
    const { test, alpha } = await twoProjects();
    const work = alpha.core.progress.begin('Indexing…');

    await test.core.closeProjectCore(alpha.windowId);
    work.end();
    alpha.core.notify({ level: 'info', text: 'zu spät' });
    expect(test.events.forWindow(alpha.windowId).map((e) => e.name)).toEqual(['app.progress']);
  });

  it('der App-Kern schickt Meldungen und Fortschritt auch an ein Fenster ohne Projekt', async () => {
    const { test, alpha } = await twoProjects();
    const welcome = test.ports.windows.open({ kind: 'welcome', title: 'Welcome to Codium' });

    test.core.notifyWindow(welcome, { level: 'info', text: 'Cloning finished' });
    const work = test.core.progressForWindow(welcome).begin('Cloning…', 0.25);
    work.end();

    const events = test.events.forWindow(welcome);
    expect(events.map((e) => e.name)).toEqual(['app.notice', 'app.progress', 'app.progress']);
    expect(events[1].payload).toMatchObject({ kind: 'begin', title: 'Cloning…', fraction: 0.25 });
    expect(test.events.forWindow(alpha.windowId)).toEqual([]);
  });

  it('Ereignisse an ein geschlossenes Fenster fallen weg, auch wenn es sich danach noch „bereit“ meldet', async () => {
    const { test } = await twoProjects();
    test.ports.windows.autoReady = false;
    const windowId = test.ports.windows.open({ kind: 'welcome', title: 'Welcome to Codium' });
    test.ports.windows.close(windowId);

    test.core.notifyWindow(windowId, { level: 'info', text: 'niemand da' });
    test.ports.windows.simulateReady(windowId);
    expect(test.events.forWindow(windowId)).toEqual([]);
  });
});
