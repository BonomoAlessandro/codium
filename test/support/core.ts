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
 * Simuliert einen Neustart: Der alte Kern wird beendet (schreibt seinen Zustand), ein neuer Kern startet auf
 * demselben Datenordner mit frischen Ports.
 */
export async function restart(previous: TestCore, options: TestCoreOptions = {}): Promise<TestCore> {
  await previous.core.shutdown();
  return createTestCore(previous.dataDir, options);
}
