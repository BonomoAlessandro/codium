# 33 – Branch-Dropdown: Untermenü erst per Klick, Schliessen bei jedem Klick daneben

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: 94–96 (Branch-Menü)
Spezifikation: „Git“ (Branch-Menü), „Oberfläche“ (Kopfzeile)

Dieses Ticket kam nach Ticket 32 dazu, auf Wunsch des Nutzers. Er arbeitet mit dem Branch-Dropdown aus Ticket 31 und findet es „bereits viel besser“. Zwei Dinge stören ihn noch:
- Das Untermenü einer Branchzeile („Checkout“, „New Branch from …“ usw.) geht schon auf, wenn die Maus darüberfährt. Es soll erst erscheinen, wenn er auf die Zeile klickt.
- Das Dropdown soll verschwinden, wenn er irgendwo ausserhalb des Dropdowns klickt. Heute bleibt es in manchen Fällen offen.

## Heutiger Stand

- **Untermenü:**
  - `src/renderer/git/BranchPopup.tsx` öffnet das Untermenü einer Branchzeile auf vier Wegen: Enter, Pfeil rechts, Klick und Überfahren mit der Maus.
  - Beim Überfahren geht es nach 200 ms Ruhe auf (`HOVER_DELAY_MS`, Art `'hover'`); der Fokus bleibt dabei im Suchfeld.
  - Fährt die Maus auf eine andere Branchzeile, wechselt das Untermenü dorthin.
- **Schliessen:**
  - Escape schliesst.
  - Ausserdem schliesst ein `pointerdown` im Fenster ausserhalb von Dropdown, Branch-Knopf und Untermenü. Der Listener sitzt mit Capture an `window`, Grund `'outside'`.
  - Tastenkürzel der App schliessen das Dropdown über `registerOpenMenu`.
- **Was der Nutzer sieht:** Ein Klick ausserhalb schliesst das Dropdown nicht in allen Fällen. Welche Fälle es sind, ist nicht festgestellt. Vermutet:
  - **Zieh-Fläche der Kopfzeile:** Bereiche mit `-webkit-app-region: drag` liefern unter Windows keine Pointer-Ereignisse an die Seite, weil Windows den Klick als Klick auf die Titelleiste behandelt.
  - **Klick ausserhalb des Fensters** oder in ein anderes Programm: Codium verliert nur den Fokus, und darauf reagiert das Dropdown nicht.
  - **Eingebettete Inhalte**, die eigene Ereignisse haben, etwa ein iframe der Markdown-Vorschau oder das Terminal.

## Was gebaut wird

### Untermenü nur per Klick

- **Öffnen:** Das Untermenü einer Branchzeile geht nur noch auf:
  - per Klick auf die Zeile;
  - per Tastatur mit Enter oder Pfeil rechts, wie heute.
- **Überfahren:** Überfahren öffnet kein Untermenü mehr und wechselt auch kein offenes. Die Zeile unter der Maus darf weiter hervorgehoben werden, wie heute.
- **Klick auf eine Zeile bei offenem Untermenü:**
  - Ein Klick auf eine andere Branchzeile öffnet deren Untermenü an seiner Stelle.
  - Ein Klick auf die Zeile, deren Untermenü offen ist, schliesst es wieder.
  - Der Agent prüft, ob das so gut bedienbar ist, und begründet seine Wahl im Ticket.
- **Schliessen des Untermenüs:** Escape, Pfeil links, ein Klick daneben (siehe unten) und eine Aktion darin schliessen es wie heute.
- **Aufräumen:** Der Code für das verzögerte Öffnen beim Überfahren fällt weg: `HOVER_DELAY_MS`, `hoverTimer`, Art `'hover'`. Gemeint ist damit nicht die Hervorhebung beim Überfahren.

### Schliessen bei jedem Klick daneben

- **Erst klären:** Der Agent stellt fest, in welchen Fällen ein Klick ausserhalb das Dropdown heute nicht schliesst. Das Ergebnis kommt ins Ticket.
- **Danach schliesst das Dropdown samt Untermenü bei jedem Klick ausserhalb davon:**
  - überall im Projektfenster, also im Editor, im Dateibaum, in den Werkzeugfenstern, im Terminal, in der Statusleiste, in der Markdown-Vorschau und auf der Zieh-Fläche der Kopfzeile;
  - wenn Codium den Fokus verliert, etwa durch einen Klick auf den Desktop, in ein anderes Programm oder mit Alt + Tab, so wie IntelliJ seine Popups schliesst.
