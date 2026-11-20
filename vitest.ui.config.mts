import { defineConfig } from 'vitest/config';

// Oberflächentests (npm run test:ui): die gebaute App (dist/) im Testmodus, gesteuert mit Playwright.
// Ohne Electron-Sperre: Die Tests brauchen den Pfad zum Electron-Programm. Nacheinander, damit sich die
// Fenster nicht ins Gehege kommen.
export default defineConfig({
  test: {
    include: ['test/ui/**/*.test.ts'],
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
