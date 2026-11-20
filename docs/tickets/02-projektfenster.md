# 02 – Projektfenster, Willkommensfenster, Beenden und Wiederöffnen

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 01
User Stories: 1–5, 8–10, 13 (nur Fensterposition und -grösse), 14
Spezifikation: „Fenster, Projekte und gespeicherter Zustand“, „Präzisierungen beim Schreiben“ Punkt 16

## Was gebaut wird

- **Willkommensfenster:**
  - Liste der zuletzt geöffneten Projekte (die letzten 20, neueste zuerst) und „Open Folder“. Der Platz für „Clone Repository“ ist vorgesehen, der Knopf kommt mit Ticket 10.
  - Lage und Grösse im App-Zustand.
  - Öffnet der Nutzer daraus ein Projekt, schliesst es sich, ohne dass Codium sich beendet.
- **Projektfenster:** „Open Folder“ öffnet über die Ordnerauswahl ein Projekt in einem neuen Fenster mit eigenem Projekt-Kern. Der Inhalt ist vorerst ein Platzhalter mit dem Projektnamen; das Layout folgt in Ticket 03. Fenstertitel „Projektname – Codium“.
- **Ein Projekt nur einmal:** Ist das Projekt schon offen, kommt sein Fenster nach vorne, statt ein zweites zu öffnen.
- **Einzelinstanz:** Ein zweiter Start von Codium holt das zuletzt benutzte Fenster nach vorne.
- **Beenden:**
  - Ein Befehl „Exit“ im Vertrag beendet Codium mit allen offenen Projekten; sie gelten als „beim Beenden offen“. Der Menüeintrag dafür kommt mit Ticket 03.
  - Das Abmelden oder Herunterfahren von Windows wirkt wie „Exit“.
  - Schliesst der Nutzer das letzte Projektfenster, beendet sich Codium; dieses Projekt gilt als offen.
  - Ein Fenster, das geschlossen wurde, während andere offen waren, gilt nicht als offen.
  - Das Willkommensfenster als einziges Fenster schliessen beendet Codium.
- **Wiederöffnen:** Beim Start öffnen sich die Projekte, die beim Beenden offen waren. Fehlt ein Projektordner, erscheint ein Hinweis (vorerst schlicht, die Meldungen kommen mit Ticket 03), und das Projekt wird übersprungen. Bleibt keines übrig, erscheint das Willkommensfenster.
- **Zuletzt geöffnete Projekte:** Ein Eintrag, dessen Ordner fehlt, zeigt beim Anklicken eine Meldung und lässt sich entfernen.
- **Fensterlage** pro Projekt im Projekt-Zustand, beim Wiederöffnen angewendet. Liegt sie auf einem nicht mehr angeschlossenen Bildschirm, kommt das Fenster auf den Hauptbildschirm.

## Akzeptanzkriterien

- [ ] Kern-Tests (Teststelle 1):
  - Öffnen eines Projekts erzeugt ein Fenster und einen Projekt-Kern; aus dem Willkommensfenster heraus schliesst sich dieses.
  - Erneutes Öffnen desselben Projekts, auch mit anderer Schreibweise des Pfads, holt das vorhandene Fenster nach vorne.
  - Ein simulierter zweiter Start holt das zuletzt benutzte Fenster nach vorne.
  - „Exit“ mit zwei offenen Projekten → nach einem simulierten Neustart sind beide offen. Gleiches für das Abmelden von Windows.
  - Letztes Fenster schliessen → dieses Projekt ist nach dem Neustart offen; ein vorher einzeln geschlossenes nicht.
  - Fehlender Projektordner beim Start → Hinweis, Projekt übersprungen; ohne offene Projekte erscheint das Willkommensfenster.
  - Die Liste der zuletzt geöffneten Projekte ist auf 20 begrenzt, neueste zuerst, ohne Doppelungen. Ein Eintrag mit fehlendem Ordner lässt sich entfernen.
  - Lage von Projektfenstern und Willkommensfenster übersteht einen Neustart; eine Lage auf einem fehlenden Bildschirm wird auf den Hauptbildschirm verschoben.
