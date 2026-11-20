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
npm test           # schnelle Tests: Kern in Node, ohne Electron
npm run test:slow  # langsame Tests: echte Sprachserver, Terminal, Datenbank, Netz
npm run test:ui    # Oberflächentests: gebaute App im Testmodus, gesteuert mit Playwright
npm run test:packaged  # Prüfungen am ungepackten Paket (release\win-unpacked), ohne Fenster
npm run dist       # Installer bauen -> release\Codium Setup <version>.exe
```

Beim ersten `npm start` lädt Electron sein Programm einmalig herunter.

**Testmodus** für automatische Prüfungen der echten App (Details in `src/main/testMode.ts` und in den Spielregeln unter `docs/tickets/README.md`): `CODIUM_TEST_HIDDEN=1` öffnet Fenster ausserhalb des Bildschirms ohne Fokus und zeichnet „nach vorne holen“, Explorer und Zwischenablage nur auf. `CODIUM_TEST_DATA_DIR` ersetzt `%APPDATA%` als Wurzel des Datenordners, `CODIUM_TEST_PICK_DIR` beantwortet die Ordnerauswahl, und `CODIUM_TEST_NO_GIT=1` lässt Codium so tun, als fehle Git.

Unpaketiert (`npm start`, `npm run dev`) verwendet Codium den Datenordner `%APPDATA%\Codium-dev` und berührt eine installierte App (`%APPDATA%\Codium`) nicht. Die Einzelinstanz-Sperre hängt am Datenordner: Die Entwicklungsversion läuft neben einer installierten Codium, aber nur einmal.

## Aufbau

```
src/
  shared/types.ts      Vertrag Renderer ↔ Kern: Befehle, Ereignisse, API unter window.codium, IPC-Kanäle
  main/main.ts         Electron-Hauptprozess: Einzelinstanz, Testmodus, verbindet Kern, Ports und IPC
  main/core/           Kern ohne Electron: App-Kern, Projekt-Kern, Ports, Zustandsdateien, Befehlsverteilung
  main/electron/       Echte Ports mit Electron (Fenster, Ordnerauswahl, Geheimnisse, Shell-Aktionen)
  main/system/         Echter Port „System“ ohne Electron
  main/testMode.ts     Testmodus und Aufzeichnung
  main/dataFolder.ts   Datenordner (Codium bzw. Codium-dev)
  main/devMenu.ts      Menü der Entwicklungsversion (Neu laden, DevTools)
  preload/preload.ts   Stellt dem Renderer die API window.codium bereit
  renderer/            React-Oberfläche
    main.tsx           Einstieg
    App.tsx            Platzhalter
    styles/            Design-Variablen (tokens.css) und Stile (app.css)
test/
  support/             Test-Gerüst: nachgemachte Ports, Temp-Ordner, Git, Starthilfe für die App
  main/                schnelle Tests (Kern in Node, Electron gesperrt)
  slow/                langsame Tests
  ui/                  Oberflächentests mit Playwright
scripts/
  test-packaged.mjs    Prüfungen am ungepackten Paket
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
