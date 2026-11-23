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
    // Viele Tests starten echte Prozesse (Git, ripgrep) oder warten auf die Dateiüberwachung. Unter voller Last
    // (bis zu einer Testdatei je Prozessorkern gleichzeitig) brauchen sie einige Sekunden, und ihre inneren Wartezeiten
    // reichen bis 10 s. Das Standardlimit von 5 s riss das, obwohl die Tests korrekt arbeiteten; ein echter Hänger
    // fällt weiterhin auf, nur später. Einzelne Gruppen mit langen Git-Abläufen setzen ein noch höheres Limit.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Höchstens halb so viele Testdateien gleichzeitig wie Prozessorkerne: Prozessstarts sind unter Windows teuer, und
    // mit einer Datei je Kern stauten sie sich (ein Lauf dauerte einmal doppelt so lang). Gemessen ist der Lauf so
    // nicht langsamer, aber gleichmässiger.
    maxWorkers: '50%',
  },
});
