// Symbole der Oberfläche als SVG, angelehnt an die Symbole des neuen IntelliJ. Sie übernehmen die Textfarbe
// (currentColor) und sind für Screenreader verborgen; den Namen trägt der Knopf.

import type { ReactNode } from 'react';
import type { JavaKind, ToolWindowId } from '../shared/types';

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ProjectIcon = ({ size = 18 }: { size?: number } = {}) => (
  <Icon size={size}>
    <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6h5.8a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
  </Icon>
);

export const CommitIcon = () => (
  <Icon size={18}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M0.8 8h4.6M10.6 8h4.6" />
  </Icon>
);

export const TerminalIcon = ({ size = 18 }: { size?: number } = {}) => (
  <Icon size={size}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
  </Icon>
);

export const GitIcon = ({ size = 18 }: { size?: number } = {}) => (
  <Icon size={size}>
    <circle cx="4.5" cy="3.5" r="1.6" />
    <circle cx="4.5" cy="12.5" r="1.6" />
    <circle cx="11.5" cy="5.5" r="1.6" />
    <path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-3 2.2-6.4 4" />
  </Icon>
);

export const FindIcon = ({ size = 18 }: { size?: number } = {}) => (
  <Icon size={size}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4l4 4" />
  </Icon>
);

export const DatabaseIcon = () => (
  <Icon size={18}>
    <ellipse cx="8" cy="3.8" rx="5.5" ry="2" />
    <path d="M2.5 3.8v8.4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V3.8M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon size={12}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon size={12}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

/** Ordner im Dateibaum, gefüllt wie in IntelliJ. */
export const FolderIcon = () => (
  <svg className="icon icon-folder" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6h5.8a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor" />
  </svg>
);

export const FileIcon = () => (
  <Icon>
    <path d="M4 1.5h5.2L12.5 4.8v9.2a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" />
    <path d="M9 1.7V5h3.3" />
  </Icon>
);

// ---------- Java-Dateien (Ticket 32) ----------
// Ein rundes Zeichen je Art wie im neuen IntelliJ: dunkle Fläche, farbiger Ring und Zeichen; Abstraktes mit
// gestricheltem Ring. Record teilt die Farben der Klasse, Annotation die des Interface. Java-Dateien ohne eindeutige
// Art tragen eine Tasse. Die Farben kommen nur aus den Design-Variablen `--java-*` in tokens.css; anders als die übrigen
// Symbole übernehmen diese nicht die Textfarbe, damit eine Git-Farbe nur den Namen färbt.

type JavaPalette = 'class' | 'interface' | 'enum' | 'exception';

/** Die Zeichen als Linien, Mitte bei 8/8. */
const JAVA_GLYPHS = {
  C: 'M10.5 5.7A3.2 3.4 0 1 0 10.5 10.3',
  I: 'M6.2 4.8h3.6M8 4.8v6.4M6.2 11.2h3.6',
  E: 'M10 4.8H6.3v6.4H10M6.3 8h3.2',
  R: 'M6.4 11.2V4.8h2.3a1.75 1.75 0 0 1 0 3.5H6.4M8.6 8.3l1.6 2.9',
  at: 'M9.3 8a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M9.3 6.4v2.5c0 .8.4 1.2 1 1.2.9 0 1.5-.8 1.5-2.2A3.8 3.8 0 1 0 10.4 11',
  bolt: 'M8.9 4.5 6.3 8.2h3.4l-2.6 3.6',
} as const;

const JAVA_SYMBOLS: Record<Exclude<JavaKind, 'java'>, { palette: JavaPalette; glyph: keyof typeof JAVA_GLYPHS; dashed?: true }> = {
  class: { palette: 'class', glyph: 'C' },
  abstractClass: { palette: 'class', glyph: 'C', dashed: true },
  record: { palette: 'class', glyph: 'R' },
  interface: { palette: 'interface', glyph: 'I' },
  annotation: { palette: 'interface', glyph: 'at' },
  enum: { palette: 'enum', glyph: 'E' },
  exception: { palette: 'exception', glyph: 'bolt' },
  abstractException: { palette: 'exception', glyph: 'bolt', dashed: true },
};

/** Der gestrichelte Ring: acht Bögen, Lücken auf den Achsen und Diagonalen (Bögen statt Strichmuster, das einen Rest
 *  stehen liess). */
const JAVA_DASHED_RING = Array.from({ length: 8 }, (_, k) => {
  const point = (degrees: number) => {
    const rad = (degrees * Math.PI) / 180;
    return `${(8 + 6.5 * Math.cos(rad)).toFixed(2)} ${(8 + 6.5 * Math.sin(rad)).toFixed(2)}`;
  };
  const middle = 22.5 + 45 * k;
  return `M${point(middle - 15)}A6.5 6.5 0 0 1 ${point(middle + 15)}`;
}).join('');

function JavaSvg({ kind, children }: { kind: JavaKind; children: ReactNode }) {
  return (
    <svg className="icon java-icon" data-java-kind={kind} width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Das Symbol einer Java-Datei nach der Art ihres obersten Typs (Ticket 32). */
export function JavaKindIcon({ kind }: { kind: JavaKind }) {
  if (kind === 'java') {
    return (
      <JavaSvg kind={kind}>
        <path
          d="M3.5 4.5h7.5v3.3a3.2 3.2 0 0 1-3.2 3.2H6.7a3.2 3.2 0 0 1-3.2-3.2z"
          fill="var(--java-file-fill)"
          stroke="var(--java-file)"
          strokeLinejoin="round"
        />
        <path d="M11 5.6h1.1a1.3 1.3 0 0 1 0 2.6H11M3 13h9.5" stroke="var(--java-file)" strokeLinecap="round" strokeLinejoin="round" />
      </JavaSvg>
    );
  }
  const { palette, glyph, dashed } = JAVA_SYMBOLS[kind];
  const line = `var(--java-${palette})`;
  return (
    <JavaSvg kind={kind}>
      {dashed ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill={`var(--java-${palette}-fill)`} />
          <path d={JAVA_DASHED_RING} stroke={line} />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.5" fill={`var(--java-${palette}-fill)`} stroke={line} />
      )}
      <path d={JAVA_GLYPHS[glyph]} stroke={line} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </JavaSvg>
  );
}

/** Ein Link, dem Codium nicht folgt (nach draussen oder tot): Kettenglied. */
export const LinkIcon = () => (
  <Icon>
    <path d="M6.6 9.4l2.8-2.8" />
    <path d="M7.2 4.8l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7l-1.3 1.3M8.8 11.2l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7l1.3-1.3" />
  </Icon>
);

/** „Select Opened File“: Fadenkreuz wie in IntelliJ. */
export const LocateIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="4.5" />
    <circle cx="8" cy="8" r="1.2" />
    <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
  </Icon>
);

export const CollapseAllIcon = () => (
  <Icon>
    <path d="M4.5 6.5L8 3l3.5 3.5M4.5 13L8 9.5l3.5 3.5" />
  </Icon>
);

export const HideIcon = () => (
  <Icon>
    <path d="M4 8h8" />
  </Icon>
);

/** „+“ für ein weiteres Terminal. */
export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

/** Branch in der Kopfzeile. */
export const BranchIcon = () => (
  <Icon>
    <path d="M5 3v10M5 9c0-3 6-2 6-5M5 13a1.5 1.5 0 1 0 0-.01M11 4a1.5 1.5 0 1 0 0-.01M5 3a1.5 1.5 0 1 0 0-.01" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon size={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

/** Angehefteter Tab: Stecknadel wie in IntelliJ. */
export const PinIcon = () => (
  <Icon size={12}>
    <path d="M9.5 2.5l4 4M10.5 3.5L7 7l-2.5-.5L3 8l5 5 1.5-1.5L9 9l3.5-3.5M5.5 10.5L2.5 13.5" />
  </Icon>
);

export const InfoIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 7.2v4M8 4.8v.1" />
  </Icon>
);

export const SuccessIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M5 8.2l2 2 4-4.2" />
  </Icon>
);

export const ErrorIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 4.6v4.2M8 11.2v.1" />
  </Icon>
);

