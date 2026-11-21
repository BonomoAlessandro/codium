// Aufklappmenü unter einem Element (etwa das Projektmenü in der Kopfzeile), nach dem Vorbild THub. Bedienung mit
// der Maus oder mit Pfeiltasten, Enter und Escape.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { menuKey } from './menuKeys';

/** Ein Eintrag im Menü: Trennlinie oder wählbarer Eintrag. */
export type MenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'item';
      label: string;
      /** Zweite, kleinere Zeile, etwa der volle Pfad eines Projekts. */
      detail?: string;
      /** Gedämpft dargestellt, etwa ein Projekt, dessen Ordner fehlt. */
      muted?: boolean;
      run(): void;
    };

type MenuItem = Extract<MenuEntry, { kind: 'item' }>;

/** Abstand des Menüs zum Fensterrand und zum Element darüber. */
const MARGIN = 6;
const GAP = 4;

interface MenuProps {
  /** Name des Menüs für Screenreader. */
  label: string;
  entries: MenuEntry[];
  /** Das Element, unter dem das Menü aufgeht. Ein Klick darauf schliesst das Menü nicht; das regelt das Element. */
  anchor: HTMLElement;
  /** Den ersten Eintrag gleich hervorheben, etwa wenn das Menü per Tastatur geöffnet wurde. */
  highlightFirst?: boolean;
  /** Das Menü schliesst sich (Escape, Klick daneben, Fenster verliert den Fokus, Eintrag gewählt). */
  onClose(): void;
}

/**
 * Das Menü hält den Fokus, solange es offen ist; danach gibt `onClose` ihn zurück. Ein gewählter Eintrag läuft erst,
 * nachdem sich das Menü geschlossen hat.
 */
export function Menu({ label, entries, anchor, highlightFirst = false, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = entries.filter((e): e is MenuItem => e.kind === 'item');
  const [highlighted, setHighlighted] = useState(highlightFirst && items.length > 0 ? 0 : -1);

  // Für die Handler am Fenster: immer der zuletzt angezeigte Stand.
  const current = useRef({ highlighted, items, onClose });
  current.current = { highlighted, items, onClose };

  const choose = (item: MenuItem) => {
    current.current.onClose();
    item.run();
  };

  // Unter dem Element aufgehen, im Fenster gehalten; dann den Fokus übernehmen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const top = clamp(r.bottom + GAP, MARGIN, window.innerHeight - el.offsetHeight - MARGIN);
    el.style.left = `${clamp(r.left, MARGIN, window.innerWidth - el.offsetWidth - MARGIN)}px`;
    el.style.top = `${top}px`;
    el.focus({ preventScroll: true });
  }, [anchor]);

  // Tasten in der Capture-Phase, vor den Kürzeln der App; Klick daneben, Fokusverlust und Grössenänderung schliessen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { highlighted: h, items: list } = current.current;
      const action = menuKey(e.key, h, list.length);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.type === 'highlight') setHighlighted(action.index);
      else if (action.type === 'choose') choose(list[action.index]);
      else current.current.onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) current.current.onClose();
    };
    const close = () => current.current.onClose();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
    // `choose` liest nur aus `current` und braucht deshalb keine Abhängigkeit.
  }, [anchor]);

  const itemId = (index: number) => `${id}-${index}`;
  let index = -1;

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={highlighted >= 0 ? itemId(highlighted) : undefined}
      // Klicks ins Menü lassen den Fokus beim Menü.
      onMouseDown={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={i} className="menu-separator" role="separator" />;
        const own = ++index;
        const classes = ['menu-item', own === highlighted && 'highlighted', entry.muted && 'muted'].filter(Boolean);
        return (
          <button
            key={i}
            id={itemId(own)}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={classes.join(' ')}
            title={entry.detail}
            onMouseMove={() => setHighlighted(own)}
            onClick={() => choose(entry)}
          >
            <span className="menu-item-label">{entry.label}</span>
            {entry.detail && <span className="menu-item-detail">{entry.detail}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
