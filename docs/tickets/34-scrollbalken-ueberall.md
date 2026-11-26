# 34 – Scrollbalken in der ganzen App wie im Code-Bereich, 9 px breit

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: keine eigene; ergänzt 24 (dunkel im Stil des neuen IntelliJ)
Spezifikation: „Oberfläche“ (Design, Scrollbalken), Code-Farben (`src/renderer/editor/theme.ts`)

Dieses Ticket kam nach Ticket 32 dazu, auf Wunsch des Nutzers. Ticket 28 hat die Scrollbalken der Monaco-Editoren an IntelliJ angeglichen. Die übrigen Scrollbalken waren ausserhalb des Umfangs. Der Nutzer sagt nun: Der Scrollbalken im Projektbaum ist zu breit, und seine Farbe passt nicht. Auch der im Code-Bereich ist noch nicht ganz gut.

Er wünscht sich für beide dasselbe:
- die Farbe wie im Code-Bereich;
- die Breite der Kapsel, die der Code-Bereich beim Darüberfahren hat (9 px).

## Entscheidungen des Nutzers (2026-11-26)

Auf drei Rückfragen hat der Nutzer so geantwortet:

1. **Umfang:** alle Scrollbalken der App, nicht nur der Projektbaum („Alle Scrollbalken“).
2. **Breite:** Die Kapsel ist immer 9 px breit, in Ruhe wie beim Darüberfahren, auch im Code-Bereich („Immer 9 px“). Beim Darüberfahren wird sie nur heller, nicht breiter.
3. **Ausblenden:** Ausserhalb des Code-Bereichs bleiben die Scrollbalken sichtbar, solange es etwas zu scrollen gibt („Immer sichtbar“). Der Code-Bereich blendet die Kapsel weiter aus wie seit Ticket 28.

## Heutiger Stand

- **Code-Bereich und alle Monaco-Editoren** (Ticket 28, `EDITOR_SCROLLBAR` in `theme.ts`):
  - Rand 16 px: Greiffläche 10 px, 1 px Abstand, Streifen 5 px.
  - Kapsel 6 px in Ruhe, 9 px beim Darüberfahren und Ziehen; waagrecht 12 px.
  - Farben `#a6a6a647` in Ruhe, `#a6a6a659` beim Darüberfahren, `#a6a6a66b` beim Ziehen.
  - Die Kapsel blendet aus, wenn nicht gescrollt wird.
- **Alles ausserhalb von Monaco** hat den Standard-Scrollbalken von Chromium im dunklen Schema: 15 px breit, mit sichtbarer Spur, eckig und in Chromiums Grau. Laut Bericht zu Ticket 28 betrifft das:
  - den Dateibaum;
  - die Werkzeugfenster: Änderungsansicht, „Find“, Git-Log mit Graph und Dateiliste, Git-Konsole, Datenbank-Baum und Tabellen;
  - die Markdown-Vorschau;
  - die Suchfenster: „Go to File“, „Find in Files“, „Recent Files“, zweimal Shift;
  - das Branch-Dropdown, Menüs, Dialoge und Meldungen.
- **Sonderfälle:**
  - Das Terminal zeigt den Scrollbalken von xterm.js 6. Er ist gebaut wie der von VS Code: eckig, rund 14 px breit.
  - Die Datei-Tabs scrollen ohne sichtbaren Balken; die Terminal-Tabs nutzen `scrollbar-width: thin`.
  - Die Vorschlags- und Hover-Listen in Monaco haben eckige Schieber, aber schon die neuen Farben.

## Was gebaut wird

- **Ein Aussehen für alle Scrollbalken** der App, wie der Code-Bereich:
  - Kapsel, also ganz gerundet;
  - keine sichtbare Spur, kein Schatten;
  - Farben wie im Code-Bereich: in Ruhe, beim Darüberfahren und beim Ziehen.
- **Breite:** Die Kapsel ist überall 9 px breit, waagrecht 9 px hoch, in Ruhe wie beim Darüberfahren.
  - **Greiffläche:** Sie ist mindestens so gross wie die Kapsel und lässt sich gut treffen und ziehen.
  - **Rand des Code-Bereichs:** Bei 9 px in einer Greiffläche von 10 px liegen die Kanten auf halben Pixeln, wie das Review von Ticket 28 bemerkt hat. Der Agent darf die Greiffläche anpassen, etwa auf 11 px mit 1 px Rand je Seite. Er begründet das im Ticket. Der Streifen von 5 px für die Markierungen bleibt.
- **Verhalten:**
  - Im Code-Bereich und in den übrigen Monaco-Editoren blendet die Kapsel weiter aus, wenn nicht gescrollt wird. Nur die Breite ändert sich.
  - Überall sonst bleibt der Schieber sichtbar, solange es etwas zu scrollen gibt. Beim Darüberfahren wird er heller, beim Ziehen noch heller.
- **Wo:**
  - überall, wo die App scrollt: alle Orte aus „Heutiger Stand“;
  - das Terminal (xterm.js) und die Listen in Monacos Vorschlags- und Hover-Fenstern;
  - die Datei-Tabs dürfen ohne sichtbaren Balken bleiben. Bekommen die Terminal-Tabs einen sichtbaren Balken, gilt dort dasselbe Aussehen.
