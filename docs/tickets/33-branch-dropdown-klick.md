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

- [x] Ein Playwright-Test im Testmodus prüft:
  - Die Maus ruht länger als 500 ms auf einer Branchzeile: Kein Untermenü geht auf.
  - Ein Klick auf die Zeile öffnet ihr Untermenü.
  - Ein Klick auf eine andere Branchzeile wechselt es bzw. verhält sich nach der gewählten Regel.
  - Überfahren einer anderen Zeile bei offenem Untermenü ändert nichts.
- [x] Die bestehenden Tests zum Branch-Menü bleiben grün oder sind sinngemäss angepasst, etwa wo ein Test bisher auf das Öffnen beim Überfahren baut. Die Tastatur mit Enter, Pfeil rechts und Pfeil links funktioniert weiter.
- [x] Ein Playwright-Test prüft das Schliessen bei einem Klick in den Editor, in den Dateibaum und in ein Werkzeugfenster.
  - Der Klick in den Editor setzt zusätzlich den Cursor, er wird also nicht verschluckt.
- [x] Ein Test prüft das Schliessen bei einem Klick auf die Zieh-Fläche der Kopfzeile und bei Fokusverlust des Fensters.
  - Lässt sich die echte Lage im Testmodus nicht herbeiführen, prüft der Test den gewählten Mechanismus, etwa: Die Kopfzeile ist bei offenem Dropdown nicht ziehbar, oder ein `blur` des Fensters schliesst. Der Fall kommt dann zusätzlich in die Abnahme von Hand.
- [x] Haben andere Popups der Kopfzeile dieselbe Lücke gezeigt: je ein Test, dass auch sie schliessen.
- [x] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Fährt die Maus über die Branches, geht kein Untermenü auf. Erst ein Klick auf einen Branch zeigt „Checkout“ usw.
- [ ] Ein Klick irgendwo ausserhalb des Dropdowns schliesst es. Das gilt auch für die leere Fläche der Kopfzeile, für den Editor (der Cursor landet dort) und für das Terminal.
- [ ] Ein Klick auf den Desktop oder in ein anderes Programm schliesst das Dropdown ebenfalls.
- [ ] Bei offenem Dropdown, Projektmenü, Rechtsklick-Menü oder Suchfenster schliesst der erste Klick auf die leere Kopfzeile das Popup, ohne das Fenster zu verschieben; danach lässt sich das Fenster wie gewohnt ziehen. (ergänzt bei der Umsetzung)
- [ ] Maximieren über den Fensterknopf oder Ziehen am Fensterrand schliesst ein offenes Dropdown. (ergänzt bei der Umsetzung)

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop.
- **Zieh-Fläche:** Klicks auf `-webkit-app-region: drag` erreichen die Seite unter Windows nicht; Playwright schickt Ereignisse über die Entwicklerwerkzeuge dagegen direkt an die Seite. Ein Test kann den echten Fall dort also womöglich nicht nachstellen. Mögliche Wege:
  - Solange das Dropdown offen ist, ist die Kopfzeile `no-drag`, so wie es VS Code bei offenen Menüs macht.
  - Oder der Hauptprozess meldet den Beginn des Ziehens bzw. den Fokusverlust des Fensters (`blur`).
- **Fenster im Testmodus** sind nicht aktivierbar (Ticket 27). Fokus und `blur` lassen sich dort nicht echt auslösen, sondern nur nachstellen.
- **Testläufe:** Messungen oder Proben mit Tausenden Dateien auf der Platte laufen nur nach Rückfrage (Spielregeln).

## Umsetzung (Agent, 2026-11-27)

