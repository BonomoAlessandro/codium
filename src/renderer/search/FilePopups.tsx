// Suche nach Namen (Ctrl + Shift + N) und zuletzt geöffnete Dateien (Ctrl + E): eine Eingabe, darunter die Treffer;
// Pfeiltasten wählen, Enter oder Doppelklick öffnet.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CodiumApi, FileNameMatch, ProjectInfo } from '../../shared/types';
import { FileIcon } from '../icons';
import { baseName, parentPath, relativeLabel } from '../project/filePaths';
import { QuickPopup } from './QuickPopup';
import { markPositions, moveSelection, type TextPart } from './searchResults';

/** Ein Eintrag der Liste: Name (mit hervorgehobenen Stellen) und Ordner. */
interface ListItem {
  path: string;
  name: TextPart[];
  folder: string;
  muted?: boolean;
}

function Marked({ parts }: { parts: TextPart[] }) {
  return (
    <>
      {parts.map((part, i) => (part.marked ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
    </>
  );
}

interface FileListProps {
  label: string;
  placeholder: string;
  query: string;
  onQuery: (query: string) => void;
  items: ListItem[];
  /** Was die Liste beim Erscheinen neuer Einträge auswählt. */
  initialIndex: number;
  onOpen: (path: string) => void;
  onClose: () => void;
  options?: ReactNode;
  empty: string;
}

function FileList({ label, placeholder, query, onQuery, items, initialIndex, onOpen, onClose, options, empty }: FileListProps) {
  const [selected, setSelected] = useState(initialIndex);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(Math.min(initialIndex, items.length - 1)), [items, initialIndex]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const open = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    onOpen(item.path);
  };
  return (
    <QuickPopup label={label} className="file-popup" onClose={onClose}>
      <div className="quick-popup-header">
        <span className="quick-popup-title">{label}</span>
        {options}
      </div>
      <input
        className="quick-popup-input"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        autoFocus
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            open(selected);
            return;
          }
          const next = moveSelection(selected, items.length, e.key);
          if (next !== selected) {
            e.preventDefault();
            setSelected(next);
          }
        }}
      />
      <div ref={listRef} className="quick-popup-list" role="listbox" aria-label={label}>
        {items.length === 0 && <p className="quick-popup-empty">{empty}</p>}
        {items.map((item, i) => (
          <div
            key={item.path}
            role="option"
            aria-selected={i === selected}
            aria-label={item.name.map((p) => p.text).join('')}
            className={`quick-popup-item${i === selected ? ' selected' : ''}${item.muted ? ' muted' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setSelected(i);
            }}
            onDoubleClick={() => open(i)}
          >
            <FileIcon />
            <span className="quick-popup-name">
              <Marked parts={item.name} />
            </span>
            <span className="quick-popup-detail">{item.folder}</span>
          </div>
        ))}
      </div>
    </QuickPopup>
  );
}

interface PopupProps {
  api: CodiumApi;
  project: ProjectInfo;
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Ctrl + Shift + N: Dateien nach Namen, unscharf; „include ignored“ nimmt von `.gitignore` ausgenommene dazu. */
export function GotoFilePopup({ api, project, onOpen, onClose }: PopupProps) {
  const [query, setQuery] = useState('');
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [matches, setMatches] = useState<FileNameMatch[]>([]);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      api.request('files.findByName', { query, includeIgnored }).then(
        (result) => {
          if (live) setMatches(result.matches);
        },
        (err: unknown) => console.error('Suche nach Namen gescheitert:', err),
      );
    }, 40);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, query, includeIgnored]);
  const items = useMemo(
    () =>
      matches.map((m): ListItem => {
        const nameStart = m.relative.lastIndexOf('/') + 1;
        const folder = m.relative.slice(0, Math.max(0, nameStart - 1));
        return {
          path: m.path,
          name: markPositions(m.relative.slice(nameStart), m.positions, nameStart),
          folder: folder === '' ? project.name : folder,
          muted: m.ignored === true,
        };
      }),
    [matches, project.name],
  );
  return (
    <FileList
      label="Go to File"
      placeholder="File name"
      query={query}
      onQuery={setQuery}
      items={items}
      initialIndex={0}
      onOpen={onOpen}
      onClose={onClose}
      empty={query.trim() === '' ? 'Type a part of the file name' : 'Nothing found'}
      options={
        <label className="quick-popup-option">
          <input type="checkbox" checked={includeIgnored} onChange={(e) => setIncludeIgnored(e.target.checked)} />
          include ignored
        </label>
      }
    />
  );
}

/** Ctrl + E: die zuletzt geöffneten Dateien, neueste zuerst; vorausgewählt ist die vorherige, wie in IntelliJ. */
export function RecentFilesPopup({ api, project, onOpen, onClose }: PopupProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    api.request('project.recentFiles').then(
      (result) => {
        if (live) setFiles(result);
      },
      (err: unknown) => console.error('Zuletzt geöffnete Dateien nicht geladen:', err),
    );
    return () => {
      live = false;
    };
  }, [api]);
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return files
      .filter((file) => needle === '' || baseName(file).toLowerCase().includes(needle))
      .map((file): ListItem => {
        const name = baseName(file);
        const at = needle === '' ? -1 : name.toLowerCase().indexOf(needle);
        const positions = at < 0 ? [] : Array.from({ length: needle.length }, (_, i) => at + i);
        const folder = parentPath(file);
        return { path: file, name: markPositions(name, positions), folder: relativeLabel(project.path, folder) };
      });
  }, [files, query, project.path]);
  return (
    <FileList
      label="Recent Files"
      placeholder="Filter recent files"
      query={query}
      onQuery={setQuery}
      items={items}
      initialIndex={query.trim() === '' && items.length > 1 ? 1 : 0}
      onOpen={onOpen}
      onClose={onClose}
      empty="No recent files"
    />
  );
}
