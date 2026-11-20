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
