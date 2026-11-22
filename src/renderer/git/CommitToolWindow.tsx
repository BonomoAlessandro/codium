// Werkzeugfenster „Commit“ (Ticket 16), wie in IntelliJ: die Gruppen „Changes“ und „Unversioned Files“ mit Häkchen pro
// Datei und Gruppe, die Commit-Nachricht, „Amend“ und „Commit“. Beim Erscheinen sind Dateien in „Changes“ angehakt,
// nicht versionierte nicht; die Häkchen bleiben bei Aktualisierungen erhalten. „Group by Directory“ gruppiert nach
// Ordnern (im Projekt-Zustand gemerkt). Doppelklick öffnet eine Datei, Rechtsklick bietet „Rollback…“, „Jump to
// Source“ und bei nicht versionierten „Add to .gitignore“.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodiumApi, GitFileStatus, GitState, ProjectInfo } from '../../shared/types';
import { errorText } from '../errors';
import { FileIcon } from '../icons';
import type { Notify } from '../Notices';
import { useAsk } from '../popup/Dialogs';
import { Menu, type MenuEntry } from '../popup/Menu';
import { baseName, parentPath, relativeLabel } from '../project/filePaths';
import { ToolWindowHeader } from '../project/ToolWindowHeader';

interface CommitToolWindowProps {
  api: CodiumApi;
  project: ProjectInfo;
  state: GitState | null;
  notify: Notify;
  onHide: () => void;
  onOpenFile: (path: string) => void;
  /** Vor jeder schreibenden Git-Aktion: alle Tabs speichern (Ticket 07). */
  saveAll: () => Promise<void>;
}

/** Art einer Änderung für Farbe und Beschriftung. */
export function changeKind(file: GitFileStatus): 'modified' | 'added' | 'deleted' | 'renamed' | 'unversioned' | 'ignored' | 'conflict' {
  if (file.conflict) return 'conflict';
  if (file.index === '?') return 'unversioned';
  if (file.index === '!') return 'ignored';
  if (file.origPath) return 'renamed';
  if (file.index === 'A') return 'added';
  if (file.index === 'D' || file.worktree === 'D') return 'deleted';
  return 'modified';
}

