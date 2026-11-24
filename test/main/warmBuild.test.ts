// Vorlesen der gebauten App vor den Oberflächentests (Ticket 27): liest jede Datei, auch in Unterordnern, und meldet die
// langsamen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempDirs } from '../support/tempDir';
import { warmFiles } from '../support/warmBuild';

describe('Vorlesen der gebauten App', () => {
  const tempDir = useTempDirs();

  it('liest jede Datei unter dem Ordner einmal und meldet die, die länger brauchten als die Grenze', () => {
    const dist = tempDir();
    fs.mkdirSync(path.join(dist, 'renderer', 'assets'), { recursive: true });
    for (const file of ['main.js', 'renderer/mermaid.js', 'renderer/assets/logo.svg']) fs.writeFileSync(path.join(dist, file), 'x');
    // Mit einer Grenze unter null gilt jede Datei als langsam: So zeigt sich, dass alle gelesen wurden.
    expect(warmFiles(dist, -1).map((s) => path.relative(dist, s.file)).sort()).toEqual(['main.js', path.join('renderer', 'assets', 'logo.svg'), path.join('renderer', 'mermaid.js')]);
    expect(warmFiles(dist)).toEqual([]);
  });
});
