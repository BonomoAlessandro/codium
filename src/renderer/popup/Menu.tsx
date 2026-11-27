// Aufklappmenü unter einem Element (etwa das Projektmenü in der Kopfzeile) oder an einer Stelle (Rechtsklick-Menü),
// nach dem Vorbild THub und IntelliJ. Bedienung mit der Maus oder mit Pfeiltasten, Enter und Escape; Untermenüs
// öffnen mit Pfeil rechts, Enter oder beim Überfahren und schliessen mit Pfeil links oder Escape. Inaktive Einträge
// sind sichtbar, aber nicht wählbar. Einträge können ein Symbol in einer eigenen, bündigen Spalte tragen (Ticket 25).

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRightIcon } from '../icons';
import { useDismiss } from './dismiss';
import { menuKey } from './menuKeys';

/** Ein Eintrag im Menü: Trennlinie, wählbarer Eintrag oder Untermenü. */
export type MenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'item';
      label: string;
      /** Zweite, kleinere Zeile, etwa der volle Pfad eines Projekts. */
      detail?: string;
      /** Gedämpft dargestellt, etwa ein Projekt, dessen Ordner fehlt. */
      muted?: boolean;
      /** Tastenkürzel zur Anzeige rechts, etwa „Ctrl+C“. */
      shortcut?: string;
      /** Sichtbar, aber nicht wählbar. */
      disabled?: boolean;
      /** Symbol in der eigenen, bündigen Spalte links (Ticket 25). */
      icon?: ReactNode;
      run(): void;
    }
  | { kind: 'submenu'; label: string; disabled?: boolean; icon?: ReactNode; entries: MenuEntry[] };

type Selectable = Exclude<MenuEntry, { kind: 'separator' }>;

/** Wo das Menü aufgeht: unter einem Element oder an einer Stelle im Fenster (etwa beim Rechtsklick). */
export type MenuAnchor = HTMLElement | { x: number; y: number };

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

/**
 * Meldet ein anderes Popup (etwa das Branch-Dropdown) wie ein Menü an, damit Tastenkürzel der App es zuerst schliessen.
 * Liefert die Abmeldung.
 */
export function registerOpenMenu(close: () => void): () => void {
  openMenus.add(close);
  return () => {
    openMenus.delete(close);
  };
}

interface MenuProps {
  /** Name des Menüs für Screenreader. */
  label: string;
  entries: MenuEntry[];
  /** Wo das Menü aufgeht. Ein Klick auf ein Element als Anker schliesst das Menü nicht; das regelt das Element. */
  anchor: MenuAnchor;
  /** Den ersten Eintrag gleich hervorheben, etwa wenn das Menü per Tastatur geöffnet wurde. */
  highlightFirst?: boolean;
  /**
   * Lage an einem Element: darunter (Standard) oder rechts daneben wie ein Untermenü, etwa im Branch-Dropdown. Rechts
   * daneben schliesst Pfeil links das Menü.
   */
  placement?: 'below' | 'beside';
  /**
   * Rechts daneben: das Popup, zu dem das Element gehört. Reicht rechts der Platz nicht, geht das Menü links neben dieses
   * Popup statt darüber; passt auch das nicht, liegt es am rechten Rand unter der eigenen Zeile.
   */
  container?: HTMLElement;
  /** Breite der Symbolspalte in Pixeln, etwa 20 für die Farbkürzel der Projekte; sonst 16. */
  iconWidth?: number;
  /** Das Menü schliesst sich (Escape, Klick daneben, Fenster verliert den Fokus oder ändert die Grösse, Eintrag gewählt). */
  onClose(): void;
}

/** Ob ein Eintrag wählbar ist (keine Trennlinie, nicht inaktiv). */
function isSelectable(entry: MenuEntry): entry is Selectable {
  return entry.kind !== 'separator' && !entry.disabled;
}

/**
 * Das Menü hält den Fokus, solange es offen ist; danach gibt `onClose` ihn zurück. Ein gewählter Eintrag läuft erst,
 * nachdem sich das Menü geschlossen hat.
 */
