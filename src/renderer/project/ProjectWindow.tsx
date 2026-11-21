// Projektfenster nach dem neuen IntelliJ: Kopfzeile, links und rechts die Symbolleisten, dazwischen die
// Werkzeugfenster um den Code-Bereich (das untere über die ganze Breite zwischen den Symbolleisten), unten die
// Statusleiste. Welches Werkzeugfenster je Seite aktiv und offen ist und wie gross es ist, speichert der Kern im
// Projekt-Zustand. Die Regeln dazu stehen ohne DOM in toolWindowLayout.ts.
//
// Ein Werkzeugfenster bleibt nach dem ersten Öffnen eingehängt und wird beim Schliessen nur verborgen, wie in
// IntelliJ: Dateibaum, Terminal und Log behalten so ihren Zustand.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  TOOL_WINDOW_SIDE,
  type CodiumApi,
  type ProjectInfo,
  type ToolWindowId,
  type ToolWindowLayout,
  type ToolWindowSide,
} from '../../shared/types';
import { TOOL_WINDOW_ICONS } from '../icons';
import { commandForKey, shortcutLabel } from '../keymap';
import type { Notify } from '../Notices';
import { isDialogOpen } from '../popup/Dialogs';
import { closeOpenMenus } from '../popup/Menu';
import type { RunningWork } from '../progress';
import type { ProjectActions } from '../RecentProjects';
import { Header } from './Header';
import { ProjectView } from './ProjectView';
import { StatusBar } from './StatusBar';
import { ToolWindowHeader } from './ToolWindowHeader';
import {
  STRIPES,
  TOOL_WINDOWS,
  beginResize,
  hideSide,
  isShown,
  panelSizes,
  resizeTo,
  shortcutAction,
  showToolWindow,
  toggleToolWindow,
  toolWindowsOn,
  visibleLayout,
  type Availability,
  type LayoutArea,
  type WidthPriority,
} from './toolWindowLayout';

interface ProjectWindowProps {
  api: CodiumApi;
  project: ProjectInfo;
  actions: ProjectActions;
  work: readonly RunningWork[];
  notify: Notify;
}

/** Name des Ereignisses am Dokument, mit dem der Dateibaum „Datei öffnen“ meldet (Nutzlast `{ path }`). */
export const OPEN_FILE_EVENT = 'codium:open-file';

/**
 * „Datei öffnen“ aus dem Dateibaum (Doppelklick, Enter, neue Datei). Ticket 05 öffnet hier einen Tab; bis dahin geht
 * die Anfrage als Ereignis an das Dokument, wo Tests sie sehen.
 */
function requestOpenFile(path: string): void {
  document.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { path } }));
}

/** Setzt den Fokus in ein Werkzeugfenster: auf sein Hauptelement (etwa den Dateibaum), sonst auf das Fenster selbst. */
function focusToolWindow(section: HTMLElement | undefined): void {
  (section?.querySelector<HTMLElement>('[data-autofocus]') ?? section)?.focus({ preventScroll: true });
}

/**
 * Welche Werkzeugfenster verfügbar sind. „Find“ hat erst mit Ticket 08 Inhalt (abgelegte Projektsuchen,
 * Verwendungen) und erscheint bis dahin nie.
 */
const available: Availability = (id) => id !== 'find';

/** Layout, falls der Kern keines liefert (das Fenster schliesst sich gerade): alle Seiten zu. */
const CLOSED_LAYOUT: ToolWindowLayout = {
  left: { active: 'project', open: false, size: 280 },
  bottom: { active: 'terminal', open: false, size: 260 },
  right: { active: 'database', open: false, size: 320 },
};

const RESIZE_CLASSES = ['resizing-rows', 'resizing-columns'];

/** Ein laufendes Ziehen an einer Trennlinie. */
interface ActiveDrag {
  side: ToolWindowSide;
  /** Meldet die Ereignisse am Fenster wieder ab und gibt den Zeiger frei. */
  release: () => void;
}

