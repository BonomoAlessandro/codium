# 27 – Testwerkzeuge: Fokus, Aufräumen, wackelige Tests

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: keine; betrifft die Testläufe und die Spielregeln „Der Desktop des Nutzers ist tabu“ und „Aufräumen“
Spezifikation: „Testentscheidungen“ (Testmodus, die vier Testläufe)

Dieses Ticket kam nach den Tickets 24 bis 26 dazu, auf Wunsch des Nutzers. Bei deren Umsetzung am 2026-11-23 fielen an den Testwerkzeugen drei Dinge auf. Sie kosteten viel Zeit, und eines berührt den Desktop des Nutzers.

## Heutiger Stand

- **Fokus:** Die Starthilfe (`test/support/launchApp.ts`, `testModeViolations`) meldete beim Schliessen mehrmals „Testmodus verletzt: „…“ hat den Fokus“. Das kam dreimal unter Last vor und einmal auf einem ruhigen Rechner („Alpha – Codium“ im Test „öffnet die Suche auch mit Fokus im Terminal“). Verborgene Fenster liegen im Testmodus bei -32000/-32000, ohne Taskleiste, und werden mit `showInactive()` gezeigt (`src/main/electron/windowPort.ts`).
  - **Vermutung, nicht belegt:** Windows aktiviert ein solches Fenster, wenn ein anderes Fenster schliesst und es in der Reihenfolge der Fenster als nächstes kommt.
  - **Folge:** Tastatureingaben des Nutzers könnten dann für einen Moment in einem unsichtbaren Testfenster landen.
- **Liegengebliebene Prozesse und Ordner:** Läuft ein Test ins Zeitlimit, bleiben teils verborgene Codium-Instanzen (`electron.exe` aus `node_modules\electron\dist`, Elternprozess beendet) und Hilfsprozesse von embedded-postgres zurück (`postgres.exe --forkchild="io_worker" <pid>`, deren Hauptprozess schon weg ist).
  - Das Aufräumen in `stopApp` (15 s für `app.close()`, danach `killProcessTree`) und in `test/support/postgres.ts` greift dann nicht.
  - Temp-Ordner `codium-test-*` bleiben bei EPERM liegen; am 2026-11-23 waren es 35 Ordner mit 142 MB.
  - Die liegengebliebenen Prozesse halten zudem Dateien in `node_modules` fest, sodass ein späteres `npm ci` scheitert.
- **Wackelige Tests:** Auf einem ruhigen Rechner und in vollen Läufen gelegentlich rot, einzeln meist grün. Siehe auch `docs/offene-punkte.md`, „Wackelige Tests“.
  - UI „öffnet eine JDK-Klasse schreibgeschützt mit Quelltext; Ctrl + Linksklick geht darin weiter“ (`test/ui/java.test.ts`): Oft rot, auch auf dem Stand vor den Tickets 24 bis 26 (dort 0 von 4 grün). Der Cursor steht nach dem Sprung auf 1:1 oder mitten im Javadoc statt auf der Klassendeklaration, und in der Statusleiste steht oft noch „Searching…“. Monaco scrollt korrekt dorthin, wo der Sprachserver hinzeigt.
  - Schnell „lässt einen gelöschten Projektordner los …“ (`test/main/fileService.test.ts`): EPERM beim Löschen des überwachten Ordners, in vollen Läufen häufig.
  - Langsam „startet nach einem Absturz neu und gibt nach 3 Neustarts … auf“ (TypeScript-Server): Zeitüberschreitung bei der Definition nach dem Neustart.
  - Langsam „Gradle 8: Import mit dem Wrapper, Daemon mit passendem JDK, Definition“: Zeitlimit nach 342 s.
  - UI Markdown-Vorschau mit Mermaid: gelegentlich kein SVG innert der Wartezeit.
  - UI „speichert Eingaben der letzten Sekunde vor „Exit““ (`test/ui/save.test.ts`): einmal Zeitlimit beim Doppelklick.

## Was gebaut wird

- **Fokus:**
  - Ursache finden, ohne echte Eingaben an den Desktop und ohne fremde Fenster anzufassen; Code, Electron-Dokumentation und Versuche nur mit den eigenen Testfenstern.
  - Dann so beheben, dass ein Testfenster den Fokus von Windows nicht bekommen kann bzw. ihn nie hält. Beispiele, je nach Ursache: Testfenster nicht aktivierbar machen (etwa `focusable: false` bzw. `WS_EX_NOACTIVATE`) und sicherstellen, dass Fokus im Inneren der Seite für die Tests weiter funktioniert (Playwright-Eingaben, `:focus`, Fokus-Ereignisse).
  - Die strenge Prüfung in `testModeViolations` bleibt.