export function Menu({
  label,
  entries,
  anchor,
  highlightFirst = false,
  placement = 'below',
  container,
  iconWidth,
  onClose,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Geschlossen heisst sofort: Bis React das Menü entfernt hat, nimmt es keine Tasten mehr an.
  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    onCloseRef.current();
  };
  const choose = (item: Extract<MenuEntry, { kind: 'item' }>) => {
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

  // Am Anker aufgehen, im Fenster gehalten; dann den Fokus übernehmen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const point = anchor instanceof HTMLElement ? null : anchor;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
    if (r && placement === 'beside') {
      placeBeside(el, r, container?.getBoundingClientRect());
      el.focus({ preventScroll: true });
      return;
    }
    const left = point ? point.x : (r?.left ?? 0);
    let top = point ? point.y : (r?.bottom ?? 0) + GAP;
    // Unten zu wenig Platz: über der Stelle aufgehen, wie unter Windows üblich.
    if (point && top + el.offsetHeight > window.innerHeight - MARGIN) top = point.y - el.offsetHeight;
    el.style.left = `${clamp(left, MARGIN, window.innerWidth - el.offsetWidth - MARGIN)}px`;
    el.style.top = `${clamp(top, MARGIN, window.innerHeight - el.offsetHeight - MARGIN)}px`;
    el.focus({ preventScroll: true });
  }, [anchor, placement, container]);

  // Klick daneben (auch auf die Kopfzeile), Fokusverlust und Grössenänderung schliessen das Menü (Ticket 33, dismiss.ts).
  useDismiss((target) => !!ref.current?.contains(target) || (anchor instanceof HTMLElement && anchor.contains(target)), close);

  return createPortal(
    <MenuPanel
      panelRef={ref}
      label={label}
      entries={entries}
      highlightFirst={highlightFirst}
      iconWidth={iconWidth}
      onCloseSelf={placement === 'beside' ? close : undefined}
      isClosed={() => closed.current}
      onChoose={choose}
      onCloseAll={close}
      onBlur={(next) => {
        // Verlässt der Fokus das Menü (etwa durch ein Tastenkürzel), schliesst es sich; den Fokus auf dem Element, an
        // dem es hängt, regelt dessen Klick (es schaltet das Menü um).
        if (next && (ref.current?.contains(next) || (anchor instanceof HTMLElement && anchor.contains(next)))) return;
        close();
      }}
    />,
    document.body,
  );
}

interface MenuPanelProps {
  label: string;
  entries: MenuEntry[];
  highlightFirst: boolean;
  /** Nur das Hauptmenü: Ref, Fokus und Verlassen des Fokus. */
  panelRef?: React.RefObject<HTMLDivElement | null>;
  onBlur?: (next: Node | null) => void;
  /** Ein Untermenü: Lage neben seinem Eintrag und Schliessen nur dieses Untermenüs. */
  besides?: DOMRect;
  onCloseSelf?: () => void;
  /** Breite der Symbolspalte, falls Einträge Symbole haben. */
  iconWidth?: number;
  isClosed: () => boolean;
  onChoose: (item: Extract<MenuEntry, { kind: 'item' }>) => void;
  onCloseAll: () => void;
}

