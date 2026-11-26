# 36 – TypeScript-Server stürzt ab, weil er beim Start offene Java-Dateien gemeldet bekommt

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: „Sprachverständnis“ (TypeScript und JavaScript, Neustart nach Absturz)
Spezifikation: „Sprachverständnis“ (Dokumente, Wahl des TypeScript-Servers, Neustarts)

Dieses Ticket kam nach Ticket 32 dazu, auf Wunsch des Nutzers. Es setzt Ticket 30 fort: Dort blieb die Ursache der wiederholten Abstürze offen, und der Nutzer schloss das Ticket mit den Worten, er erstelle ein neues, falls der Fehler wieder auftaucht.

Am 2026-11-26 bekam er im installierten Codium 0.3.0 wieder die Meldung „The TypeScript language server stopped 4 times within three minutes and was not restarted.“ Das geschah, als er in seinem Java-Projekt eine `.jsx`-Datei öffnete. Diesmal lag dank Ticket 30 das Protokoll vor („Show Log“).

## Das Protokoll

Gekürzt; Projekt- und Dateipfade des Nutzers sind ersetzt:

```
=== <Datum Uhrzeit> – TypeScript language server stopped unexpectedly ===
Server:  TypeScript (bundled-native)
Program: …\resources\typescript-native\tsc.exe --lsp --stdio
Exit:    code 2
Then:    Restarting (restart 1 of 3 within three minutes).
--- stderr ---
panic: ScriptKind must be specified when parsing source file: <Projekt>/<Modul>/src/main/java/…/<Klasse>.java [recovered, repanicked]

goroutine 35 [running]:
…
github.com/microsoft/typescript-go/internal/parser.(*Parser).initializeState(…)
    github.com/microsoft/typescript-go/internal/parser/parser.go:292
github.com/microsoft/typescript-go/internal/parser.ParseSourceFile(…)
    github.com/microsoft/typescript-go/internal/parser/parser.go:140
github.com/microsoft/typescript-go/internal/project.NewSession.NewParseCache.func3(…)
    github.com/microsoft/typescript-go/internal/project/parsecache.go:34
github.com/microsoft/typescript-go/internal/project.(*compilerHost).GetSourceFile(…)
    github.com/microsoft/typescript-go/internal/project/compilerhost.go:100
github.com/microsoft/typescript-go/internal/compiler.(*fileLoader).parseSourceFile(…)
    github.com/microsoft/typescript-go/internal/compiler/fileloader.go:370
…
```

- **Ablauf:** Alle vier Einträge sind gleich, mit derselben `.java`-Datei, und liegen innerhalb von rund 240 ms. Jeder Neustart stürzt also sofort wieder ab, beim vierten Mal gibt Codium auf.
- **Server:** Es war der mitgelieferte native Server (`bundled-native`), weil das Projekt kein eigenes TypeScript hat.

## Ursache (Befund am Code, durch Test zu bestätigen)

- **Was der Server tut:** Der TypeScript-Server soll eine Java-Datei als Quelldatei laden. Weil er für `.java` keine Dateiart (ScriptKind) kennt, bricht er mit einer Panic ab.
- **Woher die Java-Datei kommt:** `LanguageService.start` (`src/main/core/language/languageService.ts`, nach `initialized`, heute etwa Zeile 730) meldet dem startenden Server alle offenen Dokumente:

  ```ts
  // Die offenen Dokumente melden (auch die, die während des Starts kamen, und nach einem Neustart).
  for (const doc of this.documents.values()) this.sendOpen(server, doc.path);
  ```

  `sendOpen` prüft nicht, ob das Dokument zu diesem Server gehört (`doc.server`). `didOpen` und die übrigen Wege leiten Dokumente über `serverIdOf` richtig weiter; nur dieser Weg beim Start und Neustart tut es nicht.
- **Folge:**
  - Ist beim Start des TypeScript-Servers eine Java-Datei offen, bekommt er `textDocument/didOpen` mit `languageId: "java"` für eine `.java`-Datei. Gestartet wird er etwa beim Öffnen einer `.js`- oder `.jsx`-Datei.
  - Das wiederholt sich nach jedem Neustart, daher die vier Abstürze in einem Augenblick.
  - Umgekehrt bekommt der Java-Server (jdtls) beim Start offene JavaScript- und TypeScript-Dateien.
- **Warum Ticket 30 es nicht fand:** Seine Nachstellungen hatten beim Start des TypeScript-Servers keine Java-Datei offen. Im Alltag des Nutzers, einem Java-Projekt mit Web-Oberfläche, ist das der Normalfall.

