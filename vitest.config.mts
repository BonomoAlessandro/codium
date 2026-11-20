import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Schneller Testlauf (npm test): Kern und reine Logik in Node, ohne Electron und ohne Fenster.
export default defineConfig({
  resolve: {
    // Lädt getesteter Code doch Electron, schlägt der Test laut fehl, statt still weiterzulaufen.
    alias: { electron: fileURLToPath(new URL('./test/support/noElectron.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/slow/**', 'test/ui/**', '**/node_modules/**'],
    environment: 'node',
  },
});
