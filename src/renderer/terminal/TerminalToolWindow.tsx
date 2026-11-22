// Werkzeugfenster „Terminal“ (Ticket 11): Terminals mit xterm.js in Tabs, die Shells laufen im Terminal-Dienst des
// Kerns. Wie in IntelliJ:
// - „+“ öffnet ein weiteres Terminal; die Tabs heissen „Local“, „Local (2)“ … und lassen sich per Doppelklick umbenennen.
// - Schliessen beendet die Shell samt Prozessbaum; endet eine Shell selbst (etwa mit `exit`), schliesst ihr Tab. Mit
//   dem letzten Tab verschwindet das Werkzeugfenster.
// - Ist das Werkzeugfenster beim Zeigen leer, startet ein Terminal im Projektordner.
// - Alle Tasten gehören der Shell, ausser den Kürzeln für Werkzeugfenster und Einstellungen (keymap.ts). Esc bleibt
//   bei der Shell.
// - Das Terminal passt sich der Grösse des Werkzeugfensters an.
// Die Tabs leben, solange das Fenster offen ist, auch wenn das Werkzeugfenster zu ist; nach einem Neustart gibt es keine.

import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CodiumApi } from '../../shared/types';
import { errorText } from '../errors';
import { CloseIcon, PlusIcon } from '../icons';
import { bindingForKey } from '../keymap';
import { ToolWindowHeader } from '../project/ToolWindowHeader';
import { terminalTheme } from './terminalTheme';
import { nextTerminalTitle } from './terminalTitles';

export interface TerminalToolWindowHandle {
  /** Öffnet ein weiteres Terminal, wahlweise in einem Ordner (bzw. im Ordner einer Datei). */
  open(cwd?: string): void;
}

interface TerminalToolWindowProps {
  api: CodiumApi;
  /** Ob das Werkzeugfenster gerade zu sehen ist. */
  visible: boolean;
  fontSize: number;
  onHide: () => void;
  notify: (notice: { level: 'error'; text: string }) => void;
}

interface TerminalTab {
  key: number;
  title: string;
  cwd?: string;
}

