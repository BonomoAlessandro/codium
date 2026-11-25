import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Aufnahmen für die Entwürfe von Ticket 28 (Scrollbalken). Läuft bewusst nicht in `npm run test:ui` (dort gilt nur
// test/ui/**), sondern nur von Hand, nach einem Build, aus dem Projektordner:
//
//   node build.mjs
//   npx vitest run --config docs/entwuerfe/28-scrollbalken/aufnahmen/vitest.config.mts
//
// Die App startet dabei wie in den Oberflächentests über `launchCodium`, also im Testmodus mit verborgenem Fenster.
export default defineConfig({
  root: fileURLToPath(new URL('../../../..', import.meta.url)),
  test: {
    include: ['docs/entwuerfe/28-scrollbalken/aufnahmen/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/support/finalCheck.ts', 'test/support/warmBuild.ts'],
    testTimeout: 900_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
