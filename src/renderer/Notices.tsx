// Vorläufige, schlichte Hinweise. Ticket 03 ersetzt sie durch die Meldungen unten rechts.

import { useCallback, useState } from 'react';
import type { Notice } from '../shared/types';

/** Ein Knopf an einem Hinweis. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

/** Ein Hinweis in der Oberfläche: aus dem Kern (`app.notice`) oder von der Oberfläche selbst. */
export interface UiNotice extends Notice {
  id: number;
  actions?: NoticeAction[];
}

export type Notify = (notice: Notice & { actions?: NoticeAction[] }) => void;

let nextId = 1;

/** Die Liste der Hinweise eines Fensters. */
export function useNotices(): { notices: UiNotice[]; notify: Notify; dismiss: (id: number) => void } {
  const [notices, setNotices] = useState<UiNotice[]>([]);
  const notify = useCallback<Notify>((notice) => setNotices((list) => [...list, { ...notice, id: nextId++ }]), []);
  const dismiss = useCallback((id: number) => setNotices((list) => list.filter((n) => n.id !== id)), []);
  return { notices, notify, dismiss };
}

export function NoticeList({ notices, onDismiss }: { notices: UiNotice[]; onDismiss: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="status">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice notice-${notice.level}`}>
          <span className="notice-text">{notice.text}</span>
          {notice.actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className="notice-action"
              onClick={() => {
                onDismiss(notice.id);
                action.run();
              }}
            >
              {action.label}
            </button>
          ))}
          <button type="button" className="notice-close" aria-label="Close" onClick={() => onDismiss(notice.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
