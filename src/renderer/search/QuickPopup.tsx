// Rahmen der Suchfenster über dem Editor (Ctrl + Shift + N, Ctrl + E, Ctrl + Shift + F) wie in IntelliJ: oben in der
// Mitte des Fensters, Escape oder ein Klick daneben schliesst es, danach geht der Fokus dorthin zurück, wo er war.

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface QuickPopupProps {
  /** Name für Screenreader und Tests. */
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

export function QuickPopup({ label, className, onClose, children }: QuickPopupProps) {
  const previousFocus = useRef<Element | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement;
    return () => {
      // Hat inzwischen etwas anderes den Fokus genommen (etwa der Editor nach dem Öffnen), bleibt er dort.
      const restore = previousFocus.current;
      if ((document.activeElement === null || document.activeElement === document.body) && restore instanceof HTMLElement) {
        restore.focus({ preventScroll: true });
      }
    };
  }, []);
  return createPortal(
    <div
      className="quick-popup-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
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
