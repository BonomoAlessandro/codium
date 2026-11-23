// Hält einen Test-PostgreSQL in einem eigenen Prozess, bis dieser von aussen beendet wird (Test des Wächters,
// Ticket 27). Meldet Port und Datenordner als JSON auf einer Zeile. Node startet die Datei direkt (siehe processes.ts).

import { startPostgres } from './postgres.ts';

const server = await startPostgres();
process.stdout.write(`${JSON.stringify({ port: server.port, dataDir: server.dataDir })}\n`);
setInterval(() => {}, 60_000);