export function CommitToolWindow({ api, project, state, notify, onHide, onOpenFile, saveAll }: CommitToolWindowProps) {
  const files = useMemo(() => (state?.files ?? []).filter((f) => f.index !== '!'), [state]);
  const changes = files.filter((f) => f.index !== '?');
  const unversioned = files.filter((f) => f.index === '?');

  // Häkchen: neue Einträge bekommen ihren Standard, bekannte behalten ihren Stand.
  const [checked, setChecked] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  useEffect(() => {
    setChecked((current) => {
      const next = new Map<string, boolean>();
      for (const f of files) next.set(f.path, current.get(f.path) ?? f.index !== '?');
      return next;
    });
  }, [files]);
  const isChecked = (f: GitFileStatus) => checked.get(f.path) ?? f.index !== '?';
  const setMany = (list: GitFileStatus[], value: boolean) =>
    setChecked((current) => {
      const next = new Map(current);
      for (const f of list) next.set(f.path, value);
      return next;
    });

  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [amendMessage, setAmendMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupByDirectory, setGroupByDirectory] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; file: GitFileStatus } | null>(null);
  const ask = useAsk();
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    api.request('project.commitView').then(
      (view) => {
        if (live) setGroupByDirectory(view.groupByDirectory);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api]);

  const selected = files.filter(isChecked);
  // Inaktiv ohne Nachricht oder ohne angehakte Datei, ausser bei Amend mit geänderter Nachricht.
  const canCommit =
    !busy && message.trim() !== '' && (selected.length > 0 || (amend && amendMessage !== null && message.trim() !== amendMessage.trim()));

  const toggleAmend = async (value: boolean) => {
    setAmend(value);
    if (!value) return;
    const last = await api.request('git.lastMessage').catch(() => null);
    setAmendMessage(last);
    // Wie in IntelliJ: Die letzte Nachricht füllt das Feld, wenn es noch leer ist.
    if (last && message.trim() === '') setMessage(last);
  };

  const commit = async () => {
    if (!canCommit) return;
    setBusy(true);
    try {
      await saveAll();
      await api.request('git.commit', { paths: selected.map((f) => f.path), message, ...(amend ? { amend: true } : {}) });
      setMessage('');
      setAmend(false);
      setAmendMessage(null);
      notify({ level: 'success', text: `Committed ${selected.length} ${selected.length === 1 ? 'file' : 'files'}.` });
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (targets: GitFileStatus[]) => {
    const list = targets.filter((f) => f.index !== '?');
    if (list.length === 0) return;
    const choice = await ask({
      title: 'Rollback Changes',
      message: `Roll back ${list.length === 1 ? 'this file' : `these ${list.length} files`} to the last commit? Added files go to the recycle bin.`,
      items: list.map((f) => relativeLabel(project.path, f.path)),
      buttons: [
        { id: 'rollback', label: 'Rollback', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice !== 'rollback') return;
    try {
      await saveAll();
      await api.request('git.rollback', { paths: list.map((f) => f.path) });
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    }
  };

  const menuEntries = (file: GitFileStatus): MenuEntry[] => {
    const targets = isChecked(file) ? selected : [file];
    const entries: MenuEntry[] = [
      { kind: 'item', label: 'Rollback…', disabled: file.index === '?', run: () => void rollback(targets) },
      { kind: 'item', label: 'Jump to Source', disabled: changeKind(file) === 'deleted', run: () => onOpenFile(file.path) },
    ];
    if (file.index === '?') {
      entries.push({
        kind: 'item',
        label: 'Add to .gitignore',
        run: () => void api.request('git.addToGitignore', { path: file.path }).catch((err: unknown) => notify({ level: 'error', text: errorText(err) })),
      });
    }
    return entries;
  };

  const notRepository = state !== null && !state.repository;
  return (
    <>
      <ToolWindowHeader title="Commit" onHide={onHide}>
        <label className="commit-option" title="Group by Directory">
          <input
            type="checkbox"
            checked={groupByDirectory}
            onChange={(e) => {
              setGroupByDirectory(e.target.checked);
              void api.request('project.setCommitView', { groupByDirectory: e.target.checked }).catch(() => {});
            }}
          />
          Group by Directory
        </label>
      </ToolWindowHeader>
      <div className="tool-window-body commit-body">
        {notRepository ? (
          <p className="tool-window-placeholder">Not a Git repository</p>
        ) : (
          <>
            <div className="commit-changes" role="tree" aria-label="Changes">
              {files.length === 0 && <p className="tool-window-placeholder">No changes</p>}
              {[
                { label: 'Changes', list: changes },
                { label: 'Unversioned Files', list: unversioned },
              ]
                .filter((g) => g.list.length > 0)
                .map((group) => (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <label className="commit-group">
                      <input
                        type="checkbox"
                        aria-label={group.label}
                        checked={group.list.every(isChecked)}
                        ref={(el) => {
                          if (el) el.indeterminate = group.list.some(isChecked) && !group.list.every(isChecked);
                        }}
                        onChange={(e) => setMany(group.list, e.target.checked)}
                      />
                      {group.label} <span className="commit-count">{group.list.length}</span>
                    </label>
                    {grouped(group.list, groupByDirectory, project.path).map((entry) =>
                      entry.kind === 'folder' ? (
                        <div key={`d:${entry.folder}`} className="commit-folder">
                          {entry.folder}
                        </div>
                      ) : (
                        <div
                          key={entry.file.path}
                          role="treeitem"
                          aria-label={baseName(entry.file.path)}
                          aria-selected={false}
                          className={`commit-file git-${changeKind(entry.file)}${groupByDirectory ? ' nested' : ''}`}
                          data-git={changeKind(entry.file)}
                          onDoubleClick={() => changeKind(entry.file) !== 'deleted' && onOpenFile(entry.file.path)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, file: entry.file });
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Include ${baseName(entry.file.path)}`}
                            checked={isChecked(entry.file)}
                            onChange={(e) => setMany([entry.file], e.target.checked)}
                          />
                          <FileIcon />
                          <span className="commit-file-name">{baseName(entry.file.path)}</span>
                          {!groupByDirectory && <span className="commit-file-folder">{relativeLabel(project.path, parentPath(entry.file.path)) || project.name}</span>}
                        </div>
                      ),
                    )}
                  </div>
                ))}
            </div>
            <div className="commit-message-area">
              <textarea
                ref={messageRef}
                className="commit-message"
                aria-label="Commit Message"
                placeholder="Commit Message"
                data-autofocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    void commit();
                  }
                }}
              />
              <div className="commit-actions">
                <label className="commit-option">
                  <input type="checkbox" checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} />
                  Amend
                </label>
                <button type="button" className="button-primary" disabled={!canCommit} onClick={() => void commit()}>
                  Commit
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {menu && <Menu label="Change" entries={menuEntries(menu.file)} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </>
  );
}

type Grouped = { kind: 'folder'; folder: string } | { kind: 'file'; file: GitFileStatus };

/** Flach (nach Name) oder nach Ordnern gruppiert. */
function grouped(list: GitFileStatus[], byDirectory: boolean, projectPath: string): Grouped[] {
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
  if (!byDirectory) return sorted.sort((a, b) => baseName(a.path).localeCompare(baseName(b.path))).map((file) => ({ kind: 'file', file }));
  const result: Grouped[] = [];
  let last: string | null = null;
  for (const file of sorted) {
    const folder = relativeLabel(projectPath, parentPath(file.path)) || '.';
    if (folder !== last) result.push({ kind: 'folder', folder });
    last = folder;
    result.push({ kind: 'file', file });
  }
  return result;
}
