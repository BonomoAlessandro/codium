// Teststelle 1: Ein anderes JDK in den Einstellungen startet den Java-Server neu, aber nur, wenn sich das verwendete JDK
// wirklich ändert (Review von Ticket 14). Mit nachgemachten JDKs und jdtls: Jeder Startversuch scheitert und steht im
// Protokoll, so lassen sich Starts zählen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';

describe('Neustart des Java-Servers bei einem anderen JDK', () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  it('startet neu, wenn sich das verwendete JDK ändert, sonst nicht', async () => {
    const root = tempDir();
    const tools = path.join(root, 'tools');
    fs.mkdirSync(path.join(tools, 'jdtls', 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(tools, 'jdtls', 'config_win'), { recursive: true });
    fs.writeFileSync(path.join(tools, 'jdtls', 'plugins', 'org.eclipse.equinox.launcher_1.0.0.jar'), '');
    fs.writeFileSync(path.join(tools, 'jdtls', 'config_win', 'config.ini'), 'x=1\n');
    fs.writeFileSync(path.join(tools, 'lombok.jar'), '');
    const programFiles = path.join(root, 'Program Files');
    const jdks = ['25.0.1', '26.0.1'].map((version) => {
      const dir = path.join(programFiles, 'Eclipse Adoptium', `jdk-${version}`);
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'bin', 'java.exe'), '');
      fs.writeFileSync(path.join(dir, 'release'), `JAVA_VERSION="${version}"\nIMPLEMENTOR="Test"\n`);
      return dir;
    });
    const project = path.join(root, 'Shapes');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'pom.xml'), '<project/>');
    const test = createTestCore(path.join(root, 'data'), {
      system: { env: { ProgramFiles: programFiles }, home: path.join(root, 'home') },
      java: { jdtls: path.join(tools, 'jdtls'), lombok: path.join(tools, 'lombok.jar') },
    });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shapes – Codium');
    const attempts = async () => {
      await new Promise((r) => setTimeout(r, 400));
      return test.logs.filter((l) => /Java-Sprachserver/.test(l)).length;
    };
    const first = await attempts();
    expect(first).toBeGreaterThan(0);
    // Ausdrücklich das JDK, das „Newest detected“ ohnehin nimmt: kein Neustart.
    await call(test, windowId, 'app.updateSettings', { jdk: jdks[1] });
    expect(await attempts()).toBe(first);
    // Ein anderes JDK: Neustart.
    await call(test, windowId, 'app.updateSettings', { jdk: jdks[0] });
    expect(await attempts()).toBeGreaterThan(first);
  });
});