## Was gebaut wird

- **Erst bestätigen:**
  - Der Agent stellt den Absturz in einem Test nach: mit einem Testprojekt ohne eigenes TypeScript, einer offenen `.java`-Datei und danach einer `.jsx`-Datei. Dazu der echte native Server im langsamen Lauf und ein nachgemachter Server im schnellen Lauf (`test/support/fakeLspServer.ts`), der `didOpen` aufzeichnet.
  - Ohne die Behebung ist der Test rot: Der native Server stürzt ab bzw. der nachgemachte bekommt die `.java`-Datei.
- **Beheben:**
  - Ein Server bekommt beim Start und Neustart nur die offenen Dokumente, die zu ihm gehören (`doc.server`).
  - Am besten prüft `sendOpen` selbst, dass Dokument und Server zusammenpassen. So kann kein anderer Weg den Fehler wiederholen.
- **Weitere Stellen prüfen:** Der Agent geht alle Stellen durch, die über alle Dokumente laufen oder Dokumente an einen Server schicken: `didChange`, `didClose`, Diagnosen, `scheduleAllDiagnostics`, implizit geöffnete Dokumente, Anfragen. Er behebt dieselbe Verwechslung, wo sie vorkommt, und hält das Ergebnis im Ticket fest.
- **Ticket 30:** Dort einen Verweis auf dieses Ticket ergänzen: Ursache gefunden.
- **Offene Punkte:** In `docs/offene-punkte.md` nachführen, wo nötig. Den in Ticket 30 gefundenen Fehler mit mehr als 1000 Dateiänderungen auf einmal behandelt dieses Ticket nicht; der Nutzer hat diesen Punkt verworfen.
- **Spezifikation:** Bei „Sprachverständnis“ (Dokumente) festhalten, dass jeder Server nur Dokumente seiner Sprachen bekommt, auch nach einem Neustart.

## Ausserhalb des Umfangs

- Eine Meldung an typescript-go, dass der Server bei einer unbekannten Dateiart abstürzt statt abzulehnen. Sie ginge nur mit Zustimmung des Nutzers hinaus.
- Der Vorschlag aus Ticket 30 zu `didChangeWatchedFiles` und zum Filtern nach Endungen. Den hat der Nutzer verworfen.

## Akzeptanzkriterien

- [ ] Die Ursache steht mit Beleg im Ticket, also mit dem Test und seiner Gegenprobe.
- [ ] Ein schneller Test mit nachgemachtem Server prüft:
  - Ist eine `.java`-Datei offen und startet danach der TypeScript-Server, bekommt er nur die JavaScript- und TypeScript-Dateien, auch nach einem Neustart.
  - Umgekehrt bekommt der Java-Server keine `.js`/`.jsx`/`.ts`-Dateien.
  - Ohne die Behebung ist der Test rot.
- [ ] Ein langsamer Test mit dem echten nativen Server prüft: Mit offener `.java`-Datei und danach geöffneter `.jsx`-Datei stürzt er nicht ab, es erscheint keine Meldung „stopped“, und das Protokoll der Sprachserver bleibt leer. Ohne die Behebung ist er rot (Panic „ScriptKind must be specified“).
- [ ] Die übrigen Stellen sind geprüft und das Ergebnis steht im Ticket.
- [ ] `npm run typecheck`, `npm test`, `npm run test:slow` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Im Java-Projekt des Nutzers: Java-Dateien offen, dann eine `.jsx`- bzw. `.js`-Datei öffnen. Der TypeScript-Server bleibt stabil, die Sprachfunktionen in der `.jsx`-Datei gehen.
- [ ] Auch nach „Restart“ des TypeScript-Servers mit offenen Java-Dateien bleibt er stabil.

## Hinweise

- **Spielregeln:**
  - Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt.
  - Keine echten Eingaben an den Desktop.
  - Keine Messungen oder Proben mit Tausenden Dateien auf der Platte ohne Rückfrage.
- **Datenschutz:** Pfade, Namen und Inhalte aus dem Projekt des Nutzers gehören nicht in Commits, Tickets oder Tests; das Protokoll oben ist entsprechend gekürzt. Das Testprojekt erfindet der Agent selbst.
- **Vorrang:** Der Fehler trifft den Nutzer im Alltag. Dieses Ticket sollte vor den Tickets 33 bis 35 umgesetzt werden.