- [ ] Playwright-Tests (Teststelle 2):
  - Das Willkommensfenster erscheint. „Open Folder“ mit `CODIUM_TEST_PICK_DIR` öffnet ein Projektfenster mit dem richtigen Titel.
  - Zwei Projekte öffnen, das erste erneut öffnen → kein drittes Fenster, die Aufzeichnung meldet „nach vorne geholt“.

## Abnahme von Hand

- [ ] Zwei Projekte öffnen, „Exit“, neu starten: Beide Fenster sind wieder da, an ihrer Position.
- [ ] Ein offenes Projekt nochmals über „Open Folder“ wählen: Das vorhandene Fenster kommt wirklich nach vorne.
- [ ] Codium ein zweites Mal starten: Das zuletzt benutzte Fenster kommt nach vorne.
- [ ] Ein Projektfenster maximieren, schliessen bzw. „Exit“, neu starten: Es öffnet maximiert, „Wiederherstellen“ führt zur alten Lage.
- [ ] Ein Projektfenster minimieren (einmal aus maximiertem, einmal aus normalem Zustand) und Codium über die Taskleiste schliessen: Beim Neustart stimmen Lage und Maximiert-Zustand.
- [ ] Ein Fenster auf einen zweiten Bildschirm schieben, „Exit“, den Bildschirm abziehen, neu starten: Das Fenster liegt zentriert auf dem Hauptbildschirm.
- [ ] Das Willkommensfenster verschieben und in der Grösse ändern, schliessen, neu starten: Es erscheint an derselben Stelle.
- [ ] Einen Projektordner umbenennen, während Codium beendet ist, dann starten: Hinweis „Project folder not found“, die übrigen Projekte öffnen.
- [ ] Mit zwei offenen Projekten von Windows abmelden, wieder anmelden, Codium starten: Beide Projekte sind offen.
- [ ] Ein zuletzt geöffnetes Projekt löschen und im Willkommensfenster anklicken: Es erscheint ein Hinweis, „Remove from List“ entfernt den Eintrag.
- [ ] Ein weiteres Projekt ohne gespeicherte Lage öffnen: Es öffnet um etwa 30 px versetzt zum zuletzt benutzten Projektfenster.
- [ ] Das letzte Fenster schliessen und Codium sofort wieder starten: Codium startet nach dem Beenden neu, statt still wegzubleiben.

Bis Ticket 03 laufen „Exit“ und „Open Folder“ im Projektfenster über die Knöpfe der vorläufigen Leiste im Platzhalter.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-20. Kein schwerer Befund; Akzeptanzkriterien, die Regeln zum Beenden und die Wettläufe beim Öffnen und Abbauen sind in Ordnung. Eingearbeitet:

- **Zweiter Start während des Beendens:** Bisher ging er verloren, weil die alte Instanz die Einzelinstanz-Sperre bis zum Ende ihres Abbaus hält. Jetzt merkt der Kern einen Neustart vor; der Port „Fenster“ beendet die App mit `relaunch` (Electron `app.relaunch`), und Codium startet nach dem Abbau neu. Ein Kern-Test deckt das ab.
- **Keine synchronen Dateiabfragen mehr im Kern:**
  - Existenz und echter Pfad eines Projektordners werden asynchron mit einem Zeitlimit von 2 s abgefragt. Danach gilt der Ordner als nicht erreichbar.
  - Mehrere Ordner (beim Start, in der Liste der zuletzt geöffneten) werden gleichzeitig geprüft, ein nicht erreichbares Netzlaufwerk kostet so nur einmal das Zeitlimit.
  - Pfade werden ohne Dateizugriff verglichen, über einen Zwischenspeicher der schon aufgelösten echten Schlüssel. Die zuletzt geöffneten Projekte werden beim Start im Hintergrund aufgelöst, damit auch Kurznamen und Junctions erkannt werden.
  - Tests simulieren einen Ordner, der nie antwortet.
