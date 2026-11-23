// Wächter im Testmodus (Ticket 27). Lädt nie Electron.
//
// Die Starthilfe der Tests öffnet eine benannte Pipe und gibt ihren Namen in `CODIUM_TEST_GUARD_PIPE` mit; Codium
// verbindet sich beim Start damit. Endet der Testprozess, auch abrupt (Zeitlimit, Absturz, abgebrochener Lauf),
// schliesst Windows seine Seite der Pipe. Codium merkt das sofort und beendet sich samt seinen Kindprozessen
// (Sprachserver, Shells), statt verborgen weiterzulaufen. Eine Prozessnummer des Testprozesses allein genügte nicht:
// Windows vergibt frei gewordene Nummern schnell neu, und Codium hielte dann einen fremden Prozess für seinen Starter.

import * as net from 'node:net';

/**
 * Verbindet sich mit der Pipe des Testprozesses und ruft `onLost` genau einmal, sobald sie nicht erreichbar ist oder
 * sich schliesst. Die Verbindung hält Codium nicht am Leben.
 */
export function watchTestGuard(pipe: string, onLost: (reason: string) => void): void {
  let lost = false;
  const lose = (reason: string) => {
    if (lost) return;
    lost = true;
    onLost(reason);
  };
  const socket = net.connect(pipe);
  socket.on('error', (err) => lose(`Pipe des Testprozesses nicht erreichbar (${err.message})`));
  socket.on('close', () => lose('Pipe des Testprozesses geschlossen'));
  // Der Testprozess schickt nichts; gelesen wird nur, damit das Ende der Pipe ankommt.
  socket.resume();
  socket.unref();
}
