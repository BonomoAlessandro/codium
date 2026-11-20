# Codium

Eine kleine eigene IDE im Stil von IntelliJ, als Desktop-App für Windows.

> Stand: Grundgerüst. Das Fenster öffnet sich und zeigt einen Platzhalter. Die Funktionen werden noch spezifiziert (siehe „Offene Punkte“).

## Stack

Aufgebaut wie THub.

| Teil | Technik |
|---|---|
| App-Hülle | [Electron](https://www.electronjs.org/) |
| Oberfläche | [React](https://react.dev/) mit TypeScript, normales CSS mit Design-Variablen (hell/dunkel) |
| Build | esbuild (Bundling), TypeScript (nur Typecheck), electron-builder (NSIS-Installer) |
| Tests | Vitest, in Node ohne Electron |

## Entwicklung

```powershell
npm install
npm start          # bauen + App starten
npm run dev        # wie start, mit Sourcemaps und unminifiziert
npm run typecheck  # TypeScript prüfen
npm test           # Tests mit Vitest
npm run dist       # Installer bauen -> release\Codium Setup <version>.exe
```

Beim ersten `npm start` lädt Electron sein Programm einmalig herunter.

Unpaketiert (`npm start`, `npm run dev`) verwendet Codium den Datenordner `%APPDATA%\Codium-dev` und berührt eine installierte App (`%APPDATA%\Codium`) nicht. Die Einzelinstanz-Sperre hängt am Datenordner: Die Entwicklungsversion läuft neben einer installierten Codium, aber nur einmal.

## Aufbau

```
src/
  shared/types.ts      Vertrag Renderer ↔ Hauptprozess: API unter window.codium, IPC-Kanäle
  main/main.ts         Electron-Hauptprozess: Einzelinstanz, Fenster, IPC
  main/dataFolder.ts   Datenordner (Codium bzw. Codium-dev)
  main/devMenu.ts      Menü der Entwicklungsversion (Neu laden, DevTools)
  preload/preload.ts   Stellt dem Renderer die API window.codium bereit
  renderer/            React-Oberfläche
    main.tsx           Einstieg
    App.tsx            Platzhalter
    styles/            Design-Variablen (tokens.css) und Stile (app.css)
test/
  support/             Test-Gerüst (Electron ist in Tests gesperrt)
  main/                Tests für den Hauptprozess
docs/
  specs/               Spezifikationen
  tickets/             Umsetzungs-Tickets
```

Grundsatz wie bei THub: Die Logik liegt im Hauptprozess, ohne direkte Abhängigkeit von Electron, damit sie sich in Node testen lässt. Der Renderer zeigt an und schickt Befehle.

## Offene Punkte

Noch zu spezifizieren, unter anderem:

- Umfang der ersten Version: welche Sprachen, welche Funktionen
- Code-Editor (Kandidat: Monaco, der Editor aus VS Code)
- Sprachverständnis: Vervollständigung, Fehler, Navigation (Kandidat: Language Server über LSP)
- Projekt-Fenster und Dateibaum
- Integriertes Terminal (Kandidat: xterm.js + node-pty wie in THub)
- Ausführen und Debuggen
- Layout und Aussehen: Titelleiste, Werkzeugfenster, Statusleiste, Design hell/dunkel
- Was über einen Neustart erhalten bleibt