/** Eine Ebene des Menüs. Tasten bedient immer die innerste offene Ebene. */
function MenuPanel({
  label,
  entries,
  highlightFirst,
  panelRef,
  onBlur,
  besides,
  onCloseSelf,
  iconWidth,
  isClosed,
  onChoose,
  onCloseAll,
}: MenuPanelProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? ownRef;
  const id = useId();
  const selectable = entries.filter(isSelectable);
  const [highlighted, setHighlighted] = useState(highlightFirst && selectable.length > 0 ? 0 : -1);
  const [openSub, setOpenSub] = useState<{ index: number; rect: DOMRect; viaKeyboard: boolean } | null>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());

  // Für die Handler am Fenster: immer der zuletzt angezeigte Stand.
  const current = useRef({ highlighted, selectable, openSub });
  current.current = { highlighted, selectable, openSub };

  const openSubmenu = (index: number, viaKeyboard: boolean) => {
    const button = itemRefs.current.get(index);
    if (button) setOpenSub({ index, rect: button.getBoundingClientRect(), viaKeyboard });
  };

  const activate = (index: number, viaKeyboard: boolean) => {
    const entry = current.current.selectable[index];
    if (!entry) return;
    if (entry.kind === 'submenu') openSubmenu(index, viaKeyboard);
    else onChoose(entry);
  };

  // Ein Untermenü neben seinem Eintrag, im Fenster gehalten (sonst links davon).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && besides) placeBeside(el, besides);
  }, [besides, ref]);

  // Tasten in der Capture-Phase. Ist ein Untermenü offen, bedient es die Tasten selbst.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isClosed() || current.current.openSub) return;
      const { highlighted: h, selectable: list } = current.current;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowRight' && list[h]?.kind === 'submenu') openSubmenu(h, true);
        else if (e.key === 'ArrowLeft') onCloseSelf?.();
        return;
      }
      const action = menuKey(e.key, h, list.length);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.type === 'highlight') setHighlighted(action.index);
      else if (action.type === 'choose') activate(action.index, true);
      else if (e.key === 'Escape' && onCloseSelf) onCloseSelf();
      else onCloseAll();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // Die Handler lesen nur aus Refs.
  }, []);

  const itemId = (index: number) => `${id}-${index}`;
  let index = -1;
  // Die Symbolspalte gibt es nur, wenn ein Eintrag ein Symbol hat; dann ist sie für alle gleich breit.
  const hasIcons = entries.some((entry) => entry.kind !== 'separator' && entry.icon !== undefined);
  const style = hasIcons ? ({ '--menu-icon-width': `${iconWidth ?? 16}px` } as CSSProperties) : undefined;

  return (
    <div
      ref={ref}
      className={hasIcons ? 'menu with-icons' : 'menu'}
      style={style}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={highlighted >= 0 ? itemId(highlighted) : undefined}
      // Klicks ins Menü lassen den Fokus beim Menü.
      onMouseDown={(e) => e.preventDefault()}
      onBlur={onBlur ? (e) => onBlur(e.relatedTarget instanceof Node ? e.relatedTarget : null) : undefined}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={i} className="menu-separator" role="separator" />;
        const own = entry.disabled ? -1 : ++index;
        const isSub = entry.kind === 'submenu';
        const classes = [
          'menu-item',
          own >= 0 && own === highlighted && 'highlighted',
          entry.kind === 'item' && entry.muted && 'muted',
          entry.disabled && 'disabled',
        ].filter(Boolean);
        const shortcut = entry.kind === 'item' ? entry.shortcut : undefined;
        return (
          <button
            key={i}
            ref={(el) => {
              if (el && own >= 0) itemRefs.current.set(own, el);
            }}
            id={own >= 0 ? itemId(own) : undefined}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={classes.join(' ')}
            title={entry.kind === 'item' ? entry.detail : undefined}
            aria-disabled={entry.disabled ? true : undefined}
            aria-haspopup={isSub ? 'menu' : undefined}
            aria-expanded={isSub ? openSub?.index === own : undefined}
            aria-keyshortcuts={shortcut}
            onMouseMove={() => {
              if (own < 0) return;
              setHighlighted(own);
              // Überfahren öffnet ein Untermenü und schliesst ein anderes.
              if (isSub && openSub?.index !== own) openSubmenu(own, false);
              else if (!isSub && openSub) setOpenSub(null);
            }}
            onClick={() => {
              if (own >= 0) activate(own, false);
            }}
          >
            {hasIcons && (
              <span className="menu-item-icon" aria-hidden="true">
                {entry.icon}
              </span>
            )}
            <span className="menu-item-content">
              <span className="menu-item-row">
                <span className="menu-item-label">{entry.label}</span>
                {shortcut && (
                  <span className="menu-item-shortcut" aria-hidden="true">
                    {shortcut}
                  </span>
                )}
                {isSub && <ChevronRightIcon />}
              </span>
              {entry.kind === 'item' && entry.detail && <span className="menu-item-detail">{entry.detail}</span>}
            </span>
          </button>
        );
      })}
      {openSub && selectable[openSub.index]?.kind === 'submenu' && (
        <MenuPanel
          key={openSub.index}
          label={selectable[openSub.index].label}
          entries={(selectable[openSub.index] as Extract<MenuEntry, { kind: 'submenu' }>).entries}
          highlightFirst={openSub.viaKeyboard}
          besides={openSub.rect}
          iconWidth={iconWidth}
          onCloseSelf={() => setOpenSub(null)}
          isClosed={isClosed}
          onChoose={onChoose}
          onCloseAll={onCloseAll}
        />
      )}
    </div>
  );
}

/**
 * Rechts neben einem Eintrag, die erste Zeile auf seiner Höhe. Reicht der Platz nicht, links davon bzw. links neben das
 * ganze Popup `container`; passt auch das nicht, am rechten Rand unter (oder über) der eigenen Zeile, damit sie sichtbar
 * bleibt.
 */
function placeBeside(el: HTMLElement, besides: DOMRect, container?: DOMRect): void {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const maxLeft = window.innerWidth - width - MARGIN;
  const maxTop = window.innerHeight - height - MARGIN;
  let left = besides.right - 2;
  let top = besides.top - 7;
  if (left > maxLeft) {
    left = (container ?? besides).left - width + 2;
    if (container && left < MARGIN) {
      left = maxLeft;
      top = besides.bottom + 2 <= maxTop ? besides.bottom + 2 : besides.top - height - 2;
    }
  }
  el.style.left = `${clamp(left, MARGIN, maxLeft)}px`;
  el.style.top = `${clamp(top, MARGIN, maxTop)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
