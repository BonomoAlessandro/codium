# 06 – Tab-Menü, Tastenbelegung und Schriftgrösse

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 05
User Stories: 21 (in der zentralen Belegung), 39–42, 46 (Ctrl + Mausrad), 48–51
Spezifikation: „Oberfläche“ (Tastenkürzel, Schrift), „Editor, Tabs und Speichern“ (Tabs, Ctrl + Tab), „Präzisierungen beim Schreiben“ Punkte 9, 26, 30

## Was gebaut wird

- **Zentrale Tastenbelegung** der Oberfläche:
  - Eine Tabelle aller App-Kürzel, die Vorrang vor Monaco hat. Die Alt-Kürzel aus Ticket 03 ziehen hierher um.
  - Spätere Tickets tragen ihre Kürzel nur hier ein.
  - Kollidierende Monaco-Belegungen werden entfernt oder überschrieben: Ctrl + K (Auftakt für Zweierkürzel), Ctrl + Shift + K, Alt + F12, Ctrl + Y, Ctrl + D, Ctrl + W, Ctrl + R, Ctrl + G, Ctrl + E, Ctrl + B.
  - Für das Terminal (Ticket 11) liefert die Belegung die kurze Liste der Kürzel, die dort als IDE-Kürzel wirken: Alt + 1, Alt + 0, Alt + 3, Alt + 9, Alt + F12, Ctrl + Alt + S.
- **IntelliJ-Kürzel im Editor:**
  - Ctrl + F Suchen, Ctrl + R Ersetzen, Ctrl + G Zu Zeile
  - Ctrl + D Zeile duplizieren, Ctrl + Y Zeile löschen, Ctrl + / Auskommentieren
  - Ctrl + W Auswahl erweitern, Ctrl + Shift + W Auswahl verkleinern
  - Shift + Alt + Hoch/Runter Zeile verschieben
  - Ctrl + Z Rückgängig, Ctrl + Shift + Z Wiederholen
- **Tabs:**
  - Mittelklick schliesst.
  - Rechtsklick: „Close“, „Close Other Tabs“, „Close All Tabs“, „Close Tabs to the Right“, „Pin Tab“/„Unpin Tab“. Angeheftete Tabs stehen links und bleiben bei „Close All Tabs“ offen; die Anheftung wird im Projekt-Zustand gesichert.
  - Kein Limit; die Tableiste scrollt, ein Pfeil listet alle Tabs.
  - Ctrl + F4 schliesst den aktiven Tab.
  - Ctrl + Tab wechselt zum zuletzt benutzten Tab, wiederholt bei gehaltenem Ctrl weiter zurück.
- **Ctrl + Mausrad** ändert die Schriftgrösse aller Editoren über den Einstellungsspeicher aus Ticket 05.

## Akzeptanzkriterien

- [ ] Playwright-Tests mit Fokus im Editor:
  - Ctrl + D dupliziert und Ctrl + Y löscht eine Zeile.
  - Ctrl + W erweitert die Auswahl.
  - Ctrl + G springt zu einer Zeile.
  - Ctrl + R öffnet Ersetzen.
  - Alt + F12 öffnet das Werkzeugfenster „Terminal“ (Platzhalter) statt einer Monaco-Vorschau.
- [ ] Playwright-Tests für Tabs:
  - Mittelklick schliesst.
  - „Close Other Tabs“ und „Close All Tabs“ verschonen angeheftete Tabs; die Anheftung übersteht einen Neustart.
  - Ctrl + F4 schliesst den aktiven Tab, Ctrl + Tab wechselt zum vorher benutzten.
  - Bei vielen Tabs listet der Pfeil alle.
  - Ctrl + Mausrad (über das DevTools-Protokoll mit Ctrl-Modifikator) vergrössert die Schrift, und die Grösse übersteht einen Neustart.
- [ ] Ein Kern- oder Einheitstest prüft die zentrale Belegung: keine doppelt belegten Kürzel, alle kollidierenden Monaco-Belegungen aus der Liste sind entfernt.

## Abnahme von Hand

- [ ] Die Bearbeitungs-Kürzel fühlen sich an wie in IntelliJ.
- [ ] Viele Tabs: Die Tableiste scrollt flüssig.
