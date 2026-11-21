// Kopf eines Werkzeugfensters wie in IntelliJ: links der Titel, rechts die Knöpfe des Werkzeugfensters und „Hide“.

import type { ReactNode } from 'react';
import { HideIcon } from '../icons';

export function ToolWindowHeader({ title, onHide, children }: { title: string; onHide: () => void; children?: ReactNode }) {
  return (
    <div className="tool-window-header">
      <span className="tool-window-title">{title}</span>
      <div className="tool-window-actions">
        {children}
        <button type="button" className="icon-button" aria-label="Hide" title="Hide" onClick={onHide}>
          <HideIcon />
        </button>
      </div>
    </div>
  );
}
