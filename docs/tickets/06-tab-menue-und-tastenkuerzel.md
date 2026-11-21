# 06 – Tab-Menü, Tastenbelegung und Schriftgrösse

Status: `erledigt` (2026-11-21, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Playwright-Tests mit Fokus im Editor:
  - Ctrl + D dupliziert und Ctrl + Y löscht eine Zeile.
  - Ctrl + W erweitert die Auswahl.
  - Ctrl + G springt zu einer Zeile.
  - Ctrl + R öffnet Ersetzen.
  - Alt + F12 öffnet das Werkzeugfenster „Terminal“ (Platzhalter) statt einer Monaco-Vorschau.
- [x] Playwright-Tests für Tabs:
  - Mittelklick schliesst.
  - „Close Other Tabs“ und „Close All Tabs“ verschonen angeheftete Tabs; die Anheftung übersteht einen Neustart.
  - Ctrl + F4 schliesst den aktiven Tab, Ctrl + Tab wechselt zum vorher benutzten.
  - Bei vielen Tabs listet der Pfeil alle.
  - Ctrl + Mausrad (über das DevTools-Protokoll mit Ctrl-Modifikator) vergrössert die Schrift, und die Grösse übersteht einen Neustart.
- [x] Ein Kern- oder Einheitstest prüft die zentrale Belegung: keine doppelt belegten Kürzel, alle kollidierenden Monaco-Belegungen aus der Liste sind entfernt.

## Abnahme von Hand

- [ ] Die Bearbeitungs-Kürzel fühlen sich an wie in IntelliJ.
- [ ] Viele Tabs: Die Tableiste scrollt flüssig.
- [ ] Schweizer Tastatur: Ctrl + Z ist Rückgängig (nicht „Zeile löschen“), Ctrl + Shift + 7 (also Ctrl + /) und Ctrl + Ziffernblock-/ kommentieren aus.
- [ ] Ctrl + Mausrad mit Maus und mit Touchpad: Die Schrift ändert sich in ruhigen Schritten, die Seite selbst zoomt nicht.
- [ ] Angeheftete Tabs zeigen die Stecknadel; ein Klick darauf löst den Tab.

## Umsetzung

- **Zentrale Tastenbelegung** in `src/renderer/keymap.ts`. Das Projektfenster wertet sie in der Capture-Phase vor Monaco aus; die Werkzeugfenster regelt es selbst, alles andere der Code-Bereich (`EditorArea.handleCommand`). Bearbeitungs-Kürzel lösen über `editor.trigger` Monacos Aktionen aus (`editor/editorActions.ts`). Kürzel späterer Tickets (Ctrl + K, Ctrl + Shift + K, Ctrl + T, Ctrl + E, Ctrl + B, Ctrl + Alt + S) sind schon eingetragen und werden im Editor geschluckt, damit Monaco sie nicht nimmt. `globalShortcuts()` liefert die Liste für das Terminal (Ticket 11).
- **Buchstaben zählen nach dem getippten Zeichen**, nicht nach der Lage: Auf der Schweizer Tastatur sind Y und Z vertauscht; nach der Lage wäre Ctrl + Z „Zeile löschen“. Ohne lateinisches Zeichen (etwa kyrillisch) zählt die Lage. Ziffern zählen weiter nach der Lage (Ticket 03).
- **Angeheftete Tabs** stehen links; der Projekt-Zustand speichert ihre Zahl am Anfang der Reihe (`pinnedTabs`), der Vertrag die Pfade (`EditorTabs.pinned`). Löschen und fehlende Dateien verringern die Zahl.
- **Tableiste** scrollt waagrecht (auch mit dem Mausrad) ohne sichtbare Bildlaufleiste; „Show All Tabs“ erscheint nur bei Überlauf. Dabei fiel auf, dass die Spalte des Projektfensters mit sehr vielen Tabs über das Fenster hinauswuchs; das Raster begrenzt sie jetzt (`minmax(0, 1fr)`).
- **Ctrl + Tab** ohne Umschaltfenster: Jeder Druck bei gehaltenem Ctrl geht einen Tab weiter in die Vergangenheit, Ctrl + Shift + Tab zurück; als zuletzt benutzt zählt der Tab erst beim Loslassen von Ctrl.
- **Tests:** Monaco ordnet seine Zeilen im DOM nicht immer in Textreihenfolge; die Oberflächentests lesen den Text deshalb nach der Lage der Zeilen.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-21. Vorrang vor Monaco, Bearbeitungs-Kürzel, Ctrl + Tab, Ctrl + F4, Mittelklick, Tab-Menü, angeheftete Tabs im Kern, Überlauf und die Grenzen der Schriftgrösse in Ordnung. Eingearbeitet:

- **Ctrl + D im Suchfeld** (nachgewiesen): Ohne Fokus im Text gingen Bearbeitungs-Kürzel an Monaco, Ctrl + D erzeugte dort Mehrfach-Cursor. Jetzt werden sie in Monacos Eingaben geschluckt; nur Rückgängig und Wiederholen gehören dort der Eingabe.
- **Ctrl + / auf Schweizer und deutscher Tastatur** (nachgewiesen): „/“ ist dort Shift + 7, das ergab „Ctrl+Shift+7“. Jetzt zählt „/“ als Zeichen, auch mit Shift.
- **Ctrl + Mausrad mit Touchpad** (nachgewiesen): Jedes kleine Rad-Ereignis war eine ganze Stufe. Jetzt werden die Schritte gesammelt; eine Stufe gibt es ab einer Mausraste.
- **AltGr-Zeichen als Kürzel** (nachgewiesen für die Tabelle): „ś“ (AltGr + S auf polnischer Tastatur) galt als Ctrl + Alt + S. Ein Zeichen mit Ctrl + Alt, das kein lateinischer Buchstabe ist, ist jetzt nie ein Kürzel.
- **Tests:** Ein Oberflächentest drückt Ctrl + Shift + K, Ctrl + K mit folgendem Buchstaben, Ctrl + E und Ctrl + B im Text und Ctrl + D im Suchfeld; einer prüft kleine Rad-Schritte. Beide scheitern gegen den Stand vor der Korrektur. Einheitstests für Ctrl + Shift + 7 und AltGr. Die schwachen Prüfungen (keine Vorschau bei Alt + F12, Seitenzoom) sind ersetzt bzw. entfallen.

Verworfen: nichts.
