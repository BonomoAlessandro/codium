import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests in Node, ohne Electron und ohne Fenster.
export default defineConfig({
  resolve: {
    // Lädt getesteter Code doch Electron, schlägt der Test laut fehl, statt still weiterzulaufen.
    alias: { electron: fileURLToPath(new URL('./test/support/noElectron.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
