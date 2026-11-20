import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataFolder } from '../../src/main/dataFolder';

describe('Datenordner', () => {
  const appData = path.join('C:', 'Users', 'test', 'AppData', 'Roaming');

  it('liegt für die installierte App unter Codium', () => {
    expect(dataFolder(appData, true)).toBe(path.join(appData, 'Codium'));
  });

  it('liegt für die Entwicklung unter Codium-dev, getrennt von der installierten App', () => {
    expect(dataFolder(appData, false)).toBe(path.join(appData, 'Codium-dev'));
  });
});
