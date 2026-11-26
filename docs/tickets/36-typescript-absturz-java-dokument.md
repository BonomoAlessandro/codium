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

- [x] Die Ursache steht mit Beleg im Ticket, also mit dem Test und seiner Gegenprobe.
- [x] Ein schneller Test mit nachgemachtem Server prüft:
  - Ist eine `.java`-Datei offen und startet danach der TypeScript-Server, bekommt er nur die JavaScript- und TypeScript-Dateien, auch nach einem Neustart.
  - Umgekehrt bekommt der Java-Server keine `.js`/`.jsx`/`.ts`-Dateien.
  - Ohne die Behebung ist der Test rot.
- [x] Ein langsamer Test mit dem echten nativen Server prüft: Mit offener `.java`-Datei und danach geöffneter `.jsx`-Datei stürzt er nicht ab, es erscheint keine Meldung „stopped“, und das Protokoll der Sprachserver bleibt leer. Ohne die Behebung ist er rot (Panic „ScriptKind must be specified“).
- [x] Die übrigen Stellen sind geprüft und das Ergebnis steht im Ticket.
- [x] `npm run typecheck`, `npm test`, `npm run test:slow` und `npm run test:ui` sind grün.

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

## Umsetzung (Agent, 2026-11-26)

**Vorweg:** Der Befund am Code stimmt. Ein Test mit dem echten nativen Server stellt den Absturz des Nutzers genau nach, mit derselben Panic und demselben Stack; mit der Behebung bleibt der Server stabil. Es war die einzige Stelle mit dieser Verwechslung.

### Ursache, belegt

- **Am Code:** `LanguageService.start` meldete nach `initialized` alle offenen Dokumente über `sendOpen`, und `sendOpen` prüfte nicht, ob ein Dokument zu diesem Server gehört (`doc.server`).
- **Langsamer Test mit dem echten Server** (`test/slow/typescript.test.ts`, „stürzt nicht ab, wenn beim Start eine Java-Datei offen ist …“):
  - Testprojekt „Shop“, selbst erfunden: `pom.xml`, `src/main/java/shop/Cart.java`, `src/main/webapp/App.jsx`; kein `package.json`, `tsconfig.json` oder `jsconfig.json` und kein eigenes TypeScript.
  - Erst `Cart.java` öffnen, dann `App.jsx`. Der mitgelieferte native Server 7.0.2 (`bundled-native`) startet mit der JSX-Datei.
  - **Gegenprobe ohne Behebung: rot.** Im Protokoll der Sprachserver standen vier Einträge innerhalb von 555 ms, alle mit „Exit: code 2“. Die ersten drei endeten mit „Restarting (restart 1 of 3 …)“ bis „(restart 3 of 3 …)“, der vierte mit „Not restarted: it stopped 4 times within three minutes.“ Jeder Eintrag zeigte auf stderr
    ```
    panic: ScriptKind must be specified when parsing source file: c:/…/Shop/src/main/java/shop/Cart.java [recovered, repanicked]
    ```
    mit demselben Stack wie beim Nutzer (`parser.go:292`, `parser.go:140`, `parsecache.go:34`, `compilerhost.go:100`, `fileloader.go:370`). Die Panic kommt aus den parallelen Parsern beim Aufbau des Programms (`filesparser.go`, `workgroup.go`), also von einer Goroutine ohne `recover`; deshalb endet der Prozess.
  - Mit Behebung: grün.
- **Schneller Test mit nachgemachten Servern** (`test/main/languageDocuments.test.ts`), **Gegenprobe ohne Behebung: beide Tests rot.**
  - Der TypeScript-Server bekam `Cart.java`, `Price.java`, `app.jsx`, `util.js`, `model.ts` statt nur `app.jsx`, `util.js`, `model.ts`.
  - Der Java-Server bekam `app.jsx`, `util.js`, `model.ts`, `Cart.java`, `Price.java` statt nur `Cart.java`, `Price.java`.

### Behebung

- **`sendOpen` prüft selbst,** dass das Dokument zum Server gehört (`doc.server === server.id`). So kann kein Weg einem Server ein fremdes Dokument melden. Der Start meldet weiter über `sendOpen`, also nur noch die Dokumente seiner Sprachen; die Kommentare dort und am Kopf des Dienstes sind nachgeführt.
- **Teststelle für den schnellen Lauf:** `BundledJava.testServer` (`javaServer.ts`) startet statt jdtls ein anderes Programm, hier den nachgemachten Server.
  - Ohne sie liesse sich jdtls nicht ersetzen: Codium startet immer `java.exe` des JDK mit Argumenten der JVM, und die versteht Node nicht.
  - Die App setzt das Feld nie. Der Dienst nimmt es erst, wenn der Ordner von jdtls und ein JDK ab 25 da sind, also unter denselben Bedingungen wie jdtls.
- **`fakeLspServer.ts`** schreibt bei `didOpen` den Namen des Dokuments mit.

### Geprüfte Stellen

Alle Stellen in `languageService.ts`, die über alle Dokumente laufen oder etwas an einen Server schicken:

