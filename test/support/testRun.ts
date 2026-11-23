// Kennung des laufenden Testlaufs (Ticket 27). Die Schlussprüfung (finalCheck.ts) setzt sie, bevor Vitest die
// Testprozesse startet; die erben sie. Temp-Ordner der Tests tragen sie im Namen, damit die Schlussprüfung genau die
// liegengebliebenen Ordner dieses Laufs findet und nie die eines anderen. Node lädt die Datei auch direkt (siehe
// processes.ts).

export const RUN_ENV = 'CODIUM_TEST_RUN';

/** Namensanfang für einen Temp-Ordner dieser Art im laufenden Testlauf, etwa `codium-test-1a2b3c4d-`. */
export function tempPrefix(kind: string): string {
  const run = process.env[RUN_ENV];
  return run ? `codium-${kind}-${run}-` : `codium-${kind}-`;
}
