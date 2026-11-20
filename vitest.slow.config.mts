import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Langsamer Testlauf (npm run test:slow): echte Sprachserver, Terminal, Datenbank und Netz, weiterhin ohne
// Electron. Tests, die etwas Fehlendes brauchen (JDK 25, Netz), überspringen sich mit klarer Meldung.
export default defineConfig({
  resolve: {
    alias: { electron: fileURLToPath(new URL('./test/support/noElectron.ts', import.meta.url)) },
  },
  test: {
    include: ['test/slow/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
