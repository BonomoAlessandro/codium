// Kern mit nachgemachten Ports für Teststelle 1, samt Neustart-Simulation.

import * as path from 'node:path';
import { ripgrepPath } from '../../src/main/ripgrepPath';
import { AppCore } from '../../src/main/core/appCore';
import { createFakePorts, FakeEventSink, type FakePorts, type FakeSystemOptions } from './fakePorts';
import { beforeTempDirRemoval } from './tempDir';

/** Alle Kerne des laufenden Tests; nach dem Test werden sie beendet, bevor ihre Temp-Ordner verschwinden. */
const liveCores = new Set<TestCore>();
beforeTempDirRemoval(async () => {
  for (const test of [...liveCores]) await quitApp(test);
});

export interface TestCore {
  core: AppCore;
  ports: FakePorts;
  events: FakeEventSink;
  logs: string[];
  dataDir: string;
}

export interface TestCoreOptions {
  system?: FakeSystemOptions;
  /** Zeitlimit für Dateiabfragen auf Projektordnern (Standard des Kerns: 2 s). */
  folderQueryTimeoutMs?: number;
  /** Höchstdauer einer Aufräumarbeit beim Abbau (Standard der Tests: 200 ms). */
  cleanupTimeoutMs?: number;
  /** Zeitlimit fürs Speichern der Tabs vor dem Schliessen und Beenden (Standard der Tests: 0, also nicht fragen). */
  flushTimeoutMs?: number;
  /** Ab dieser Dauer zeigt eine Dateioperation Fortschritt (Standard des Kerns: 1 s). */
  fileProgressDelayMs?: number;
}

/** Erzeugt einen App-Kern auf einem Datenordner, mit nachgemachten Ports und sofortigem Schreiben. */
export function createTestCore(dataDir: string, options: TestCoreOptions = {}): TestCore {
  const ports = createFakePorts(path.join(dataDir, 'test-trash'), options.system);
  const events = new FakeEventSink();
  const logs: string[] = [];
  const core = new AppCore({
    dataDir,
    ports,
    events,
    appInfo: { name: 'Codium', version: '0.0.0-test' },
    saveDebounceMs: 5,
    cleanupTimeoutMs: options.cleanupTimeoutMs ?? 200,
    fileProgressDelayMs: options.fileProgressDelayMs,
    flushTimeoutMs: options.flushTimeoutMs ?? 0,
    ripgrepPath: ripgrepPath(path.resolve(__dirname, '..', '..'), false),
    readmePath: path.resolve(__dirname, '..', '..', 'README.md'),
    folderQueryTimeoutMs: options.folderQueryTimeoutMs,
    log: (message) => logs.push(message),
  });
  const test = { core, ports, events, logs, dataDir };
  liveCores.add(test);
  return test;
}

/**
 * Beendet die App so, wie der Hauptprozess es tut: Der Kern wird abgebaut (schreibt seinen Zustand), danach
 * schliessen sich alle noch offenen Fenster.
 */
export async function quitApp(test: TestCore): Promise<void> {
  await test.core.shutdown();
  for (const windowId of test.ports.windows.openWindowIds) test.ports.windows.close(windowId);
  liveCores.delete(test);
}

/**
 * Simuliert einen Neustart: Die alte App wird beendet (`quitApp`), ein neuer Kern entsteht auf demselben
 * Datenordner mit frischen Ports. Gestartet wird er erst mit `core.start()`, damit Tests vorher eingreifen können.
 */
export async function restart(previous: TestCore, options: TestCoreOptions = {}): Promise<TestCore> {
  await quitApp(previous);
  return createTestCore(previous.dataDir, options);
}
