// Was vor allem anderen im Hauptprozess passieren muss. main.ts lädt dieses Modul als allererstes, damit es vor
// den übrigen Modulen ausgewertet wird.
//
// - Testmodus: Electron zeigt bei einer nicht abgefangenen Ausnahme einen Dialog auf dem Desktop, der den
//   Hauptprozess blockiert, auch bei einer Ausnahme beim Laden eines Moduls. Electron verzichtet darauf, sobald
//   ein eigener Handler angemeldet ist; im Testmodus wird deshalb gleich hier protokolliert und beendet.
// - Threadpool: Asynchrone Dateiabfragen laufen im Threadpool von libuv (standardmässig 4 Threads). Eine Abfrage
//   auf ein nicht erreichbares Netzlaufwerk belegt einen Thread, bis Windows aufgibt. Die Grösse liest libuv aus
//   `UV_THREADPOOL_SIZE`, synchron beim ersten Einreichen einer Arbeit. Deshalb wird die Variable hier gesetzt,
//   eine erste Abfrage eingereicht und die Variable gleich wieder entfernt, damit Kindprozesse (Terminal,
//   Sprachserver, Git) sie nicht erben. Hat sie jemand von aussen gesetzt, bleibt sie, wie sie ist.

import { app } from 'electron';
import * as fs from 'node:fs';
import { readTestMode } from './testMode';

if (readTestMode(process.env).hidden) {
  process.on('uncaughtException', (err) => {
    console.error('Nicht abgefangene Ausnahme im Testmodus:', err);
    app.exit(1);
  });
}

if (process.env.UV_THREADPOOL_SIZE === undefined) {
  process.env.UV_THREADPOOL_SIZE = '16';
  // Das Programm selbst liegt sicher ausserhalb von app.asar; Dateien darin beantwortet Electron ohne Threadpool.
  void fs.promises.stat(process.execPath).catch(() => undefined);
  delete process.env.UV_THREADPOOL_SIZE;
}
