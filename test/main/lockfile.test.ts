// package-lock.json zeigt nur auf die öffentliche npm-Registry (Review von Ticket 24). Ist auf einem Rechner eine
// eigene Registry eingestellt, schreibt `npm install` deren Adressen ins Lockfile; andere Rechner kämen nicht daran,
// und interne Adressen gehören nicht ins Repository.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = 'https://registry.npmjs.org/';

describe('package-lock.json', () => {
  it(`jedes „resolved“ beginnt mit ${REGISTRY}`, () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { resolved?: string }>;
    };
    const resolved = Object.entries(lock.packages).filter(([, entry]) => entry.resolved !== undefined);
    expect(resolved.length).toBeGreaterThan(0);
    const wrong = resolved.filter(([, entry]) => !entry.resolved!.startsWith(REGISTRY)).map(([name, entry]) => `${name}: ${entry.resolved}`);
    expect(
      wrong,
      `Diese Einträge in package-lock.json zeigen nicht auf ${REGISTRY}. In „resolved“ Host und Präfix durch ${REGISTRY} ` +
        'ersetzen (Pfad und „integrity“ bleiben gleich) und dafür kein `npm install` mit der Registry-Einstellung dieses ' +
        'Rechners ausführen, das schriebe die Adressen wieder so.',
    ).toEqual([]);
  });
});
