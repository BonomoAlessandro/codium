// Hochzählen der Version für neue Installer (scripts/version.mjs).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextInstallerVersion, replaceVersion } from '../../scripts/version.mjs';

describe('Version für neue Installer', () => {
  it('zählt bei 0.x die zweite Stelle hoch und setzt die dritte auf 0', () => {
    expect(nextInstallerVersion('0.1.0')).toBe('0.2.0');
    expect(nextInstallerVersion('0.9.0')).toBe('0.10.0');
    expect(nextInstallerVersion('0.3.4')).toBe('0.4.0');
  });

  it('wird nie selbst zu 1.0 und lehnt Versionen ab 1.0 oder unbekannte Formen ab', () => {
    expect(nextInstallerVersion('0.99.0')).toBe('0.100.0');
    expect(() => nextInstallerVersion('1.0.0')).toThrow(/nur für 0\.x/);
    expect(() => nextInstallerVersion('0.1')).toThrow(/Unerwartete Version/);
    expect(() => nextInstallerVersion('0.1.0-beta')).toThrow(/Unerwartete Version/);
  });

  it('ersetzt in package.json nur die eigene Version, nicht die von Abhängigkeiten', () => {
    const text = '{\n  "name": "codium",\n  "version": "0.1.0",\n  "dependencies": {\n    "x": "0.1.0"\n  }\n}\n';
    const result = replaceVersion(text, '0.1.0', '0.2.0', 'package');
    expect(JSON.parse(result)).toEqual({ name: 'codium', version: '0.2.0', dependencies: { x: '0.1.0' } });
    expect(result.endsWith('\n')).toBe(true);
  });

  it('ersetzt in package-lock.json die Version oben und beim Paket selbst, nicht die von Abhängigkeiten', () => {
    const lock = [
      '{',
      '  "name": "codium",',
      '  "version": "0.1.0",',
      '  "lockfileVersion": 3,',
      '  "packages": {',
      '    "": {',
      '      "name": "codium",',
      '      "version": "0.1.0",',
      '      "license": "UNLICENSED"',
      '    },',
      '    "node_modules/x": {',
      '      "version": "0.1.0"',
      '    }',
      '  }',
      '}',
      '',
    ].join('\r\n');
    const result = replaceVersion(lock, '0.1.0', '0.2.0', 'lock');
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('0.2.0');
    expect(parsed.packages[''].version).toBe('0.2.0');
    expect(parsed.packages['node_modules/x'].version).toBe('0.1.0');
    // Zeilenenden bleiben, wie sie waren.
    expect(result.split('\r\n')).toHaveLength(lock.split('\r\n').length);
  });

  it('passt zu den echten Dateien des Projekts', () => {
    const root = path.resolve(__dirname, '..', '..');
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    const version = JSON.parse(pkg).version as string;
    const next = nextInstallerVersion(version);
    expect(JSON.parse(replaceVersion(pkg, version, next, 'package')).version).toBe(next);
    const newLock = JSON.parse(replaceVersion(lock, version, next, 'lock'));
    expect([newLock.version, newLock.packages[''].version]).toEqual([next, next]);
  });
});
