// Spielt den Testprozess, der Codium startet (Test des Wächters, Ticket 27): Er hält die Pipe des Wächters offen wie die
// Starthilfe, startet Codium im Testmodus und bleibt stehen, bis er von aussen beendet wird. Programm, Ordner und
// Umgebung kommen als JSON über die Standardeingabe; die Prozessnummer von Codium geht als JSON auf einer Zeile hinaus.
// Node startet die Datei direkt (siehe processes.ts).

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

interface Request {
  electron: string;
  root: string;
  env: Record<string, string>;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => (input += chunk));
process.stdin.on('end', () => {
  const { electron, root, env } = JSON.parse(input) as Request;
  // Nie ohne Testmodus (Spielregeln); die Umgebung baut die Starthilfe, hier nur die Gegenprobe.
  if (env.CODIUM_TEST_HIDDEN !== '1' || !env.CODIUM_TEST_DATA_DIR || !env.CODIUM_TEST_GUARD_PIPE) process.exit(2);
  // Der Datenordner liegt im Temp-Ordner, wie es die Starthilfe verlangt (assertTestModeEnv).
  const real = (dir: string) => fs.realpathSync.native(path.resolve(dir)).toLowerCase();
  if (!fs.existsSync(env.CODIUM_TEST_DATA_DIR) || !real(env.CODIUM_TEST_DATA_DIR).startsWith(real(os.tmpdir()) + path.sep)) process.exit(2);
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.resume();
  });
  server.listen(env.CODIUM_TEST_GUARD_PIPE, () => {
    // Abgekoppelt: Unter Windows legt Node jedes direkte Kind in ein Job-Objekt, das es mit dem Elternprozess beendet.
    // Damit nur der Wächter Codium beenden kann, startet es hier ausserhalb davon, wie bei einem Start ohne Node.
    const app = spawn(electron, [root], { cwd: root, env, stdio: 'ignore', windowsHide: true, detached: true });
    process.stdout.write(`${JSON.stringify({ pid: app.pid })}\n`);
  });
});