- **Befund** (gemessen am Stand vor der Änderung mit einem Wegwerftest; das Testfenster wurde dabei nur lesend über `WM_NCHITTEST` gefragt, was an einem Punkt liegt, also ob Windows einen echten Klick dort an die Seite gibt):
  - **Zieh-Fläche der Kopfzeile:** Bei offenem Dropdown meldete das Fenster auf der leeren Kopfzeile `HTCAPTION`. Windows behandelt einen echten Klick dort als Klick auf die Titelleiste: Die Seite bekommt kein `pointerdown`, und weil das Fenster dabei den Fokus behält, auch kein `blur`. Das Dropdown blieb offen, beim Ziehen auch während das Fenster wanderte. Die Vermutung im Ticket stimmt also.
  - **Dieselbe Lücke** hatten das Projektmenü (gemessen: `HTCAPTION`), alle übrigen Menüs (Rechtsklick- und Tab-Menüs, gleicher Code) und die Suchfenster (gemessen bei „Recent Files“: `HTCAPTION`). Deren Hintergrund über dem ganzen Fenster hat keine eigene `-webkit-app-region`; über der Kopfzeile gewinnt deshalb die Zieh-Fläche. Ebenso das Popup eines Änderungsblocks (Ticket 17; nicht gemessen, gleicher Mechanismus).
  - **Fokusverlust** (Klick auf den Desktop, in ein anderes Programm, Alt + Tab, Minimieren): Das Branch-Dropdown hörte nicht auf das `blur` des Fensters und blieb offen (nachgestellt). Die Menüs samt Projektmenü schlossen dabei schon (`Menu.tsx`).
  - **Fensterrand und Fensterknöpfe** (Grösse ziehen, Maximieren, Wiederherstellen) sind ebenfalls keine Fläche der Seite. Die Menüs schlossen bei `resize`; das Branch-Dropdown bemass sich nur neu und blieb offen (nachgestellt mit `setSize`).
  - **Kein Problem** waren Editor, Dateibaum, Werkzeugfenster, Terminal, Statusleiste und Markdown-Vorschau: Das `pointerdown` mit Capture am Fenster erreicht das Dropdown vor jedem anderen Empfänger. Terminal (xterm.js) und Markdown-Vorschau liegen im DOM der Seite; iframes gibt es keine (die Vorschau verbietet sie beim Bereinigen). Der neue UI-Test zu diesen Fällen war schon am alten Stand grün.
- **Untermenü nur per Klick:**
  - Das Untermenü einer Branchzeile geht nur noch per Klick, Enter oder Pfeil rechts auf. `HOVER_DELAY_MS`, `hoverTimer`, `cancelHover` und die Art `'hover'` sind weg, ebenso die Eigenschaft `takeFocus` von `Menu`: Nur das Überfahren hatte sie gebraucht, damit der Fokus im Suchfeld blieb. Ein per Klick geöffnetes Untermenü nimmt den Fokus wie bisher; ein darin getipptes Zeichen schliesst es und geht ins Suchfeld.
  - Überfahren hebt nur die Zeile unter der Maus hervor. Es öffnet, wechselt und schliesst kein Untermenü, auch nicht über Aktionen oder Ordnern (bisher schloss das Überfahren einer solchen Zeile ein offenes Untermenü).
  - **Entscheid, Klick auf die Zeile des offenen Untermenüs:** Er schliesst es, wie im Ticket vorgeschlagen. So schalten auch der Branch-Knopf das Dropdown und ein Klick einen Ordner um, und wer ein Untermenü versehentlich geöffnet hat, schliesst es mit einem zweiten Klick an derselben Stelle, ohne zu Escape oder zu einem Klick daneben zu wechseln. Das Dropdown bleibt dabei offen, der Fokus geht ins Suchfeld. Ein Klick auf eine andere Branchzeile öffnet deren Untermenü an seiner Stelle. Der zweite Klick eines Doppelklicks lässt das Untermenü offen (seit dem Review): Wer aus Gewohnheit doppelt klickt, sähe es sonst nur aufblitzen. Klicks per Tastatur zählen als einfache Klicks.
- **Gemeinsame Stelle** `src/renderer/popup/dismiss.ts`:
  - `useDismiss(isInside, onDismiss)` schliesst bei `pointerdown` mit Capture ausserhalb, bei `blur` und bei `resize` des Fensters (Gründe `outside`, `blur`, `resize`). Ihn nutzen `Menu.tsx` (damit Projektmenü, Rechtsklick- und Tab-Menüs und das Untermenü im Dropdown) und `BranchPopup.tsx`.
  - **Kopfzeile ohne Zieh-Fläche:** Solange ein Popup offen ist, trägt das Wurzelelement die Klasse `popup-open`, und `app.css` setzt `.popup-open .header { -webkit-app-region: no-drag }`. Ein Klick auf die leere Kopfzeile geht so an die Seite und schliesst das Popup über das gewöhnliche `pointerdown`. Die Sperre ist gezählt (`holdHeaderNoDrag`), weil Popups übereinander liegen (Untermenü im Dropdown); erst das letzte gibt die Zieh-Fläche zurück. `useDismiss` hält sie selbst. Suchfenster (`QuickPopup.tsx`) und Popup eines Änderungsblocks (`EditorArea.tsx`) erkennen den Klick daneben schon selbst (Hintergrund bzw. `mousedown`) und nehmen nur die Sperre (`useHeaderNoDrag`).
  - **Der Klick wird nicht verschluckt:** Das Popup schliesst im Capture ohne `preventDefault`; der Klick geht weiter an sein Ziel (Cursor im Editor, Auswahl im Baum, Link in der Vorschau, Fokus im Terminal). Ausnahme bleibt der Branch-Knopf: Er zählt zum Dropdown, sein Klick schliesst nur.