// ---------- Git und Menüs (Ticket 25) ----------
// Akzentfarben über Klassen (app.css, Farben aus tokens.css): blau für Eingehendes (Pull, zurück), grün für
// Ausgehendes (Push, voraus) und Commit, gelb für den aktuellen Branch wie HEAD im Git-Log.

/** „Fetch“ in der Titelzeile des Branch-Dropdowns: Pfeil aus der Wolke. */
export const FetchIcon = () => (
  <Icon>
    <path d="M4.6 10.5H4a2.5 2.5 0 0 1-.3-4.98 4.2 4.2 0 0 1 8.1-.9A2.9 2.9 0 0 1 12 10.5h-.6" />
    <path d="M8 7.5v7M5.9 12.4 8 14.5l2.1-2.1" />
  </Icon>
);

/** „Pull“: Pfeil nach unten auf eine Linie, in der Farbe für Eingehendes. */
export const PullIcon = () => (
  <Icon>
    <path className="icon-incoming" d="M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2" />
    <path d="M3 13.5h10" />
  </Icon>
);

/** „Push…“: Pfeil nach oben an eine Linie, in der Farbe für Ausgehendes. */
export const PushIcon = () => (
  <Icon>
    <path className="icon-outgoing" d="M8 13.5v-8M4.8 8.7 8 5.5l3.2 3.2" />
    <path d="M3 2.5h10" />
  </Icon>
);

