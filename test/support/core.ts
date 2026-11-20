// Kern mit nachgemachten Ports für Teststelle 1, samt Neustart-Simulation.

import * as path from 'node:path';
import { AppCore } from '../../src/main/core/appCore';
import { createFakePorts, FakeEventSink, type FakePorts, type FakeSystemOptions } from './fakePorts';

export interface TestCore {
  core: AppCore;
  ports: FakePorts;
  events: FakeEventSink;
  logs: string[];
  dataDir: string;
}

export interface TestCoreOptions {
  system?: FakeSystemOptions;
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
    cleanupTimeoutMs: 200,
    log: (message) => logs.push(message),
  });
  return { core, ports, events, logs, dataDir };
}

/**
 * Beendet die App so, wie der Hauptprozess es tut: Der Kern wird abgebaut (schreibt seinen Zustand), danach
 * schliessen sich alle noch offenen Fenster.
 */
export async function quitApp(test: TestCore): Promise<void> {
  await test.core.shutdown();
  for (const windowId of test.ports.windows.openWindowIds) test.ports.windows.close(windowId);
}

/**
 * Simuliert einen Neustart: Die alte App wird beendet (`quitApp`), ein neuer Kern entsteht auf demselben
 * Datenordner mit frischen Ports. Gestartet wird er erst mit `core.start()`, damit Tests vorher eingreifen können.
 */
export async function restart(previous: TestCore, options: TestCoreOptions = {}): Promise<TestCore> {
  await quitApp(previous);
  return createTestCore(previous.dataDir, options);
}