- **Aufräumen, auch nach Zeitüberschreitungen:**
  - **Wächter im Testmodus:** Die App kennt den Prozess, der sie gestartet hat (z. B. über eine Umgebungsvariable mit der PID des Testprozesses). Endet dieser, beendet sich die App binnen weniger Sekunden selbst, samt eigener Kindprozesse (Sprachserver, Shells). Ausserhalb des Testmodus ändert sich nichts.
  - **Test-PostgreSQL:** `stop` beendet alle Prozesse dieses Servers einschliesslich der Hilfsprozesse. Ein Test-Server, dessen Testprozess endet, hinterlässt keine verwaisten `postgres.exe`.
  - **Schlussprüfung je Testlauf** (globales Teardown in UI- und langsamem Lauf, wo sinnvoll auch im schnellen): Sie sucht verwaiste Prozesse aus diesem Checkout (Codium-Testinstanzen, `postgres.exe` aus `@embedded-postgres`, Sprachserver), deren Elternprozess nicht mehr läuft, und beendet sie mit deutlicher Meldung. Ebenso entfernt sie liegengebliebene `codium-test-*`-Ordner dieses Laufs, mit einigen Versuchen bei EPERM. Nie fasst sie Prozesse an, deren Elternprozess noch läuft, Prozesse aus anderen Ordnern oder das installierte Codium des Nutzers.
- **Wackelige Tests:**
  - Für jeden oben genannten Test die Ursache suchen und an der Ursache beheben, im Produkt oder im Test. Ein Zeitlimit wird nur erhöht, wenn die Ursache wirklich Dauer ist; das wird dann begründet.
  - Für den JDK-Klassen-Test zuerst klären, ob Codium falsch springt, etwa weil es dem Sprachserver zu früh glaubt oder einen Bereich falsch übernimmt. Ist es ein Fehler im Produkt, wird er behoben, und der Test prüft das richtige Ziel.
  - `docs/offene-punkte.md`, Abschnitt „Wackelige Tests“, nachführen: was behoben ist und was offen bleibt, mit Grund.

## Akzeptanzkriterien

- [ ] Die Ursache der Fokusmeldungen ist im Ticket beschrieben und behoben. Ein Test belegt den Mechanismus, z. B. dass Testfenster nicht aktivierbar sind und Fokus in der Seite trotzdem funktioniert. In den Läufen unten gibt es keine Fokusmeldung.
- [ ] Ein Test belegt den Wächter: Endet der startende Prozess, beendet sich eine Codium-Testinstanz samt Kindprozessen binnen weniger Sekunden.
- [ ] Ein Test belegt das Aufräumen des Test-PostgreSQL. Nach `stop` und nach dem Ende des Testprozesses laufen keine Prozesse dieses Servers mehr.
- [ ] Die Schlussprüfung meldet und beendet verwaiste Prozesse aus diesem Checkout und entfernt liegengebliebene Temp-Ordner des Laufs. Einheitstests prüfen die Auswahl: nur verwaiste, nur aus diesem Checkout, nie mit lebendem Elternprozess.
- [ ] Jeder der sechs genannten wackeligen Tests hat im Ticket eine Ursache und eine Behebung, oder eine begründete Einschätzung, warum er bleibt, samt Eintrag in `docs/offene-punkte.md`.
- [ ] Auf einem ruhigen Rechner laufen `npm test`, `npm run test:slow` und `npm run test:ui` je dreimal in Folge grün, `npm run test:packaged` einmal. Danach sind keine Prozesse und keine Temp-Ordner aus den Läufen übrig.

## Abnahme von Hand

- [ ] Während eines vollen UI-Laufs bleibt der Fokus durchgehend in einem Fenster des Nutzers (etwa einem Editor, in dem er tippt); keine Eingabe geht verloren.

## Hinweise

- Die Spielregeln gelten verschärft: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop, keine Fenster in den Vordergrund holen, keine Systemeinstellungen ändern. Zum Prüfen des Fokus nur eigene Testfenster und Prozesse verwenden.
- Die vollen Läufe laufen allein auf dem Rechner, nicht parallel zu anderen Testläufen.