/** „Commit…“: Häkchen wie in IntelliJ. */
export const CommitActionIcon = () => (
  <Icon>
    <path className="icon-success" d="M3 8.6l3.3 3.2L13 4.8" />
  </Icon>
);

/** Der aktuelle Branch: gefülltes Etikett in der Farbe von HEAD im Git-Log. */
export const BranchCurrentIcon = () => (
  <Icon>
    <path
      className="icon-head"
      fillRule="evenodd"
      d="M3.5 3.5h6.8l3.7 4.5-3.7 4.5H3.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7.3 8a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0z"
    />
  </Icon>
);

/** Zurück: Commits, die der Branch hinter seinem Remote liegt. */
export const IncomingIcon = () => (
  <Icon size={12}>
    <path className="icon-incoming" d="M8 2.5v11M3.8 9.3 8 13.5l4.2-4.2" />
  </Icon>
);

/** Voraus: Commits, die noch nicht gepusht sind. */
export const OutgoingIcon = () => (
  <Icon size={12}>
    <path className="icon-outgoing" d="M8 13.5v-11M3.8 6.7 8 2.5l4.2 4.2" />
  </Icon>
);

/** „Checkout“: Pfeil zum Commit. */
export const CheckoutIcon = () => (
  <Icon>
    <path d="M1.5 8h7M5.8 5.3 8.5 8l-2.7 2.7" />
    <circle cx="12" cy="8" r="2.3" />
  </Icon>
);

export const DeleteIcon = () => (
  <Icon>
    <path d="M2.5 4.5h11M6 4.5V3a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.5M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.6 7v4.5M9.4 7v4.5" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8.5" rx="1.2" />
    <path d="M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" />
  </Icon>
);

export const PasteIcon = () => (
  <Icon>
    <path d="M5.5 3H4a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1.5" />
    <rect x="5.5" y="1.8" width="5" height="2.4" rx="0.8" />
  </Icon>
);

/** „Settings…“: Zahnrad mit sechs Zähnen. */
export const SettingsIcon = () => (
  <Icon>
    <path d="M6.37 3.27L6.72 1.42A6.7 6.7 0 0 1 9.28 1.42L9.63 3.27A5 5 0 0 1 11.28 4.23L13.06 3.6A6.7 6.7 0 0 1 14.33 5.82L12.91 7.05A5 5 0 0 1 12.91 8.95L14.33 10.18A6.7 6.7 0 0 1 13.06 12.4L11.28 11.77A5 5 0 0 1 9.63 12.73L9.28 14.58A6.7 6.7 0 0 1 6.72 14.58L6.37 12.73A5 5 0 0 1 4.72 11.77L2.94 12.4A6.7 6.7 0 0 1 1.67 10.18L3.09 8.95A5 5 0 0 1 3.09 7.05L1.67 5.82A6.7 6.7 0 0 1 2.94 3.6L4.72 4.23A5 5 0 0 1 6.37 3.27Z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const TOOL_WINDOW_ICONS: Record<ToolWindowId, () => ReactNode> = {
  project: ProjectIcon,
  commit: CommitIcon,
  terminal: TerminalIcon,
  git: GitIcon,
  find: FindIcon,
  database: DatabaseIcon,
};