| Stelle | Was sie schickt | Ergebnis |
|---|---|---|
| Start und Neustart (`start`, nach `initialized`) | alle offenen Dokumente | **die Verwechslung**; behoben über `sendOpen` |
| `didOpen` | `didOpen` an den Server der Datei (`serverIdOf`); hat er sie schon, `didChange` an denselben | richtig |
| Selbst geöffnete Dokumente (`connectionFor`, für Definition, Verwendungen, Implementierungen, Hover, Vervollständigung, semantische Token) | `didOpen` an den Server der Datei | richtig; im schnellen Test mit `Price.java` und `model.ts` abgedeckt |
| `didChange` | an `doc.server`, nur wenn er das Dokument offen hat (`sent`) | richtig |
| `didClose`, `closeImplicit` | `didClose` an `doc.server`, nur wenn er das Dokument offen hat | richtig |
| Ende eines Servers (`onExit`) | entfernt nur die selbst geöffneten Dokumente dieses Servers | richtig |
| `restart` („Restart“, anderes JDK) | startet nur mit Kennzeichen oder offenem Dokument dieser Sprache | richtig |
| Fehler (`scheduleAllDiagnostics`, `scheduleDiagnostics`, `pullDiagnostics`, auch nach `workspace/diagnostic/refresh`) | läuft über alle Dokumente, fragt aber jedes bei `doc.server` | richtig |
| Semantische Token | Legende und Anfrage beim Server der Datei | richtig |
| Details eines Vorschlags (`resolveCompletion`) | an den Server der letzten Vervollständigung | richtig |
| Klasseninhalte (`readTarget`) | `jdt://` nur an jdtls | richtig |
| Symbolsuche | `workspace/symbol` an alle laufenden Server, ohne Dokument | so gewollt (Spezifikation: über alle Sprachserver) |
| Dateiänderungen (`notifyWatched`, `pendingWatched`) | `workspace/didChangeWatchedFiles` mit allen Änderungen an alle laufenden Server, ohne Filter nach Endung | so gewollt (Spezifikation). Das sind keine Dokumente: Der Server liest daraus nur Dateien seines Programms. In Ticket 30 hielt der native Server Zehntausende solcher Änderungen aus, auch an Dateien fremder Art. Einen Filter nach Endungen hat der Nutzer verworfen. |
| Eingehende Fehler (`publishDiagnostics`, vom Server an Codium) | – | Codium nimmt sie von jedem Server zu jeder Datei an. Da kein Server mehr fremde Dokumente bekommt, kommen auch keine Fehler aus der falschen Sprache. Bewusst nicht gefiltert. |

### Tests

- **Schnell, `test/main/languageDocuments.test.ts`:** Zwei nachgemachte Server schreiben auf, welche Dokumente sie geöffnet bekommen, einer als TypeScript-Server (über ein TypeScript 5 im Projekt), einer statt jdtls.
  - **TypeScript-Server bei offenen Java-Dateien:** Wie beim Nutzer läuft der Java-Server schon (`pom.xml`). Offen sind `Cart.java` und, selbst geöffnet für eine Anfrage, `Price.java`; dann startet `app.jsx` den TypeScript-Server. Er bekommt `app.jsx`, `util.js` und das selbst geöffnete `model.ts`, nach einem Absturz und nach „Restart“ jeweils `app.jsx` und `util.js`, nie eine Java-Datei.
  - **Java-Server bei offenen JavaScript- und TypeScript-Dateien:** umgekehrt, ohne `pom.xml`; `Cart.java` startet den Java-Server. Er bekommt `Cart.java` und das selbst geöffnete `Price.java`, nach Absturz und „Restart“ nur `Cart.java`, nie eine `.js`-, `.jsx`- oder `.ts`-Datei.
- **Langsam, `test/slow/typescript.test.ts`:** wie oben unter „Ursache, belegt“. Geprüft werden nach dem Start, nach „Restart“ (die Java-Datei bleibt offen) und nach einem Absturz (der Test beendet den Server):
  - Hover und Definition in der JSX-Datei gehen;
  - der Server läuft 2,5 s danach noch mit derselben Prozessnummer;
  - keine Meldung „stopped“;
  - das Protokoll der Sprachserver bleibt leer, nach dem Absturz steht darin genau dessen Eintrag, ohne Panic.

  Den Typ-Zwischenspeicher des Servers (ATA) legt der Test über `LOCALAPPDATA` in seinen Temp-Ordner. `%LOCALAPPDATA%\Microsoft\TypeScript\7.0` blieb in den Einzelläufen und in den vollen Läufen unverändert (keine Datei neuer als vor dem ersten Lauf).

### Testläufe (2026-11-26, nacheinander und allein im Checkout)

| Lauf | Ergebnis | Dauer |
|---|---|---|
| `npm run typecheck` | grün | 3 s |
| `npm test` | 579 von 579 grün (61 Dateien) | 130 s |
| `npm run test:slow` | 41 von 41 grün (9 Dateien), nichts übersprungen | 204 s |
| `npm run test:ui` | 106 von 106 grün (29 Dateien) | 641 s mit Bau |

- Laut Ereignisprotokoll kein Standby während der Läufe; das letzte Kernel-Power-Ereignis lag vor allen Läufen. Kein anderer Testlauf im Checkout; auf dem Rechner liefen daneben nur Sprachserver von Editoren und ein Entwicklungsserver eines anderen Projekts.
- Danach: keine Prozesse aus dem Checkout, keine `codium-*`-Ordner im Temp-Ordner, keine Meldung der Schlussprüfung. Das Vorlesen der gebauten App meldete `mermaid.js` mit 18,1 s (Virenscanner).
