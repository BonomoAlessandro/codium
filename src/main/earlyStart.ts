// Was vor allem anderen im Hauptprozess passieren muss. main.ts lädt dieses Modul als allererstes, damit es vor
// den übrigen Modulen ausgewertet wird.
//
// - Testmodus: Electron zeigt bei einer nicht abgefangenen Ausnahme einen Dialog auf dem Desktop, der den
//   Hauptprozess blockiert, auch bei einer Ausnahme beim Laden eines Moduls. Electron verzichtet darauf, sobald
//   ein eigener Handler angemeldet ist; im Testmodus wird deshalb gleich hier protokolliert und beendet.
// - Threadpool: Asynchrone Dateiabfragen laufen im Threadpool von libuv (standardmässig 4 Threads). Eine Abfrage
//   auf ein nicht erreichbares Netzlaufwerk belegt einen Thread, bis Windows aufgibt. Die Grösse liest libuv bei
//   der ersten Abfrage, deshalb wird sie hier gesetzt, bevor irgendeine läuft.

import { app } from 'electron';
import { readTestMode } from './testMode';

if (readTestMode(process.env).hidden) {
  process.on('uncaughtException', (err) => {
    console.error('Nicht abgefangene Ausnahme im Testmodus:', err);
    app.exit(1);
  });
}

process.env.UV_THREADPOOL_SIZE ??= '16';