- **Entscheid, Ziehen bei offenem Dropdown:** Solange ein Popup offen ist, verschiebt der erste Klick auf die Kopfzeile das Fenster nicht; er schliesst nur, erst der nächste zieht (ebenso der Doppelklick zum Maximieren). So macht es VS Code bei offenem Menü (es blendet seine Zieh-Fläche aus). Verworfen wurde, den Klick auf die Titelleiste im Hauptprozess abzufangen (`hookWindowMessage` mit `WM_NCLBUTTONDOWN`) und das Dropdown über den Vertrag zu schliessen, damit schon der erste Klick zieht: Das wäre ein Weg durch Hauptprozess, Vertrag und Ereignis, nur für Windows, und er liesse sich im Testmodus nicht prüfen, weil dafür ein echter Klick nötig ist. Die gewählte Lösung lässt sich prüfen: Das Fenster selbst meldet bei offenem Popup auf der Kopfzeile `HTCLIENT`.
- **Entscheid, Fokusverlust und Grössenänderung:** Das Branch-Dropdown schliesst jetzt wie die Menüs auch bei `blur` und `resize`. `resize` deckt Fensterrand und Fensterknöpfe ab, deren Klicks die Seite nie erreichen (Minimieren kommt als `blur`). Damit entfällt das neu Bemessen nach dem Verkleinern des Fensters aus Ticket 31 (`fit(reset)`); die Breite wächst weiter nur beim Aufklappen. Danach geht der Fokus an den Branch-Knopf, wie nach Escape. `focus()` aktiviert ein inaktives Fenster nicht; der Fokus liegt also dort, wenn der Nutzer zurückkommt.
- **Nicht geändert:** Suchfenster und Popup eines Änderungsblocks schliessen weiter nicht bei Fokusverlust (nicht verlangt; in `docs/offene-punkte.md` vermerkt). Untermenüs in anderen Menüs öffnen weiter beim Überfahren (ausserhalb des Umfangs).
- **Dokumente:** Spezifikation „Oberfläche“ (Kopfzeile, neuer Punkt „Popups“), „Git“ (Branch-Menü: Untermenü, Schliessen) und die Teststellen. `docs/abnahme.md`: Der Punkt aus Ticket 25 nennt das Untermenü per Klick; sein Punkt zur leeren Kopfzeile geht in den neuen Punkten auf. `docs/offene-punkte.md`: bekannte Grenzen.
- **Geänderte Dateien:** `src/renderer/popup/dismiss.ts` (neu), `src/renderer/popup/Menu.tsx`, `src/renderer/git/BranchPopup.tsx`, `src/renderer/project/ProjectWindow.tsx` (Fokus nach `blur` und `resize`), `src/renderer/search/QuickPopup.tsx`, `src/renderer/editor/EditorArea.tsx`, `src/renderer/styles/app.css`; Tests und Dokumente wie hier beschrieben.
- **Tests:**
  - Schneller Lauf: `test/renderer/dismiss.test.ts` (3 Tests: Die Sperre gilt vom ersten bis zum letzten Popup, eine doppelte Freigabe zählt nicht, jedes Fenster zählt für sich).
  - UI-Lauf, neu `test/ui/branchDropdownClick.test.ts` (4 Tests):
    - Untermenü: Die Maus ruht 800 ms auf einer Branchzeile, es geht keines auf (die Zeile ist hervorgehoben, der Fokus bleibt im Suchfeld). Ein Klick öffnet es. Überfahren einer anderen Branchzeile und einer Aktion ändert nichts. Ein Klick auf eine andere Branchzeile wechselt, ein Klick auf die offene schliesst es. Ein Doppelklick öffnet es und lässt es offen, „Checkout“ darin gelingt.
    - Klick in den Editor (Dropdown zu, Cursor in Zeile 3, Fokus im Editor), in den Dateibaum (Datei gewählt), auf einen Link in der Markdown-Vorschau (Dropdown zu, Link in der Aufzeichnung des Testmodus) und ins Terminal (Dropdown zu, Fokus im Terminal).
    - Kopfzeile: geschlossen `drag` und auf der leeren Fläche `HTCAPTION`, auf dem Branch-Knopf `HTCLIENT`; offen `no-drag` und `HTCLIENT`. Ein Klick auf die leere Kopfzeile schliesst, der Fokus geht an den Branch-Knopf, danach wieder `drag` und `HTCAPTION`. `blur` am Fenster und eine Grössenänderung schliessen, der Fokus liegt danach auf dem Branch-Knopf. Ebenso bei offenem Untermenü, das den Fokus hat, dort auch für ein Tastenkürzel der App (Ctrl + T, Pull; es nimmt den Fokus nicht).
    - Projektmenü (`no-drag`, `HTCLIENT`, ein Klick auf die Kopfzeile schliesst, danach `HTCAPTION`), Rechtsklick-Menü im Baum und „Recent Files“ (je `no-drag`, ein Klick auf die Kopfzeile schliesst, danach `drag`).
  - **Abfrage beim Fenster:** `hitTest` in `test/support/nativeWindow.ts` schickt dem Testfenster `WM_NCHITTEST` (über `SendMessageTimeout`): keine Eingabe, keine Aktivierung, die Seite bekommt davon nichts mit. Klicks über die Entwicklerwerkzeuge umgehen die Zieh-Fläche und erreichen die Seite immer; erst diese Abfrage zeigt, was ein echter Klick täte. Die Punkte rechnet die Hilfe aus CSS-Pixeln über die Breite der Client-Fläche um, in einem Thread mit DPI-Bewusstsein „per Monitor“. Ohne das rechnete Windows die Koordinaten der PowerShell um (Bildschirm mit 150 %), und ein erster Entwurf mit den Bildpunkten aus Electron traf neben das Fenster.
  - **Fokusverlust** ist im Testmodus nicht echt auslösbar (Fenster nicht aktivierbar, Ticket 27); der Test prüft den gewählten Mechanismus mit einem `blur` am Fenster. Der echte Fall und der echte Klick auf die Kopfzeile bleiben in „Abnahme von Hand“.
  - Angepasst: `test/ui/branchDropdown.test.ts` öffnet das Untermenü per Klick statt durch Überfahren (der Fokus geht hinein, ein getipptes Zeichen schliesst es und geht ins Suchfeld). `test/ui/diff.test.ts`: Das Popup eines Änderungsblocks nimmt der Kopfzeile die Zieh-Fläche, ein Klick auf sie schliesst es. Die Tastatur (Enter, Pfeil rechts und links) prüfen `branchDropdown.test.ts` und `branchFolders.test.ts` unverändert.
  - **Gegenprobe:** Mit dem alten Stand (`git stash` der Änderungen unter `src/`, neu gebaut) waren 3 der 4 neuen UI-Tests rot: Überfahren öffnete das Untermenü; die Kopfzeile blieb bei offenem Dropdown und bei offenem Projektmenü `drag`. Der Test zu Editor, Baum, Vorschau und Terminal war grün (siehe Befund).