- **Der Klick selbst:** Er wirkt zusätzlich wie gewohnt, etwa als Cursor im Editor oder als Auswahl im Baum. Er wird nicht verschluckt.
  - Ausnahme ist der Branch-Knopf: Ein Klick darauf schliesst das offene Dropdown nur, wie heute.
  - Ein Klick auf die Zieh-Fläche der Kopfzeile schliesst; ob das Fenster dabei noch verschoben werden kann, entscheidet der Agent nach der gewählten Lösung und hält es fest.
- **Andere Popups der Kopfzeile:** Der Agent prüft das Projektmenü (Projektname mit Pfeil), die Menüs und die übrigen Dropdowns der Kopfzeile auf dieselbe Lücke. Haben sie sie auch, wird sie an einer gemeinsamen Stelle mitbehoben.
- **Spezifikation:** Beim Branch-Menü nachführen (Untermenü per Klick, Schliessen bei Klick daneben und bei Fokusverlust).

## Ausserhalb des Umfangs

- Weitere Änderungen am Inhalt des Dropdowns: Ordner, „Recent“, Aktionen.
- Untermenüs in anderen Menüs, etwa im Kontextmenü des Dateibaums. Dort bleibt das Öffnen beim Überfahren, wie in Menüs üblich.

## Akzeptanzkriterien

- [ ] Ein Playwright-Test im Testmodus prüft:
  - Die Maus ruht länger als 500 ms auf einer Branchzeile: Kein Untermenü geht auf.
  - Ein Klick auf die Zeile öffnet ihr Untermenü.
  - Ein Klick auf eine andere Branchzeile wechselt es bzw. verhält sich nach der gewählten Regel.
  - Überfahren einer anderen Zeile bei offenem Untermenü ändert nichts.
- [ ] Die bestehenden Tests zum Branch-Menü bleiben grün oder sind sinngemäss angepasst, etwa wo ein Test bisher auf das Öffnen beim Überfahren baut. Die Tastatur mit Enter, Pfeil rechts und Pfeil links funktioniert weiter.
- [ ] Ein Playwright-Test prüft das Schliessen bei einem Klick in den Editor, in den Dateibaum und in ein Werkzeugfenster.
  - Der Klick in den Editor setzt zusätzlich den Cursor, er wird also nicht verschluckt.
- [ ] Ein Test prüft das Schliessen bei einem Klick auf die Zieh-Fläche der Kopfzeile und bei Fokusverlust des Fensters.
  - Lässt sich die echte Lage im Testmodus nicht herbeiführen, prüft der Test den gewählten Mechanismus, etwa: Die Kopfzeile ist bei offenem Dropdown nicht ziehbar, oder ein `blur` des Fensters schliesst. Der Fall kommt dann zusätzlich in die Abnahme von Hand.
- [ ] Haben andere Popups der Kopfzeile dieselbe Lücke gezeigt: je ein Test, dass auch sie schliessen.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Fährt die Maus über die Branches, geht kein Untermenü auf. Erst ein Klick auf einen Branch zeigt „Checkout“ usw.
- [ ] Ein Klick irgendwo ausserhalb des Dropdowns schliesst es. Das gilt auch für die leere Fläche der Kopfzeile, für den Editor (der Cursor landet dort) und für das Terminal.
- [ ] Ein Klick auf den Desktop oder in ein anderes Programm schliesst das Dropdown ebenfalls.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop.
- **Zieh-Fläche:** Klicks auf `-webkit-app-region: drag` erreichen die Seite unter Windows nicht; Playwright schickt Ereignisse über die Entwicklerwerkzeuge dagegen direkt an die Seite. Ein Test kann den echten Fall dort also womöglich nicht nachstellen. Mögliche Wege:
  - Solange das Dropdown offen ist, ist die Kopfzeile `no-drag`, so wie es VS Code bei offenen Menüs macht.
  - Oder der Hauptprozess meldet den Beginn des Ziehens bzw. den Fokusverlust des Fensters (`blur`).
- **Fenster im Testmodus** sind nicht aktivierbar (Ticket 27). Fokus und `blur` lassen sich dort nicht echt auslösen, sondern nur nachstellen.
- **Testläufe:** Messungen oder Proben mit Tausenden Dateien auf der Platte laufen nur nach Rückfrage (Spielregeln).
