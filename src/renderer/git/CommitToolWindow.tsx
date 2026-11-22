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
  /** Vergleichsansicht einer geänderten Datei (Ticket 17). */
  onShowDiff: (file: GitFileStatus) => void;
  /** Push nach den Regeln von Ticket 18 (für „Commit and Push“); zeigt Erfolg und Fehler selbst. */
  onPush: () => Promise<void>;
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

export function CommitToolWindow({ api, project, state, notify, onHide, onOpenFile, onShowDiff, onPush, saveAll }: CommitToolWindowProps) {
  // Je Pfad ein Eintrag; gibt es zwei (etwa „D“ und „?“), gilt der versionierte (Review von Ticket 16).
  const files = useMemo(() => {
    const byPath = new Map<string, GitFileStatus>();
    for (const f of state?.files ?? []) {
      if (f.index === '!') continue;
      const known = byPath.get(f.path);
      if (!known || known.index === '?') byPath.set(f.path, f);
    }
    return [...byPath.values()];
  }, [state]);
  const conflicts = files.filter((f) => f.conflict);
  const changes = files.filter((f) => f.index !== '?' && !f.conflict);
  const unversioned = files.filter((f) => f.index === '?');
  // Ticket 18: Während eines Merges nimmt „Commit“ alle Änderungen auf (Häkchen inaktiv); bei einem Rebase heisst er
  // „Continue“.
  const operation = state?.operation === 'merge' || state?.operation === 'rebase' ? state.operation : undefined;

  // Häkchen: neue Einträge bekommen ihren Standard, bekannte behalten ihren Stand.
  const [checked, setChecked] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  useEffect(() => {
    // Bekannte Einträge behalten ihr Häkchen auch, wenn eine Abfrage einmal nichts liefert (Review von Ticket 16).
    setChecked((current) => {
      const next = new Map<string, boolean>(current);
      for (const f of files) if (!next.has(f.path)) next.set(f.path, f.index !== '?');
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
  /** Ausgewählte Zeilen (Klick, Ctrl + Klick); Rollback und Co. wirken auf sie, nicht auf die Häkchen (Review). */
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
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

  // Merge: die von Git vorbereitete Nachricht, solange das Feld leer ist.
  useEffect(() => {
    if (operation !== 'merge') return;
    let live = true;
    api.request('git.mergeMessage').then(
      (prepared) => {
        if (live && prepared) setMessage((current) => (current.trim() === '' ? prepared : current));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, operation]);

  const selected = files.filter(isChecked);
  // Inaktiv ohne Nachricht oder ohne angehakte Datei, ausser bei Amend mit geänderter Nachricht; beim Merge zählt nur
  // die Nachricht, beim Rebase nichts.
  const canCommit =
    !busy &&
    (operation === 'rebase' ||
      (message.trim() !== '' &&
        (operation === 'merge' || selected.length > 0 || (amend && amendMessage !== null && message.trim() !== amendMessage.trim()))));

  /** Vor „Commit“ bzw. „Continue“ bei einem Konflikt: verbliebene Markierungen? Dann erst nach Bestätigung. */
  const confirmMarkers = async (): Promise<boolean> => {
    if (!operation) return true;
    const left = await api.request('git.conflictMarkers').catch(() => [] as string[]);
    if (left.length === 0) return true;
    const choice = await ask({
      title: 'Conflict Markers',
      message: `${left.length === 1 ? 'This file still contains' : 'These files still contain'} conflict markers. ${operation === 'rebase' ? 'Continue' : 'Commit'} anyway?`,
      items: left.map((f) => relativeLabel(project.path, f)),
      buttons: [
        { id: 'go', label: operation === 'rebase' ? 'Continue' : 'Commit' },
        { id: 'cancel', label: 'Cancel', primary: true },
      ],
    });
    return choice === 'go';
  };

  const continueRebase = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveAll();
      if (!(await confirmMarkers())) return;
      const result = await api.request('git.continueRebase');
      notify(result.conflicts ? { level: 'info', text: 'The rebase stopped with new conflicts.' } : { level: 'success', text: 'Rebase completed.' });
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const abort = async () => {
    if (busy || !operation) return;
    const choice = await ask({
      title: operation === 'rebase' ? 'Abort Rebase' : 'Abort Merge',
      message: `Abort the ${operation} and restore the state before it?`,
      buttons: [
        { id: 'abort', label: 'Abort', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice !== 'abort') return;
    setBusy(true);
    try {
      await saveAll();
      await api.request('git.abort');
      setMessage('');
      notify({ level: 'success', text: operation === 'rebase' ? 'Rebase aborted.' : 'Merge aborted.' });
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const toggleAmend = async (value: boolean) => {
    setAmend(value);
    if (!value) {
      // Abgehakt: die vorausgefüllte Nachricht wieder fort, wenn sie unverändert ist.
      if (amendMessage !== null && message.trim() === amendMessage.trim()) setMessage('');
      setAmendMessage(null);
      return;
    }
    const last = await api.request('git.lastMessage').catch(() => null);
    setAmendMessage(last);
    // Wie in IntelliJ: Die letzte Nachricht füllt das Feld, wenn es noch leer ist.
    if (last && message.trim() === '') setMessage(last);
  };

  const commit = async (andPush = false) => {
    if (!canCommit) return;
    if (operation === 'rebase') return continueRebase();
    setBusy(true);
    let committed = false;
    try {
      await saveAll();
      if (!(await confirmMarkers())) return;
      const merge = operation === 'merge';
      await api.request('git.commit', { paths: merge ? [] : selected.map((f) => f.path), message, ...(amend && !merge ? { amend: true } : {}) });
      committed = true;
      setMessage('');
      setAmend(false);
      setAmendMessage(null);
      notify({
        level: 'success',
        text: merge
          ? 'Merge committed.'
          : selected.length === 0
            ? 'Amended the last commit.'
            : `Committed ${selected.length} ${selected.length === 1 ? 'file' : 'files'}.`,
      });
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
    // „Commit and Push“: erst nach erfolgreichem Commit (Ticket 18).
    if (committed && andPush) await onPush();
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
    const targets = selection.has(file.path) ? files.filter((f) => selection.has(f.path)) : [file];
    const entries: MenuEntry[] = [
      { kind: 'item', label: 'Show Diff', run: () => onShowDiff(file) },
      { kind: 'item', label: 'Rollback…', disabled: file.index === '?', run: () => void rollback(targets) },
      { kind: 'item', label: 'Jump to Source', disabled: changeKind(file) === 'deleted', run: () => onOpenFile(file.path) },
    ];
    if (file.index === '?') {
      entries.push({
        kind: 'item',
        label: 'Add to .gitignore',
        // Vorher speichern: Ist die .gitignore offen, gingen ungespeicherte Eingaben sonst in einen Konflikt (Review).
        run: () =>
          void saveAll()
            .then(() => api.request('git.addToGitignore', { path: file.path }))
            .catch((err: unknown) => notify({ level: 'error', text: errorText(err) })),
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
            {operation && (
              <div className="commit-operation" role="status">
                <span>{operation === 'rebase' ? 'Rebase in progress' : 'Merge in progress'}</span>
                <button type="button" disabled={busy} onClick={() => void abort()}>
                  Abort
                </button>
              </div>
            )}
            <div className="commit-changes" role="tree" aria-label="Changes">
              {files.length === 0 && <p className="tool-window-placeholder">No changes</p>}
              {[
                { label: 'Merge Conflicts', list: conflicts },
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
                        disabled={operation !== undefined}
                        checked={operation !== undefined || group.list.every(isChecked)}
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
                          aria-selected={selection.has(entry.file.path)}
                          className={`commit-file git-${changeKind(entry.file)}${groupByDirectory ? ' nested' : ''}${selection.has(entry.file.path) ? ' selected' : ''}`}
                          onMouseDown={(e) => {
                            if ((e.target as HTMLElement).tagName === 'INPUT') return;
                            const p = entry.file.path;
                            if (e.button === 2 && selection.has(p)) return;
                            setSelection((current) => {
                              if (e.ctrlKey && e.button === 0) {
                                const next = new Set(current);
                                if (next.has(p)) next.delete(p);
                                else next.add(p);
                                return next;
                              }
                              return new Set([p]);
                            });
                          }}
                          data-git={changeKind(entry.file)}
                          onDoubleClick={() => onShowDiff(entry.file)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, file: entry.file });
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Include ${baseName(entry.file.path)}`}
                            disabled={operation !== undefined}
                            checked={operation !== undefined ? entry.file.index !== '?' : isChecked(entry.file)}
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
                  <input type="checkbox" checked={amend} disabled={operation !== undefined} onChange={(e) => void toggleAmend(e.target.checked)} />
                  Amend
                </label>
                <span className="commit-buttons">
                  <button type="button" className="button-primary" disabled={!canCommit} onClick={() => void commit()}>
                    {operation === 'rebase' ? 'Continue' : 'Commit'}
                  </button>
                  {operation !== 'rebase' && (
                    <button type="button" disabled={!canCommit} onClick={() => void commit(true)}>
                      Commit and Push
                    </button>
                  )}
                </span>
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

/** Flach (nach Name) oder nach Ordnern gruppiert, sortiert nach (Ordner, Name) (Review von Ticket 16). */
function grouped(list: GitFileStatus[], byDirectory: boolean, projectPath: string): Grouped[] {
  const folderOf = (f: GitFileStatus) => relativeLabel(projectPath, parentPath(f.path)) || '.';
  if (!byDirectory) return [...list].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path))).map((file) => ({ kind: 'file', file }));
  const sorted = [...list].sort((a, b) => folderOf(a).localeCompare(folderOf(b)) || baseName(a.path).localeCompare(baseName(b.path)));
  const result: Grouped[] = [];
  let last: string | null = null;
  for (const file of sorted) {
    const folder = folderOf(file);
    if (folder !== last) result.push({ kind: 'folder', folder });
    last = folder;
    result.push({ kind: 'file', file });
  }
  return result;
}