export function ProjectWindow({ api, project, actions, work, notify }: ProjectWindowProps) {
  const { layout, layoutRef, change } = useToolWindowLayout(api);
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const areaValue = useRef<LayoutArea | null>(null);
  areaValue.current = area;
  const codeRef = useRef<HTMLElement>(null);
  /** Die eingehängten Werkzeugfenster und die Flächen der Seiten, für den Fokus. */
  const sections = useRef(new Map<ToolWindowId, HTMLElement>());
  const sides = useRef(new Map<ToolWindowSide, HTMLElement>());
  /** Werkzeugfenster, die schon einmal offen waren; sie bleiben eingehängt. */
  const mounted = useRef(new Set<ToolWindowId>());
  /**
   * Die zuletzt gezogene Seite links oder rechts; bei Platzmangel weicht zuerst die andere (wie in IntelliJ). Sie gilt
   * nur, solange das Fenster offen ist, und wird nicht gespeichert.
   */
  const [priority, setPriority] = useState<WidthPriority>(null);
  const drag = useRef<ActiveDrag | null>(null);

  /** Das Layout, wie es sich gerade zeigt; Grundlage jeder Änderung. */
  const shownLayout = useCallback((): ToolWindowLayout | null => {
    const current = layoutRef.current;
    return current ? visibleLayout(current, available) : null;
  }, [layoutRef]);

  /** Beendet ein laufendes Ziehen und speichert, was bis dahin gezogen wurde. */
  const stopDrag = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    active.release();
    document.body.classList.remove(...RESIZE_CLASSES);
    if (layoutRef.current) change(layoutRef.current, true);
  }, [change, layoutRef]);

  // Verschwindet das Fenster während des Ziehens, nichts zurücklassen.
  useEffect(
    () => () => {
      drag.current?.release();
      drag.current = null;
      document.body.classList.remove(...RESIZE_CLASSES);
    },
    [],
  );

  /** Liegt der Fokus auf einer Seite, die gleich verschwindet, geht er in den Code-Bereich. */
  const moveFocusOutOf = useCallback((side: ToolWindowSide) => {
    if (sides.current.get(side)?.contains(document.activeElement)) codeRef.current?.focus({ preventScroll: true });
  }, []);

  /** Zeigt ein Werkzeugfenster und setzt den Fokus hinein, wie IntelliJ beim Aktivieren eines Werkzeugfensters. */
  const showAndFocus = useCallback(
    (current: ToolWindowLayout, id: ToolWindowId) => {
      // Erst zeichnen, dann den Fokus hinein; so schliesst das nächste Kürzel das Werkzeugfenster wieder.
      flushSync(() => change(showToolWindow(current, id), true));
      focusToolWindow(sections.current.get(id));
    },
    [change],
  );

  /** Klick auf ein Symbol der Symbolleiste: schliesst das sichtbare Werkzeugfenster, sonst zeigt es dieses. */
  const toggle = useCallback(
    (id: ToolWindowId) => {
      stopDrag();
      const current = shownLayout();
      if (!current) return;
      if (!isShown(current, id)) {
        showAndFocus(current, id);
        return;
      }
      moveFocusOutOf(TOOL_WINDOW_SIDE[id]);
      change(toggleToolWindow(current, id), true);
    },
    [change, moveFocusOutOf, showAndFocus, shownLayout, stopDrag],
  );

  const hide = useCallback(
    (side: ToolWindowSide) => {
      stopDrag();
      const current = shownLayout();
      if (!current) return;
      moveFocusOutOf(side);
      change(hideSide(current, side), true);
    },
    [change, moveFocusOutOf, shownLayout, stopDrag],
  );

  // Tastenkürzel der Werkzeugfenster, in der Capture-Phase vor allen anderen Belegungen (später Monaco, Terminal).
  // Während einer Rückfrage ruhen sie; ein offenes Menü schliessen sie zuerst, sonst nähme es weiter Tasten an.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = commandForKey(e);
      if (!command || isDialogOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      closeOpenMenus();
      stopDrag();
      const id = command.slice('toolWindow.'.length) as ToolWindowId;
      const current = shownLayout();
      if (!current) return;
      const side = TOOL_WINDOW_SIDE[id];
      const section = sections.current.get(id);
      const action = shortcutAction(current, id, section?.contains(document.activeElement) ?? false, available);
      if (action === 'show') {
        showAndFocus(current, id);
      } else if (action === 'focus') {
        focusToolWindow(section);
      } else if (action === 'hide') {
        moveFocusOutOf(side);
        change(hideSide(current, side), true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [change, moveFocusOutOf, showAndFocus, shownLayout, stopDrag]);

  // Ziehen an einer Trennlinie: begrenzt auf Mindest- und Höchstgrösse, gespeichert beim Loslassen. Bewegung und
  // Loslassen kommen über das Fenster, damit das Ziehen auch endet, wenn die Trennlinie dabei verschwindet.
  const startDrag = (side: ToolWindowSide, e: ReactPointerEvent<HTMLElement>) => {
    const current = shownLayout();
    const currentArea = areaValue.current;
    if (e.button !== 0 || !current || !currentArea || drag.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    handle.setPointerCapture(pointerId);
    // Gezogen wird von der angezeigten Grösse aus; ab jetzt hat die gezogene Seite Vorrang, wenn der Platz nicht reicht.
    const resize = beginResize(current, side, currentArea, priority);
    if (side !== 'bottom') setPriority(side);
    const start = side === 'bottom' ? e.clientY : e.clientX;
    const onMove = (ev: PointerEvent) => {
      const latestArea = areaValue.current;
      if (ev.pointerId !== pointerId || !latestArea) return;
      const delta = (side === 'bottom' ? ev.clientY : ev.clientX) - start;
      // Links wächst nach rechts, rechts nach links, unten nach oben.
      const requested = side === 'left' ? resize.startSize + delta : resize.startSize - delta;
      change(resizeTo(resize, requested, latestArea), false);
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stopDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    drag.current = {
      side,
      release: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        if (handle.isConnected && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      },
    };
    document.body.classList.add(side === 'bottom' ? 'resizing-rows' : 'resizing-columns');
  };

  const shown = layout ? visibleLayout(layout, available) : null;
  const sizes = shown && area ? panelSizes(shown, area, priority) : null;
  if (shown && sizes) for (const s of ['left', 'bottom', 'right'] as const) if (shown[s].open) mounted.current.add(shown[s].active);

  const side = (s: ToolWindowSide) => {
    const ids = toolWindowsOn(s).filter((id) => mounted.current.has(id));
    if (!shown || !sizes || ids.length === 0) return null;
    const { open, active } = shown[s];
    const title = TOOL_WINDOWS[active].title;
    return (
      <div
        ref={(el) => {
          if (el) sides.current.set(s, el);
          else sides.current.delete(s);
        }}
        className={`tool-window-side tool-window-${s}`}
        style={s === 'bottom' ? { height: sizes.bottom } : { width: sizes[s] }}
        hidden={!open}
      >
        {ids.map((id) => (
          <section
            key={id}
            ref={(el) => {
              if (el) sections.current.set(id, el);
              else sections.current.delete(id);
            }}
            className="tool-window"
            aria-label={TOOL_WINDOWS[id].title}
            tabIndex={-1}
            hidden={!open || active !== id}
          >
            {id === 'project' ? (
              <ProjectView api={api} project={project} notify={notify} onHide={() => hide(s)} onOpenFile={requestOpenFile} />
            ) : (
              <>
                <ToolWindowHeader title={TOOL_WINDOWS[id].title} onHide={() => hide(s)} />
                <div className="tool-window-body">
                  <p className="tool-window-placeholder">{TOOL_WINDOWS[id].placeholder}</p>
                </div>
              </>
            )}
          </section>
        ))}
        {open && (
          <div
            className={`splitter splitter-${s}`}
            role="separator"
            aria-orientation={s === 'bottom' ? 'horizontal' : 'vertical'}
            aria-label={`Resize ${title}`}
            onPointerDown={(e) => startDrag(s, e)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="project-window">
      <Header project={project} actions={actions} onExit={() => void api.request('app.exit')} />
      <div className="workbench">
        <Stripe side="left" groups={[STRIPES.left.top, STRIPES.left.bottom]} layout={shown} onToggle={toggle} />
        <div className="tool-area" ref={areaRef}>
          <div className="tool-area-row">
            {side('left')}
            <CodeArea codeRef={codeRef} />
            {side('right')}
          </div>
          {side('bottom')}
        </div>
        <Stripe side="right" groups={[STRIPES.right.top, []]} layout={shown} onToggle={toggle} />
      </div>
      <StatusBar work={work} />
    </div>
  );
}

/** Das Layout der Werkzeugfenster: vom Kern geladen, bei jeder Änderung angezeigt und auf Wunsch gespeichert. */
function useToolWindowLayout(api: CodiumApi) {
  const [layout, setLayout] = useState<ToolWindowLayout | null>(null);
  const layoutRef = useRef<ToolWindowLayout | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (loaded: ToolWindowLayout) => {
      if (!active || layoutRef.current !== null) return;
      layoutRef.current = loaded;
      setLayout(loaded);
    };
    api.request('project.layout').then(apply, (err: unknown) => {
      console.error('Layout der Werkzeugfenster nicht geladen:', err);
      apply(CLOSED_LAYOUT);
    });
    return () => {
      active = false;
    };
  }, [api]);

  /**
   * Zeigt ein neues Layout und speichert es mit `persist` gleich im Kern; die Anfrage geht noch im selben Ereignis
   * weg, damit ein unmittelbar folgendes „Exit“ sie nicht überholt.
   */
  const change = useCallback(
    (next: ToolWindowLayout, persist: boolean) => {
      layoutRef.current = next;
      setLayout(next);
      if (persist) api.request('project.setLayout', next).catch((err: unknown) => console.error('Layout nicht gespeichert:', err));
    },
    [api],
  );

  return { layout, layoutRef, change };
}

/** Grösse eines Elements, gemessen vor dem ersten Zeichnen und bei jeder Änderung. */
function useElementSize(ref: RefObject<HTMLElement | null>): LayoutArea | null {
  const [size, setSize] = useState<LayoutArea | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((old) => (old && old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

interface StripeProps {
  side: 'left' | 'right';
  /** Obere und untere Gruppe der Symbolleiste. */
  groups: [ToolWindowId[], ToolWindowId[]];
  layout: ToolWindowLayout | null;
  onToggle: (id: ToolWindowId) => void;
}

function Stripe({ side, groups, layout, onToggle }: StripeProps) {
  return (
    <nav className={`stripe stripe-${side}`} aria-label={side === 'left' ? 'Left Tool Windows' : 'Right Tool Windows'}>
      {groups.map((ids, i) => (
        <div key={i} className="stripe-group">
          {ids.filter(available).map((id) => {
            const def = TOOL_WINDOWS[id];
            const Icon = TOOL_WINDOW_ICONS[id];
            const shown = layout !== null && isShown(layout, id);
            return (
              <button
                key={id}
                type="button"
                className={shown ? 'stripe-button active' : 'stripe-button'}
                aria-label={def.title}
                aria-pressed={shown}
                title={def.shortcut ? `${def.title} (${def.shortcut})` : def.title}
                disabled={layout === null}
                onClick={() => onToggle(id)}
              >
                <Icon />
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Kürzel, die der leere Code-Bereich als Hinweis zeigt, wie IntelliJ. */
const CODE_HINTS = [
  { label: 'Project View', command: 'toolWindow.project' },
  { label: 'Commit', command: 'toolWindow.commit' },
  { label: 'Terminal', command: 'toolWindow.terminal' },
  { label: 'Git', command: 'toolWindow.git' },
] as const;

/** Code-Bereich in der Mitte, vorerst ohne Tabs (Ticket 05). */
function CodeArea({ codeRef }: { codeRef: RefObject<HTMLElement | null> }) {
  return (
    <main ref={codeRef} className="code-area" tabIndex={-1} aria-label="Editor">
      <div className="code-empty">
        <p className="code-empty-title">No files are open</p>
        <dl className="code-empty-hints">
          {CODE_HINTS.map((hint) => (
            <div key={hint.command} className="code-empty-hint">
              <dt>{hint.label}</dt>
              <dd>
                <kbd>{shortcutLabel(hint.command)}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