- **Testläufe** (2026-11-27, nacheinander und allein auf dem Rechner). typecheck und `npm test` liefen im Vordergrund; der UI-Lauf schrieb in eine Log-Datei, auf sein Ende wurde im Vordergrund aktiv gewartet. Im Ereignisprotokoll (Kernel-Power 506/507) lag kein Standby im UI-Lauf (letzter Standby endete 07:59:55, Lauf 14:23:41 bis 14:35:05).

  | Lauf | Ergebnis | Dauer |
  |---|---|---|
  | `npm run typecheck` | grün | wenige Sekunden |
  | `npm test` | 582 von 582 grün (62 Dateien) | 106 s |
  | `npm run test:ui` | 110 von 110 grün (30 Dateien) | 677 s |

  Keine Meldung der Schlussprüfung, danach keine Prozesse aus dem Checkout und keine `codium-*`-Ordner im Temp-Ordner. Das Vorlesen der gebauten App meldete `mermaid.js` mit 19,3 s (Virenscanner).

## Review

Ein zweiter Agent hat den Branch gegen Ticket, Spezifikation und Spielregeln geprüft. Eingearbeitet ist alles, verworfen nichts; die neuen Prüfungen wurden gegengeprüft (gegen den Stand vor dem Review rot, an der erwarteten Stelle).

