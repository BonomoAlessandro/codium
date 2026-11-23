// Entwurf Ticket 25: neue Symbole zum Übernehmen in src/renderer/icons.tsx (dort gibt es die Hilfsfunktion
// `Icon`: 16 px, viewBox 0 0 16 16, Linien 1.2 in currentColor, für Screenreader verborgen). Eigene Zeichnungen,
// in der Form an IntelliJ angelehnt; keine Dateien von JetBrains.
//
// Akzentfarben laufen über Klassen, damit sie aus tokens.css kommen. Dazu in app.css:
//
//   .icon .icon-incoming { stroke: var(--git-incoming); }
//   .icon .icon-outgoing { stroke: var(--git-outgoing); }
//   .icon .icon-head { fill: var(--git-head); stroke: var(--git-head); }
//
// und in tokens.css: --git-incoming: #548af7; --git-outgoing: #5fb865; --git-head: #d6b33d;
//
// Diese Datei ist nicht Teil des Builds; sie liegt nur bei der Skizze.

import type { ReactNode } from 'react';

declare function Icon(props: { size?: number; children: ReactNode }): ReactNode;

/** Fetch: Symbolknopf rechts in der Titelzeile des Branch-Dropdowns (Tooltip „Fetch“). */
export const FetchIcon = () => (
  <Icon>
    <path d="M4.6 10.5H4a2.5 2.5 0 0 1-.3-4.98 4.2 4.2 0 0 1 8.1-.9A2.9 2.9 0 0 1 12 10.5h-.6" />
    <path d="M8 7.5v7M5.9 12.4 8 14.5l2.1-2.1" />
  </Icon>
);

/** Pull: Aktionszeile „Pull“ (Ctrl+T). Pfeil in der Farbe für Eingehendes (blau), wie die Pfeile „zurück“. */
export const PullIcon = () => (
  <Icon>
    <path className="icon-incoming" d="M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2" />
    <path d="M3 13.5h10" />
  </Icon>
);

/** Push…: Aktionszeile „Push…“ (Ctrl+Shift+K). Pfeil in der Farbe für Ausgehendes (grün), wie die Pfeile „voraus“. */
export const PushIcon = () => (
  <Icon>
    <path className="icon-outgoing" d="M8 13.5v-8M4.8 8.7 8 5.5l3.2 3.2" />
    <path d="M3 2.5h10" />
  </Icon>
);

/** Aktueller Branch: Statt des Texts „current“: gefülltes Etikett in der HEAD-Farbe des Git-Logs (gelb). */
export const BranchCurrentIcon = () => (
  <Icon>
    <path className="icon-head" fillRule="evenodd" d="M3.5 3.5h6.8l3.7 4.5-3.7 4.5H3.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7.3 8a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0z" />
  </Icon>
);

/** Zurück (eingehend): Kleiner Pfeil vor der Zahl der Commits, die der Branch hinter seinem Remote liegt (blau). Auch in der Kopfzeile. */
export const IncomingIcon = () => (
  <Icon size={12}>
    <path className="icon-incoming" d="M8 2.5v11M3.8 9.3 8 13.5l4.2-4.2" />
  </Icon>
);

/** Voraus (ausgehend): Kleiner Pfeil vor der Zahl der Commits, die noch nicht gepusht sind (grün). Auch in der Kopfzeile. */
export const OutgoingIcon = () => (
  <Icon size={12}>
    <path className="icon-outgoing" d="M8 13.5v-11M3.8 6.7 8 2.5l4.2 4.2" />
  </Icon>
);

/** Checkout: Untermenü eines Branches: „Checkout“ (Pfeil zum Commit). */
export const CheckoutIcon = () => (
  <Icon>
    <path d="M1.5 8h7M5.8 5.3 8.5 8l-2.7 2.7" />
    <circle cx="12" cy="8" r="2.3" />
  </Icon>
);

/** Delete: Untermenü eines Branches: „Delete“; Rechtsklick-Menü im Baum: „Delete…“. */
export const DeleteIcon = () => (
  <Icon>
    <path d="M2.5 4.5h11M6 4.5V3a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.5M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.6 7v4.5M9.4 7v4.5" />
  </Icon>
);

/** Copy: Rechtsklick-Menü im Baum: „Copy“. */
export const CopyIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8.5" rx="1.2" />
    <path d="M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" />
  </Icon>
);

/** Paste: Rechtsklick-Menü im Baum: „Paste“. */
export const PasteIcon = () => (
  <Icon>
    <path d="M5.5 3H4a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1.5" />
    <rect x="5.5" y="1.8" width="5" height="2.4" rx="0.8" />
  </Icon>
);

/** Rename… (zur Wahl): Nur falls gewünscht: „Rename…“ im Branch-Untermenü und im Baum. Im Vorschlag bleibt der Platz frei. */
export const RenameIcon = () => (
  <Icon>
    <path d="M10.6 2.6a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2L6 12.8l-3.3.7.7-3.3zM9.4 3.8l2.8 2.8" />
  </Icon>
);

/** Settings…: Projektmenü: „Settings…“. */
export const SettingsIcon = () => (
  <Icon>
    <path d="M6.37 3.27L6.72 1.42A6.7 6.7 0 0 1 9.28 1.42L9.63 3.27A5 5 0 0 1 11.28 4.23L13.06 3.6A6.7 6.7 0 0 1 14.33 5.82L12.91 7.05A5 5 0 0 1 12.91 8.95L14.33 10.18A6.7 6.7 0 0 1 13.06 12.4L11.28 11.77A5 5 0 0 1 9.63 12.73L9.28 14.58A6.7 6.7 0 0 1 6.72 14.58L6.37 12.73A5 5 0 0 1 4.72 11.77L2.94 12.4A6.7 6.7 0 0 1 1.67 10.18L3.09 8.95A5 5 0 0 1 3.09 7.05L1.67 5.82A6.7 6.7 0 0 1 2.94 3.6L4.72 4.23A5 5 0 0 1 6.37 3.27Z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);
