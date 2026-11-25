import { defineConfig } from 'vitest/config';

// Oberflächentests (npm run test:ui): die gebaute App (dist/) im Testmodus, gesteuert mit Playwright.
// Ohne Electron-Sperre: Die Tests brauchen den Pfad zum Electron-Programm. Nacheinander, damit sich die
// Fenster nicht ins Gehege kommen.
export default defineConfig({
  test: {
    include: ['test/ui/**/*.test.ts'],
    environment: 'node',
    // Schlussprüfung nach dem letzten Test: verwaiste Prozesse aus diesem Checkout und Temp-Ordner dieses Laufs.
    // Vorher einmal alle gebauten Dateien lesen: Der Virenscanner prüft neue Dateien beim ersten Zugriff, bei Mermaid
    // über 10 s; das soll nicht in die Zeitlimits der Tests fallen (warmBuild.ts).
    globalSetup: ['test/support/finalCheck.ts', 'test/support/warmBuild.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // expect.poll wartet ohne eigene Angabe nur 1 s. Das war auf dem Entwicklungsrechner mehrmals zu knapp, etwa für
    // die Treffer der Projektsuche oder das Zurücksetzen einer Datei nach „Rollback“ (Ticket 28, offene-punkte.md).
    // Eine Abfrage endet, sobald ihre Bedingung gilt; länger dauert nur ein Test, der ohnehin scheitert.
    expect: { poll: { timeout: 5_000 } },
    fileParallelism: false,
  },
});