- **Fokus nach dem Schliessen bei offenem Untermenü** (sollte behoben werden): Bei offenem Untermenü, das den Fokus hat, landete der Fokus nach Fokusverlust, Grössenänderung oder einem Tastenkürzel der App nicht auf dem Branch-Knopf, sondern im Nirgendwo (`document.body`). Ablauf: Das Dropdown schliesst zuerst, das Projektfenster legt den Fokus auf den Knopf; der Fokuswechsel verlässt das Untermenü, das sich deshalb mitten darin selbst schliesst und den Fokus ins Suchfeld gibt; Blink bricht den äusseren Wechsel zum Knopf ab, und das Suchfeld verschwindet mit dem Dropdown. Nachgestellt mit einem Test, der für alle drei Wege rot war („expected null to be 'Branch main'“). Behoben wie vorgeschlagen: Alle Wege, die das ganze Dropdown schliessen (Klick daneben, Fokusverlust, Grössenänderung, Tastenkürzel, Escape, Aktion), laufen über `close` in `BranchPopup.tsx`, das vorher `closing` setzt; ein dabei mitschliessendes Untermenü gibt den Fokus dann nicht ins Suchfeld. Test: `branchDropdownClick.test.ts` prüft bei offenem Untermenü nach `blur`, nach einer Grössenänderung und nach Ctrl + T, dass der Fokus auf dem Branch-Knopf liegt (weiche Prüfung, damit jeder Weg einzeln meldet), dazu nach einer Grössenänderung ohne Untermenü. Ein Tastenkürzel, das den Fokus selbst nimmt (etwa Alt + 1 auf ein sichtbares Werkzeugfenster), legt ihn weiterhin dorthin.
- **Doppelklick auf eine Branchzeile** öffnete das Untermenü und schloss es gleich wieder. Jetzt schaltet nur ein einfacher Klick um (`detail` höchstens 1; Klicks per Tastatur haben 0); der zweite Klick eines Doppelklicks lässt es offen. Bei der Entscheidung oben festgehalten; Test im ersten UI-Test (Doppelklick, nach 300 ms weiter offen, dann „Checkout“).
- **Wertebereich in `hitTest`:** `WM_NCHITTEST` trägt jede Koordinate in 16 Bit. Liegt ein Punkt ausserhalb, bricht die Abfrage jetzt mit einer Meldung ab, statt still daneben zu treffen. In den Läufen kam das nicht vor: Windows hält das Testfenster bei −32768 Bildpunkten fest (gemessen bei 150 %), die Punkte der Kopfzeile liegen also im Bereich.
- **Kleinigkeiten:** Der Kommentar „Was ein Tab ohne Editor zeigt …“ steht wieder über `TabNotice` statt über `ChangePopup`. Der Kommentar zu `.popup-open .header` in `app.css` nennt das Popup eines Änderungsblocks. Die doppelte Hilfe `headerRegion` und der Klick auf die leere Kopfzeile liegen jetzt in `test/support/header.ts` (genutzt von `branchDropdownClick.test.ts` und `diff.test.ts`).

Nicht eingearbeitet: nichts.

**Testläufe nach dem Review** (2026-11-27, nacheinander und allein auf dem Rechner). typecheck und `npm test` liefen im Vordergrund; der UI-Lauf schrieb in eine Log-Datei, auf sein Ende wurde aktiv gewartet. Im Ereignisprotokoll (Kernel-Power 506/507) lag kein Standby im UI-Lauf (letzter Standby endete 07:59:55, Lauf 15:03:49 bis 15:16:52).

| Lauf | Ergebnis | Dauer |
|---|---|---|
| `npm run typecheck` | grün | wenige Sekunden |
| `npm test` | 582 von 582 grün (62 Dateien) | 136 s |
| `npm run test:ui` | 110 von 110 grün (30 Dateien) | 777 s |

Keine Meldung der Schlussprüfung, danach keine Prozesse aus dem Checkout und keine `codium-*`-Ordner im Temp-Ordner. Das Vorlesen der gebauten App meldete `mermaid.js` mit 21,8 s (Virenscanner).
