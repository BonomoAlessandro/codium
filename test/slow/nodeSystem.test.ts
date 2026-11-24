// Der echte Port „System“ (ohne Electron) auf diesem Rechner.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import { readTestMode } from '../../src/main/testMode';
import { tempPrefix } from '../support/testRun';

describe('Port „System“ (echt)', () => {
  it('findet Git im PATH und einen vorhandenen Benutzerordner', () => {
    const system = new NodeSystem();
    const git = system.findProgram('git');
    expect(git).not.toBeNull();
    expect(fs.statSync(git!).isFile()).toBe(true);
    expect(path.basename(git!).toLowerCase()).toMatch(/^git(\.exe|\.cmd)?$/);
    expect(fs.statSync(system.homeDir()).isDirectory()).toBe(true);
  });

  it('meldet Git als fehlend, wenn CODIUM_TEST_NO_GIT=1 gesetzt ist', () => {
    // Derselbe Weg wie im Hauptprozess: Umgebung → Testmodus → System-Port.
    const env = { ...process.env, CODIUM_TEST_NO_GIT: '1' };
    const system = new NodeSystem(env, { noGit: readTestMode(env).noGit });
    expect(system.findProgram('git')).toBeNull();
    expect(system.findProgram('git.exe')).toBeNull();
    // Andere Programme findet es weiterhin.
    expect(system.findProgram('cmd')).not.toBeNull();
  });

  it('liest Umgebungsvariablen ohne Unterscheidung der Gross-/Kleinschreibung, auch aus einer Kopie', () => {
    const system = new NodeSystem({ Path: 'C:\\x', SomeVar: '1' });
    expect(system.getEnv('PATH')).toBe('C:\\x');
    expect(system.getEnv('somevar')).toBe('1');
    expect(system.getEnv('fehlt')).toBeUndefined();
  });

  it('liest Ordner und Dateien, ohne bei fehlenden zu werfen', () => {
    const system = new NodeSystem();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix('system')));
    try {
      fs.mkdirSync(path.join(dir, 'jdk-25'));
      fs.writeFileSync(path.join(dir, 'jdk-25', 'release'), 'JAVA_VERSION="25"\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'datei.txt'), 'x', 'utf8');
      expect(system.listDirectories(dir)).toEqual(['jdk-25']);
      expect(system.readTextFile(path.join(dir, 'jdk-25', 'release'))).toContain('JAVA_VERSION="25"');
      expect(system.exists(path.join(dir, 'datei.txt'))).toBe(true);
      expect(system.listDirectories(path.join(dir, 'fehlt'))).toEqual([]);
      expect(system.readTextFile(path.join(dir, 'fehlt'))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