- **Absolute Pfade:** `app.openProject` und `app.removeRecentProject` lehnen relative Pfade mit `INVALID_PARAMS` ab; sie hingen sonst vom Arbeitsordner des Hauptprozesses ab.
- **Fehlercodes:** Alle Codes, die die Oberfläche sehen kann, stehen in `ErrorCode` (auch `UNKNOWN_COMMAND` und `NO_PROJECT`), ihre Meldungen sind englisch. Für Fehler ohne bekannten Code zeigt die Oberfläche einen allgemeinen Text und schreibt die Einzelheiten in die Konsole der Seite (`src/renderer/errors.ts`). Die betroffenen Tests aus Ticket 01 sind angepasst.
- **Maximiert-Zustand:** Ein noch nicht gezeigtes oder minimiertes Fenster meldet „nicht maximiert“; dann gilt der gemerkte Zustand.
- **Port „Fenster“ schmaler:** `setBounds` ist gestrichen, `getBounds` durch `isOpen` ersetzt. Der Kommentar zu `quit` sagt jetzt richtig, dass `AppCore.quit` den Abbau selbst startet.
- **Prüfliste „Abnahme von Hand“** ergänzt (oben).
- **Schutztest für alle Fenster:** Die Starthilfe der Playwright-Tests prüft beim Schliessen jedes offene Fenster (ausserhalb aller Bildschirme, ohne Fokus); jeder Oberflächentest erbt das.
- **Versatz neuer Projektfenster:** Ohne gespeicherte Lage öffnet ein Projektfenster um 30 px versetzt zum zuletzt benutzten Projektfenster, in dessen Grösse und Maximiert-Zustand. Ragte es aus dem Arbeitsbereich, beginnt es oben links. Im Testmodus melden Fenster keine Lage, also gibt es dort keinen Versatz.
- **Hinweis für Ticket 03:** Die Oberflächentests klicken die vorläufige Leiste und müssen aufs Projektmenü umgestellt werden (dort unter „Hinweise“).

Bewusst so geblieben:

- **Fehlender oder nicht erreichbarer Projektordner beim Start:** Das Projekt wird übersprungen und gemeldet, fällt aus den beim Beenden offenen Projekten und bleibt unter den zuletzt geöffneten. Ein Netzlaufwerk, das beim Start noch nicht verbunden ist (etwa weil das VPN erst danach steht), führt deshalb dazu, dass das Projekt beim nächsten Start nicht von selbst aufgeht; man öffnet es über die zuletzt geöffneten Projekte. Dafür bringt ein endgültig verschwundener Ordner nicht bei jedem Start erneut eine Meldung.
- **Interne Fehlermeldungen ohne Code** (etwa aus `openProjectCore`) bleiben deutsch. Sie sind für Entwickler gedacht und erreichen die Oberfläche nicht als Meldung.

Entscheidungen bei der Umsetzung, die Ticket und Spezifikation nicht vorgeben:

- **Maximiert-Zustand** gehört zur gespeicherten Fensterlage (`WindowPlacement { bounds, maximized }`, nach dem Vorbild THub), sonst käme ein maximiertes Fenster nicht „an seiner Position“ zurück. Das Feld `windowBounds` aus Ticket 01 heisst deshalb `window`; geschrieben wurde es bisher nie. Im Testmodus wird nie maximiert.
- **Vorläufige Leiste im Platzhalter** mit „Open Folder“, „Exit“ und den zuletzt geöffneten Projekten, als Ersatz für das Projektmenü aus Ticket 03. Ohne sie liesse sich vor Ticket 03 kein zweites Projekt öffnen, und Playwright hätte keinen Klickweg.
- **Englische Meldungen:** Meldungen des Kerns, die Nutzer sehen, sind englisch („Folder not found: …“, „Project folder not found: …“).
- **Port „Fenster“:** `placement` liefert die Lage zum Speichern (im Testmodus `null`), `quit` beendet die App (wahlweise mit Neustart), `onClosed` meldet die Lage samt Maximiert-Zustand. Der Titel der Seite überschreibt den Fenstertitel nicht (`page-title-updated` unterbunden).
- **Fenstergrössen ohne gespeicherte Lage:** Projektfenster 1280 × 800, Willkommensfenster 820 × 560, zentriert. Das Willkommensfenster heisst „Welcome to Codium“.
- **Zuletzt geöffnete Projekte:** Das Wiederöffnen beim Start ändert ihre Reihenfolge nicht; ein erneutes Öffnen eines offenen Projekts setzt es nach vorne.
- **Wer Codium beendet:** Nur das Willkommensfenster und Projektfenster beenden Codium beim Schliessen; `window-all-closed` im Hauptprozess bleibt als Absicherung.