- **Eine Stelle für die Werte:**
  - Farben und Masse stehen an einer Stelle, die Monaco und CSS gemeinsam nutzen, etwa `EDITOR_SCROLLBAR` in `theme.ts` und Design-Variablen `--scrollbar-*` in `tokens.css`, die daraus gesetzt werden oder umgekehrt.
  - Die Regel für die Scrollbalken ausserhalb von Monaco steht einmal zentral in `app.css` und nicht je Liste.
- **Platz:** Die schmaleren Scrollbalken geben in den Listen Platz frei. Nichts darf dadurch springen oder abgeschnitten werden, etwa rechtsbündige Inhalte, Spalten der Datenbank-Tabellen oder der Graph im Git-Log.
- **Bilder zur Kontrolle:**
  - Der Agent nimmt Bilder des eingebauten Stands aus dem verborgenen Testfenster auf, nach der Spielregel zu Bildern: Seite `entwuerfe/34-scrollbalken/index.html`, nicht versioniert.
  - Zu sehen sind Code-Bereich, Projektbaum, ein Werkzeugfenster, Terminal und ein Suchfenster, jeweils in Ruhe und beim Darüberfahren.
  - Der Koordinator zeigt sie dem Nutzer vor dem Merge. Eine Freigabe ist nicht nötig; Rückmeldungen werden eingearbeitet.
- **Spezifikation:** Die Zeile zu den Scrollbalken unter „Oberfläche“, Design, nachführen. Die Abweichung von Ticket 28 (Kapsel in Ruhe 6 → 9 px) kommt mit Verweis auf dieses Ticket in Ticket 28 und in die Spezifikation.

## Ausserhalb des Umfangs

- Native Fenster von Windows, etwa die Ordnerauswahl, sowie Installer und Deinstallierer.
- Ein Schalter in den Einstellungen für die Breite oder das Ausblenden.

## Akzeptanzkriterien

- [ ] **Projektbaum:** Ein Playwright-Test im Testmodus prüft den Projektbaum mit so vielen Einträgen, dass er scrollt:
  - die Kapsel ist 9 px breit;
  - der Radius ist mindestens die halbe Breite;
  - keine sichtbare Spur;
  - die Farben in Ruhe und beim Darüberfahren;
  - der Schieber ist ohne Scrollen sichtbar;
  - Ziehen scrollt den Baum.
- [ ] **Code-Bereich:** Ein Playwright-Test prüft, dass die Kapsel in Ruhe (während des Scrollens) und beim Darüberfahren 9 px breit ist. Die bestehenden Tests aus Ticket 28 sind angepasst; Ausblenden, Streifen und Markierungen funktionieren weiter.
- [ ] **Weitere Orte:** Je eine Prüfung der Breite und der Farbe in Ruhe:
  - im Terminal;
  - im Git-Log oder in der Änderungsansicht;
  - in der Markdown-Vorschau;
  - in einem Suchfenster („Go to File“ oder „Find in Files“).
- [ ] **Eine Stelle für die Werte:** Ein Einheitstest prüft, dass die Werte nur an der zentralen Stelle stehen, also keine festen Farben oder Breiten für Scrollbalken anderswo in `app.css`.
- [ ] **Bilder:** Die Bilder des eingebauten Stands wurden dem Nutzer gezeigt; Rückmeldungen sind eingearbeitet oder als neue Tickets erfasst.
- [ ] **Läufe:** `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Die Scrollbalken im Projektbaum, in den Werkzeugfenstern, im Terminal, in den Suchfenstern und in der Markdown-Vorschau sehen aus wie im Code-Bereich: gleiche Farbe, 9 px breit, rund, ohne Spur.
- [ ] Im Code-Bereich ist die Kapsel auch in Ruhe 9 px breit und blendet weiter aus. Ausserhalb bleibt sie sichtbar.
- [ ] Die Kapsel lässt sich überall gut greifen; nichts ist abgeschnitten oder verrutscht.
- [ ] Bei 150 % Skalierung sind die Kapseln scharf.

## Hinweise

- **Spielregeln:**
  - Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt.
  - Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop.
  - Keine echten Eingaben an den Desktop.
  - Keine Messungen oder Proben mit Tausenden Dateien auf der Platte ohne Rückfrage. Für einen scrollenden Baum genügen einige Dutzend Einträge.
- **Chromium-Scrollbalken:** In Chromium lässt sich die Kapsel mit `::-webkit-scrollbar`, `::-webkit-scrollbar-thumb` (Radius, transparenter Rand bzw. `background-clip`) und `::-webkit-scrollbar-track` gestalten. Setzt man `scrollbar-width` oder `scrollbar-color` am selben Element, ignoriert Chromium die `::-webkit-scrollbar`-Regeln. Der Agent klärt, was in Electron 45 trägt.
- **Terminal:** xterm.js 6 zeichnet seinen Scrollbalken selbst, ähnlich wie Monaco. Er lässt sich über CSS an seinem Schieber bzw. über die Optionen von xterm gestalten.
- **Ticket 33** ändert das Branch-Dropdown. Werden beide nacheinander umgesetzt, baut das spätere auf dem früheren auf.
