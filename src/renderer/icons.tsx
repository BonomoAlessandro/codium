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

export const HideIcon = () => (
  <Icon>
    <path d="M4 8h8" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon size={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
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
