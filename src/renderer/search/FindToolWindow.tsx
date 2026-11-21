// Werkzeugfenster „Find“ unten: abgelegte Trefferlisten der Projektsuche (ab Ticket 12 auch Verwendungen), jede als
// eigener Reiter. Die Treffer stehen nach Dateien gruppiert; Doppelklick oder Enter öffnet die Fundstelle.

import { useMemo, useState } from 'react';
import type { ProjectInfo, SearchMatch } from '../../shared/types';
import { CloseIcon, FileIcon } from '../icons';
import { ToolWindowHeader } from '../project/ToolWindowHeader';
import { baseName, parentPath, relativeLabel } from '../project/filePaths';
import { groupByFile, matchParts } from './searchResults';

/** Ein Reiter im Werkzeugfenster „Find“. */
export interface FindTab {
  id: number;
  title: string;
  matches: SearchMatch[];
  limitReached: boolean;
}

interface FindToolWindowProps {
  project: ProjectInfo;
  tabs: readonly FindTab[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCloseTab: (id: number) => void;
  onOpenMatch: (match: SearchMatch) => void;
  onHide: () => void;
}

export function FindToolWindow({ project, tabs, activeId, onSelect, onCloseTab, onOpenMatch, onHide }: FindToolWindowProps) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  return (
    <>
      <ToolWindowHeader title="Find" onHide={onHide}>
        <div className="find-tabs" role="tablist" aria-label="Find Results">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab === active}
              aria-label={tab.title}
              className={`find-tab${tab === active ? ' active' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 0) onSelect(tab.id);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) onCloseTab(tab.id);
              }}
            >
              <span>{tab.title}</span>
              <button type="button" className="find-tab-close" aria-label={`Close ${tab.title}`} title="Close" onClick={() => onCloseTab(tab.id)}>
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      </ToolWindowHeader>
      <div className="tool-window-body find-body">{active && <FindResults key={active.id} project={project} tab={active} onOpenMatch={onOpenMatch} />}</div>
    </>
  );
}

function FindResults({ project, tab, onOpenMatch }: { project: ProjectInfo; tab: FindTab; onOpenMatch: (match: SearchMatch) => void }) {
  const groups = useMemo(() => groupByFile(tab.matches), [tab.matches]);
  const rows = useMemo(() => groups.flatMap((g) => [{ kind: 'file' as const, group: g }, ...g.matches.map((m) => ({ kind: 'match' as const, match: m }))]), [groups]);
  const [selected, setSelected] = useState(rows.findIndex((r) => r.kind === 'match'));
  return (
    <div
      className="find-results"
      role="tree"
      aria-label="Find Results List"
      tabIndex={0}
      data-autofocus=""
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          let next = selected + step;
          while (next >= 0 && next < rows.length && rows[next].kind !== 'match') next += step;
          if (next >= 0 && next < rows.length) setSelected(next);
        } else if (e.key === 'Enter') {
          const row = rows[selected];
          if (row?.kind === 'match') onOpenMatch(row.match);
        }
      }}
    >
      <p className="find-summary">
        {`${tab.matches.length}${tab.limitReached ? '+' : ''} matches in ${groups.length} ${groups.length === 1 ? 'file' : 'files'}`}
        {tab.limitReached && ' (more results)'}
      </p>
      {rows.map((row, i) =>
        row.kind === 'file' ? (
          <div key={`f:${row.group.path}`} role="treeitem" aria-expanded className="find-file-row" aria-label={baseName(row.group.path)}>
            <FileIcon />
            <span className="find-file-name">{baseName(row.group.path)}</span>
            <span className="quick-popup-detail">{relativeLabel(project.path, parentPath(row.group.path))}</span>
            <span className="quick-popup-detail">{row.group.matches.length}</span>
          </div>
        ) : (
          <div
            key={`m:${row.match.path}:${row.match.line}:${row.match.column}`}
            role="treeitem"
            aria-selected={i === selected}
            className={`find-match-row${i === selected ? ' selected' : ''}`}
            onMouseDown={() => setSelected(i)}
            onDoubleClick={() => onOpenMatch(row.match)}
          >
            <span className="find-match-position">{row.match.line}</span>
            <span className="find-popup-line">
              {matchParts(row.match).map((part, j) => (part.marked ? <mark key={j}>{part.text}</mark> : <span key={j}>{part.text}</span>))}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
