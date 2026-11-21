// Projektfenster nach dem neuen IntelliJ: Kopfzeile, links und rechts die Symbolleisten, dazwischen die
// Werkzeugfenster um den Code-Bereich (das untere über die ganze Breite zwischen den Symbolleisten), unten die
// Statusleiste. Welches Werkzeugfenster je Seite aktiv und offen ist und wie gross es ist, speichert der Kern im
// Projekt-Zustand. Die Regeln dazu stehen ohne DOM in toolWindowLayout.ts.

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
import { HideIcon, TOOL_WINDOW_ICONS } from '../icons';
import { commandForKey, shortcutLabel } from '../keymap';
import { isDialogOpen } from '../popup/Dialogs';
import type { RunningWork } from '../progress';
import type { ProjectActions } from '../RecentProjects';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import {
  STRIPES,
  TOOL_WINDOWS,
  dragSize,
  hideSide,
  isShown,
  panelSizes,
  shortcutAction,
  showToolWindow,
  toggleToolWindow,
  visibleLayout,
  withShownSizes,
  type Availability,
  type LayoutArea,
} from './toolWindowLayout';

interface ProjectWindowProps {
  api: CodiumApi;
  project: ProjectInfo;
  actions: ProjectActions;
  work: readonly RunningWork[];
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

export function ProjectWindow({ api, project, actions, work }: ProjectWindowProps) {
  const { layout, layoutRef, change } = useToolWindowLayout(api);
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const areaValue = useRef<LayoutArea | null>(null);
  areaValue.current = area;
  const codeRef = useRef<HTMLElement>(null);
  const panelRefs: Record<ToolWindowSide, RefObject<HTMLElement | null>> = {
    left: useRef<HTMLElement>(null),
    bottom: useRef<HTMLElement>(null),
    right: useRef<HTMLElement>(null),
  };
  const panelRefsValue = useRef(panelRefs);
  panelRefsValue.current = panelRefs;

  /** Das Layout, wie es sich gerade zeigt; Grundlage jeder Änderung. */
  const shownLayout = useCallback((): ToolWindowLayout | null => {
    const current = layoutRef.current;
    return current ? visibleLayout(current, available) : null;
  }, [layoutRef]);

  /** Liegt der Fokus in einem Werkzeugfenster, das gleich verschwindet, geht er in den Code-Bereich. */
  const moveFocusOutOf = useCallback((side: ToolWindowSide) => {
    if (panelRefsValue.current[side].current?.contains(document.activeElement)) codeRef.current?.focus({ preventScroll: true });
  }, []);

  /** Zeigt ein Werkzeugfenster und setzt den Fokus hinein, wie IntelliJ beim Aktivieren eines Werkzeugfensters. */
  const showAndFocus = useCallback(
    (current: ToolWindowLayout, id: ToolWindowId) => {
      // Erst zeichnen, dann den Fokus hinein; so schliesst das nächste Kürzel das Werkzeugfenster wieder.
      flushSync(() => change(showToolWindow(current, id), true));
      panelRefsValue.current[TOOL_WINDOW_SIDE[id]].current?.focus({ preventScroll: true });
    },
    [change],
  );

  /** Klick auf ein Symbol der Symbolleiste: schliesst das sichtbare Werkzeugfenster, sonst zeigt es dieses. */
  const toggle = useCallback(
    (id: ToolWindowId) => {
      const current = shownLayout();
      if (!current) return;
      if (!isShown(current, id)) {
        showAndFocus(current, id);
        return;
      }
      moveFocusOutOf(TOOL_WINDOW_SIDE[id]);
      change(toggleToolWindow(current, id), true);
    },
    [change, moveFocusOutOf, showAndFocus, shownLayout],
  );

  const hide = useCallback(
    (side: ToolWindowSide) => {
      const current = shownLayout();
      if (!current) return;
      moveFocusOutOf(side);
      change(hideSide(current, side), true);
    },
    [change, moveFocusOutOf, shownLayout],
  );

  // Tastenkürzel der Werkzeugfenster, in der Capture-Phase vor allen anderen Belegungen (später Monaco, Terminal).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = commandForKey(e);
      if (!command || isDialogOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const id = command.slice('toolWindow.'.length) as ToolWindowId;
      const current = shownLayout();
      if (!current) return;
      const side = TOOL_WINDOW_SIDE[id];
      const panel = panelRefsValue.current[side];
      const action = shortcutAction(current, id, panel.current?.contains(document.activeElement) ?? false, available);
      if (action === 'show') {
        showAndFocus(current, id);
      } else if (action === 'focus') {
        panel.current?.focus({ preventScroll: true });
      } else if (action === 'hide') {
        moveFocusOutOf(side);
        change(hideSide(current, side), true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [change, moveFocusOutOf, showAndFocus, shownLayout]);

  // Ziehen an einer Trennlinie: begrenzt auf Mindest- und Höchstgrösse, gespeichert beim Loslassen.
  const drag = useRef<{ side: ToolWindowSide; start: number; startSize: number; base: ToolWindowLayout } | null>(null);
  const startDrag = (side: ToolWindowSide, e: ReactPointerEvent<HTMLElement>) => {
    const current = shownLayout();
    const currentArea = areaValue.current;
    if (e.button !== 0 || !current || !currentArea) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Gezogen wird von dem aus, was zu sehen ist (in einem kleinen Fenster kann das weniger sein als gespeichert).
    const base = withShownSizes(current, currentArea);
    drag.current = { side, start: side === 'bottom' ? e.clientY : e.clientX, startSize: base[side].size, base };
    document.body.classList.add(side === 'bottom' ? 'resizing-rows' : 'resizing-columns');
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const currentArea = areaValue.current;
    if (!d || !currentArea) return;
    const delta = (d.side === 'bottom' ? e.clientY : e.clientX) - d.start;
    // Links wächst nach rechts, rechts nach links, unten nach oben.
    const requested = d.side === 'left' ? d.startSize + delta : d.startSize - delta;
    const size = dragSize(d.side, requested, d.base, currentArea);
    change({ ...d.base, [d.side]: { ...d.base[d.side], size } }, false);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('resizing-rows', 'resizing-columns');
    if (layoutRef.current) change(layoutRef.current, true);
  };
  const splitter = (side: ToolWindowSide, title: string) => (
    <div
      className={`splitter splitter-${side}`}
      role="separator"
      aria-orientation={side === 'bottom' ? 'horizontal' : 'vertical'}
      aria-label={`Resize ${title}`}
      onPointerDown={(e) => startDrag(side, e)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
    />
  );

  const shown = layout ? visibleLayout(layout, available) : null;
  const sizes = shown && area ? panelSizes(shown, area) : null;
  const panel = (side: ToolWindowSide) => {
    if (!shown || !sizes || !shown[side].open) return null;
    const def = TOOL_WINDOWS[shown[side].active];
    return (
      <section
        ref={panelRefs[side]}
        className={`tool-window tool-window-${side}`}
        style={side === 'bottom' ? { height: sizes.bottom } : { width: sizes[side] }}
        aria-label={def.title}
        tabIndex={-1}
      >
        <div className="tool-window-header">
          <span className="tool-window-title">{def.title}</span>
          <button type="button" className="icon-button" aria-label="Hide" title="Hide" onClick={() => hide(side)}>
            <HideIcon />
          </button>
        </div>
        <div className="tool-window-body">
          <p className="tool-window-placeholder">{def.placeholder}</p>
        </div>
        {splitter(side, def.title)}
      </section>
    );
  };

  return (
    <div className="project-window">
      <Header project={project} actions={actions} onExit={() => void api.request('app.exit')} />
      <div className="workbench">
        <Stripe side="left" groups={[STRIPES.left.top, STRIPES.left.bottom]} layout={shown} onToggle={toggle} />
        <div className="tool-area" ref={areaRef}>
          <div className="tool-area-row">
            {panel('left')}
            <CodeArea codeRef={codeRef} />
            {panel('right')}
          </div>
          {panel('bottom')}
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
