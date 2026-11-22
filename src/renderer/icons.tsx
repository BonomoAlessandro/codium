// Symbole der Oberfläche als SVG, angelehnt an die Symbole des neuen IntelliJ. Sie übernehmen die Textfarbe
// (currentColor) und sind für Screenreader verborgen; den Namen trägt der Knopf.

import type { ReactNode } from 'react';
import type { ToolWindowId } from '../shared/types';

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

export const ProjectIcon = () => (
  <Icon size={18}>
    <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6h5.8a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
  </Icon>
);

export const CommitIcon = () => (
  <Icon size={18}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M0.8 8h4.6M10.6 8h4.6" />
  </Icon>
);

export const TerminalIcon = () => (
  <Icon size={18}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
  </Icon>
);

export const GitIcon = () => (
  <Icon size={18}>
    <circle cx="4.5" cy="3.5" r="1.6" />
    <circle cx="4.5" cy="12.5" r="1.6" />
    <circle cx="11.5" cy="5.5" r="1.6" />
    <path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-3 2.2-6.4 4" />
  </Icon>
);

export const FindIcon = () => (
  <Icon size={18}>
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

export const TOOL_WINDOW_ICONS: Record<ToolWindowId, () => ReactNode> = {
  project: ProjectIcon,
  commit: CommitIcon,
  terminal: TerminalIcon,
  git: GitIcon,
  find: FindIcon,
  database: DatabaseIcon,
};
