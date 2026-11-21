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

/** Die offenen Menüs, jeweils mit der Funktion, die es schliesst. */
const openMenus = new Set<() => void>();

/**
 * Schliesst alle offenen Menüs, etwa bevor ein Tastenkürzel der App wirkt; sonst bliebe ein Menü offen und nähme
 * weiter Tasten an. Liefert, ob eines offen war.
 */
export function closeOpenMenus(): boolean {
  const wasOpen = openMenus.size > 0;
  for (const close of [...openMenus]) close();
  return wasOpen;
}

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
  // Geschlossen heisst sofort: Bis React das Menü entfernt hat, nimmt es keine Tasten mehr an.
  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    current.current.onClose();
  };

  const choose = (item: MenuItem) => {
    close();
    item.run();
  };

  // Angemeldet, damit Tastenkürzel der App ein offenes Menü zuerst schliessen können.
  useEffect(() => {
    closed.current = false;
    openMenus.add(close);
    return () => {
      openMenus.delete(close);
    };
    // `close` liest nur aus Refs.
  }, []);

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

  // Tasten (in der Capture-Phase) bedienen das Menü; Klick daneben, Fokusverlust und Grössenänderung schliessen es.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (closed.current) return;
      const { highlighted: h, items: list } = current.current;
      const action = menuKey(e.key, h, list.length);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.type === 'highlight') setHighlighted(action.index);
      else if (action.type === 'choose') choose(list[action.index]);
      else close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) close();
    };
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
    // `choose` und `close` lesen nur aus Refs und brauchen deshalb keine Abhängigkeit.
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
      // Verlässt der Fokus das Menü (etwa durch ein Tastenkürzel), schliesst es sich; den Fokus auf dem Element, an dem
      // es hängt, regelt dessen Klick (es schaltet das Menü um).
      onBlur={(e) => {
        const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
        if (next && (ref.current?.contains(next) || anchor.contains(next))) return;
        close();
      }}
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
