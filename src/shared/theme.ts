// Farben und Masse, die sowohl das Fenster (Hauptprozess, ohne CSS) als auch die Oberfläche brauchen. Codium ist
// nur dunkel, nach dem neuen IntelliJ-Design „Dark“. Die Oberfläche hat dieselben Werte als Design-Variablen in
// renderer/styles/tokens.css; ein Test prüft, dass beide gleich bleiben.

/** Hintergrund des Fensters und des Code-Bereichs (--bg). Gilt beim Öffnen immer, auch bei hellem Windows-Design. */
export const WINDOW_BACKGROUND = '#1e1f22';

/** Hintergrund von Kopfzeile, Symbolleisten, Werkzeugfenstern und Statusleiste (--bg-panel). */
export const PANEL_BACKGROUND = '#2b2d30';

/** Farbe der Symbole auf den Fensterknöpfen von Windows (--icon). */
export const WINDOW_SYMBOL_COLOR = '#ced0d6';

/** Höhe der Kopfzeile in Pixeln (--header-height); die Fensterknöpfe von Windows sind genau so hoch. */
export const HEADER_HEIGHT = 40;
