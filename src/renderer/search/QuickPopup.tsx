// Rahmen der Suchfenster über dem Editor (Ctrl + Shift + N, Ctrl + E, Ctrl + Shift + F) wie in IntelliJ: oben in der
// Mitte des Fensters, Escape oder ein Klick daneben schliesst es, danach geht der Fokus dorthin zurück, wo er war. Den
// Klick daneben fängt ein Hintergrund über dem ganzen Fenster; damit er auch über der Kopfzeile ankommt, ist diese
// solange keine Zieh-Fläche (Ticket 33, popup/dismiss.ts).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHeaderNoDrag } from '../popup/dismiss';

/** Wohin der Fokus nach einem offenen Suchfenster zurückgeht, für den Wechsel von einem Suchfenster ins andere. */
const focusBefore = new WeakMap<Element, Element | null>();

/**
 * Wo der Fokus vor dem Suchfenster lag. Gelesen beim ersten Rendern: Das `autoFocus` des Suchfelds läuft vor jedem
 * Effekt, danach läge der Fokus schon im eigenen Suchfeld (Review von Ticket 26). Löst ein Suchfenster ein anderes ab
 * (etwa Ctrl + Shift + N bei offenem Ctrl + E), gilt, was sich das erste gemerkt hat.
 */
function focusOutsidePopups(): Element | null {
  const active = document.activeElement;
  const popup = active?.closest('.quick-popup');
  return popup ? (focusBefore.get(popup) ?? null) : active;
}

interface QuickPopupProps {
  /** Name für Screenreader und Tests. */
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

export function QuickPopup({ label, className, onClose, children }: QuickPopupProps) {
  const [previousFocus] = useState(focusOutsidePopups);
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useHeaderNoDrag();
  // Escape schliesst auch, wenn der Fokus nicht mehr im Fenster liegt (etwa nach einem Klick in den Editor darunter).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  useLayoutEffect(() => {
    const popup = ref.current;
    if (popup) focusBefore.set(popup, previousFocus);
  }, [previousFocus]);
  useEffect(
    () => () => {
      // Hat inzwischen etwas anderes den Fokus genommen (etwa der Editor nach dem Öffnen oder das nächste Suchfenster),
      // bleibt er dort.
      if ((document.activeElement === null || document.activeElement === document.body) && previousFocus instanceof HTMLElement) {
        previousFocus.focus({ preventScroll: true });
      }
    },
    [previousFocus],
  );
  return createPortal(
    <div
      className="quick-popup-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        className={`quick-popup ${className ?? ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