export const TerminalToolWindow = forwardRef<TerminalToolWindowHandle, TerminalToolWindowProps>(function TerminalToolWindow(
  { api, visible, fontSize, onHide, notify },
  ref,
) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const nextKey = useRef(1);
  const views = useRef(new Map<number, TerminalViewHandle>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const add = useCallback((cwd?: string) => {
    const key = nextKey.current++;
    setTabs((current) => [...current, { key, title: nextTerminalTitle(current.map((t) => t.title)), ...(cwd ? { cwd } : {}) }]);
    setActive(key);
  }, []);

  useImperativeHandle(ref, () => ({ open: (cwd) => add(cwd) }), [add]);

  // Beim Zeigen ohne Terminal: eines im Projektordner.
  useEffect(() => {
    if (visible && tabsRef.current.length === 0) add();
  }, [visible, add]);

  // Das aktive Terminal bekommt den Fokus, wenn das Werkzeugfenster erscheint oder der Tab wechselt.
  useEffect(() => {
    if (visible && active !== null) views.current.get(active)?.focus();
  }, [visible, active]);

  const remove = useCallback(
    (key: number) => {
      const remaining = tabsRef.current.filter((t) => t.key !== key);
      const index = tabsRef.current.findIndex((t) => t.key === key);
      setTabs(remaining);
      setActive((current) => (current !== key ? current : (remaining[Math.min(index, remaining.length - 1)]?.key ?? null)));
      if (remaining.length === 0) onHide();
    },
    [onHide],
  );

  const rename = (key: number, title: string) => {
    const trimmed = title.trim();
    if (trimmed !== '') setTabs((current) => current.map((t) => (t.key === key ? { ...t, title: trimmed } : t)));
    setRenaming(null);
  };

  return (
    <>
      <ToolWindowHeader title="Terminal" onHide={onHide}>
        <div className="terminal-tabs" role="tablist" aria-label="Terminals">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              role="tab"
              aria-selected={tab.key === active}
              aria-label={tab.title}
              className={`find-tab${tab.key === active ? ' active' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 0 && renaming !== tab.key) setActive(tab.key);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) views.current.get(tab.key)?.close();
              }}
              onDoubleClick={() => setRenaming(tab.key)}
            >
              {renaming === tab.key ? (
                <input
                  className="terminal-tab-rename"
                  aria-label="Rename Terminal"
                  defaultValue={tab.title}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => rename(tab.key, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') rename(tab.key, e.currentTarget.value);
                    else if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span>{tab.title}</span>
              )}
              <button
                type="button"
                className="find-tab-close"
                aria-label={`Close ${tab.title}`}
                title="Close"
                onClick={() => views.current.get(tab.key)?.close()}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          <button type="button" className="icon-button" aria-label="New Terminal" title="New Terminal" onClick={() => add()}>
            <PlusIcon />
          </button>
        </div>
      </ToolWindowHeader>
      <div
        className="tool-window-body terminal-body"
        tabIndex={-1}
        data-autofocus
        onFocus={(e) => {
          if (e.target === e.currentTarget && active !== null) views.current.get(active)?.focus();
        }}
      >
        {tabs.map((tab) => (
          <TerminalView
            key={tab.key}
            ref={(handle) => {
              if (handle) views.current.set(tab.key, handle);
              else views.current.delete(tab.key);
            }}
            api={api}
            cwd={tab.cwd}
            title={tab.title}
            shown={visible && tab.key === active}
            fontSize={fontSize}
            onClosed={() => remove(tab.key)}
            onFailed={(err) => {
              notify({ level: 'error', text: `The terminal could not start: ${errorText(err)}` });
              remove(tab.key);
            }}
          />
        ))}
      </div>
    </>
  );
});

interface TerminalViewHandle {
  focus(): void;
  /** Beendet die Shell (samt Prozessbaum) und schliesst den Tab. */
  close(): void;
}

interface TerminalViewProps {
  api: CodiumApi;
  cwd?: string;
  title: string;
  shown: boolean;
  fontSize: number;
  onClosed: () => void;
  onFailed: (err: unknown) => void;
}

/** Ein Terminal: xterm.js, verbunden mit einer Shell im Kern. */
const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { api, cwd, title, shown, fontSize, onClosed, onFailed },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const terminalId = useRef<number | null>(null);
  const closed = useRef(false);
  const callbacks = useRef({ onClosed, onFailed });
  callbacks.current = { onClosed, onFailed };

  const finish = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    callbacks.current.onClosed();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => term.current?.focus(),
      close: () => {
        const id = terminalId.current;
        if (id !== null) void api.request('terminal.close', { terminalId: id }).catch(() => {});
        finish();
      },
    }),
    [api, finish],
  );

  useEffect(() => {
    const host = hostRef.current!;
    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize,
      theme: terminalTheme,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    term.current = terminal;
    fit.current = fitAddon;
    // Kürzel für Werkzeugfenster und Einstellungen gehören der IDE (das Projektfenster nimmt sie in der
    // Capture-Phase); alle anderen Tasten bekommt die Shell, auch Esc.
    terminal.attachCustomKeyEventHandler((e) => !(bindingForKey(e)?.global ?? false));

    let disposed = false;
    /** Ausgabe, die kommt, bevor die Kennung bekannt ist. */
    const early = new Map<number, string[]>();
    const offData = api.on('terminal.data', ({ terminalId: id, data }) => {
      if (id === terminalId.current) terminal.write(data);
      else if (terminalId.current === null) early.set(id, [...(early.get(id) ?? []), data]);
    });
    const offExit = api.on('terminal.exit', ({ terminalId: id }) => {
      if (id === terminalId.current) finish();
      else if (terminalId.current === null) early.set(id, [...(early.get(id) ?? []), '\u0000exit']);
    });
    const input = terminal.onData((data) => {
      const id = terminalId.current;
      if (id !== null) void api.request('terminal.write', { terminalId: id, data }).catch(() => {});
    });
    const resized = terminal.onResize(({ cols, rows }) => {
      const id = terminalId.current;
      if (id !== null) void api.request('terminal.resize', { terminalId: id, cols, rows }).catch(() => {});
    });

    // Grösse nach dem ersten Zeichnen, dann starten.
    try {
      fitAddon.fit();
    } catch {
      // Noch unsichtbar: Standardgrösse.
    }
    api.request('terminal.start', { ...(cwd ? { cwd } : {}), cols: terminal.cols, rows: terminal.rows }).then(
      (started) => {
        if (disposed) {
          void api.request('terminal.close', { terminalId: started.terminalId }).catch(() => {});
          return;
        }
        terminalId.current = started.terminalId;
        for (const chunk of early.get(started.terminalId) ?? []) {
          if (chunk === '\u0000exit') finish();
          else terminal.write(chunk);
        }
        early.clear();
      },
      (err: unknown) => {
        if (!disposed) callbacks.current.onFailed(err);
      },
    );

    const observer = new ResizeObserver(() => {
      if (host.offsetParent === null) return;
      try {
        fitAddon.fit();
      } catch {
        // Unsichtbar: beim nächsten Mal.
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      offData();
      offExit();
      input.dispose();
      resized.dispose();
      // Ein Tab, der verschwindet, ohne geschlossen worden zu sein (etwa beim Schliessen des Fensters), beendet seine
      // Shell ebenso; der Kern tut das beim Abbau ohnehin.
      const id = terminalId.current;
      if (id !== null && !closed.current) void api.request('terminal.close', { terminalId: id }).catch(() => {});
      terminal.dispose();
      term.current = null;
    };
    // Nur beim Anlegen; die Schriftgrösse folgt unten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal || terminal.options.fontSize === fontSize) return;
    terminal.options.fontSize = fontSize;
    try {
      fit.current?.fit();
    } catch {
      // Unsichtbar.
    }
  }, [fontSize]);

  // Sichtbar geworden: an die Grösse anpassen.
  useEffect(() => {
    if (!shown) return;
    try {
      fit.current?.fit();
    } catch {
      // Noch nicht gezeichnet.
    }
  }, [shown]);

  return <div ref={hostRef} className="terminal-view" role="region" aria-label={`Shell: ${title}`} hidden={!shown} />;
});
