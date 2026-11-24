// Meldungen unten rechts, gestapelt, die neueste unten. Erfolg und Information verschwinden nach etwa fünf Sekunden
// (solange die Maus darüber steht, nicht), Fehler bleiben, bis man sie schliesst (Regeln in noticeRules.ts).
// Meldungen kommen vom Kern (`app.notice`) oder von der Oberfläche selbst und können Knöpfe tragen.

import { useCallback, useEffect, useState } from 'react';
import type { Notice } from '../shared/types';
import { CloseIcon, ErrorIcon, InfoIcon, SuccessIcon } from './icons';
import { noticeTimeout } from './noticeRules';

/** Ein Knopf an einer Meldung; ein Klick schliesst die Meldung und führt ihn aus, mit `keepOpen` bleibt sie stehen. */
export interface NoticeButton {
  label: string;
  run: () => void;
  keepOpen?: boolean;
}

/** Eine Meldung in der Oberfläche. */
export interface UiNotice {
  id: number;
  level: Notice['level'];
  text: string;
  actions?: NoticeButton[];
}

export type Notify = (notice: Omit<UiNotice, 'id'>) => void;

let nextId = 1;

/** Die Meldungen eines Fensters. */
export function useNotices(): { notices: UiNotice[]; notify: Notify; dismiss: (id: number) => void } {
  const [notices, setNotices] = useState<UiNotice[]>([]);
  const notify = useCallback<Notify>((notice) => {
    const id = nextId++;
    setNotices((list) => [...list, { ...notice, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((list) => list.filter((n) => n.id !== id)), []);
  return { notices, notify, dismiss };
}

export function NoticeList({ notices, onDismiss }: { notices: UiNotice[]; onDismiss: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((notice) => (
        <NoticeView key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

const LEVEL_ICONS = { info: InfoIcon, success: SuccessIcon, error: ErrorIcon };

function NoticeView({ notice, onDismiss }: { notice: UiNotice; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);

  // Von selbst verschwinden, ausser bei Fehlern; steht die Maus darüber, beginnt die Wartezeit danach von vorn.
  useEffect(() => {
    const timeout = noticeTimeout(notice.level);
    if (timeout === null || hovered) return;
    const timer = setTimeout(() => onDismiss(notice.id), timeout);
    return () => clearTimeout(timer);
  }, [notice.id, notice.level, hovered, onDismiss]);

  const Icon = LEVEL_ICONS[notice.level];
  return (
    <div
      className={`notice notice-${notice.level}`}
      role={notice.level === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="notice-icon">
        <Icon />
      </span>
      <span className="notice-text">{notice.text}</span>
      <button type="button" className="icon-button notice-close" aria-label="Close" title="Close" onClick={() => onDismiss(notice.id)}>
        <CloseIcon />
      </button>
      {notice.actions && notice.actions.length > 0 && (
        <div className="notice-actions">
          {notice.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="notice-action"
              onClick={() => {
                if (!action.keepOpen) onDismiss(notice.id);
                action.run();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
