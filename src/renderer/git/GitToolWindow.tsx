// Werkzeugfenster „Git“ (Ticket 15) mit den Reitern „Log“ (Platzhalter bis Ticket 19) und „Console“: jeder Git-Aufruf
// mit Zeitpunkt, Befehl, Ausgabe und Exit-Code, die letzten 1'000, nicht gespeichert. Standardmässig sichtbar sind vom
// Nutzer ausgelöste, schreibende und Netzwerk-Befehle; „Show background commands“ blendet die Abfragen dazu.

import { useEffect, useRef, useState } from 'react';
import type { CodiumApi, GitConsoleEntry, GitState } from '../../shared/types';
import { ToolWindowHeader } from '../project/ToolWindowHeader';
import { GIT_NOT_FOUND_TEXT } from './gitState';

interface GitToolWindowProps {
  api: CodiumApi;
  state: GitState | null;
  /** `false`: Git fehlt (Hinweis statt „Not a Git repository“). */
  gitAvailable?: boolean | null;
  onHide: () => void;
}

/** So viele Einträge hält auch die Oberfläche (wie der Kern). */
const LIMIT = 1000;

export function GitToolWindow({ api, state, gitAvailable, onHide }: GitToolWindowProps) {
  const [tab, setTab] = useState<'log' | 'console'>('console');
  const entries = useConsole(api);
  const [background, setBackground] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = entries.filter((e) => background || !e.background);

  // Neue Einträge: ans Ende scrollen, wenn man schon unten war.
  const atEnd = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (list && atEnd.current) list.scrollTop = list.scrollHeight;
  }, [shown.length, tab]);

  return (
    <>
      <ToolWindowHeader title="Git" onHide={onHide}>
        <div className="find-tabs" role="tablist" aria-label="Git">
          {(['log', 'console'] as const).map((id) => (
            <div
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`find-tab${tab === id ? ' active' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 0) setTab(id);
              }}
            >
              <span>{id === 'log' ? 'Log' : 'Console'}</span>
            </div>
          ))}
        </div>
      </ToolWindowHeader>
      <div className="tool-window-body git-body">
        {gitAvailable === false ? (
          <p className="tool-window-placeholder">{GIT_NOT_FOUND_TEXT}</p>
        ) : state && !state.repository ? (
          <p className="tool-window-placeholder">Not a Git repository</p>
        ) : tab === 'log' ? (
          <p className="tool-window-placeholder">The Git log will appear here.</p>
        ) : (
          <>
            <label className="git-console-option">
              <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
              Show background commands
            </label>
            <div
              ref={listRef}
              className="git-console"
              role="log"
              aria-label="Git Console"
              onScroll={(e) => {
                const el = e.currentTarget;
                atEnd.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
              }}
            >
              {shown.map((entry) => (
                <div key={entry.id} className={`git-console-entry${entry.exitCode !== null && entry.exitCode !== 0 ? ' failed' : ''}`} data-background={entry.background || undefined}>
                  <div className="git-console-command">
                    <span className="git-console-time">{time(entry.time)}</span>
                    <span>{entry.command}</span>
                    <span className="git-console-exit">{entry.exitCode === null ? '…' : `exit ${entry.exitCode}`}</span>
                  </div>
                  {entry.output && <pre className="git-console-output">{entry.output}</pre>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Die Einträge der Git-Konsole: zuerst die bisherigen, dann neue und fertige aus den Ereignissen. */
function useConsole(api: CodiumApi): GitConsoleEntry[] {
  const [entries, setEntries] = useState<GitConsoleEntry[]>([]);
  useEffect(() => {
    let live = true;
    const merge = (incoming: GitConsoleEntry[]) =>
      setEntries((current) => {
        const byId = new Map(current.map((e) => [e.id, e]));
        for (const entry of incoming) byId.set(entry.id, entry);
        return [...byId.values()].sort((a, b) => a.id - b.id).slice(-LIMIT);
      });
    const off = api.on('git.console', (entry) => merge([entry]));
    api.request('git.console').then(
      (all) => {
        if (live) merge(all);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [api]);
  return entries;
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
}
