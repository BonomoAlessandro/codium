// „Open Folder“ und die zuletzt geöffneten Projekte: im Willkommensfenster und im Projektmenü der Kopfzeile.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodiumError, ErrorCode, type CodiumApi, type RecentProject } from '../shared/types';
import { errorText } from './errors';
import { CloseIcon } from './icons';
import type { Notify } from './Notices';
import type { Ask } from './popup/Dialogs';

export interface ProjectActions {
  recent: RecentProject[];
  /** Fragt die Liste neu ab, etwa beim Öffnen des Projektmenüs (ein anderes Fenster kann sie geändert haben). */
  refresh: () => Promise<void>;
  openFolder: () => Promise<void>;
  openRecent: (project: RecentProject) => Promise<void>;
  /** Entfernt ein Projekt aus der Liste, ohne Rückfrage (etwa über den Knopf einer Meldung). */
  removeRecent: (path: string) => Promise<void>;
  /** Entfernt ein Projekt aus der Liste nach einer Rückfrage. */
  confirmRemoveRecent: (project: RecentProject) => Promise<void>;
}

/** Befehle rund ums Öffnen von Projekten; Fehler erscheinen als Meldung. */
export function useProjectActions(api: CodiumApi, notify: Notify, ask: Ask): ProjectActions {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  // Antworten können in anderer Reihenfolge ankommen, als die Anfragen gingen; es gilt die zuletzt gestellte.
  const latest = useRef(0);

  const apply = useCallback(async (request: () => Promise<RecentProject[]>) => {
    const mine = ++latest.current;
    const list = await request();
    if (mine === latest.current) setRecent(list);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await apply(() => api.request('app.recentProjects'));
    } catch (err) {
      console.error(err);
    }
  }, [api, apply]);

  useEffect(() => {
    void refresh();
    // Ein anderes Fenster kann die Liste inzwischen geändert haben.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const removeRecent = useCallback(
    async (path: string) => {
      try {
        await apply(() => api.request('app.removeRecentProject', { path }));
      } catch (err) {
        notify({ level: 'error', text: errorText(err) });
      }
    },
    [api, apply, notify],
  );

  const confirmRemoveRecent = useCallback(
    async (project: RecentProject) => {
      const choice = await ask({
        title: 'Remove Recent Project',
        message: `Remove “${project.name}” from the list of recent projects? The folder itself stays as it is.`,
        items: [project.path],
        buttons: [
          { id: 'remove', label: 'Remove', primary: true },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      if (choice === 'remove') await removeRecent(project.path);
    },
    [ask, removeRecent],
  );

  const showError = useCallback(
    (err: unknown, project?: RecentProject) => {
      const folderGone =
        err instanceof CodiumError && (err.code === ErrorCode.projectNotFound || err.code === ErrorCode.projectUnreachable);
      if (folderGone && project) {
        notify({
          level: 'error',
          text: errorText(err),
          actions: [{ label: 'Remove from List', run: () => void removeRecent(project.path) }],
        });
        void refresh();
        return;
      }
      notify({ level: 'error', text: errorText(err) });
    },
    [notify, refresh, removeRecent],
  );

  const openFolder = useCallback(async () => {
    try {
      if (await api.request('app.openFolder')) await refresh();
    } catch (err) {
      showError(err);
    }
  }, [api, refresh, showError]);

  const openRecent = useCallback(
    async (project: RecentProject) => {
      try {
        await api.request('app.openProject', { path: project.path });
        await refresh();
      } catch (err) {
        showError(err, project);
      }
    },
    [api, refresh, showError],
  );

  return { recent, refresh, openFolder, openRecent, removeRecent, confirmRemoveRecent };
}

/** Ob zwei Projektpfade dasselbe Projekt meinen; Codium läuft unter Windows, Gross-/Kleinschreibung zählt nicht. */
export function sameProjectPath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function RecentProjectList({ actions }: { actions: ProjectActions }) {
  if (actions.recent.length === 0) return <p className="recent-empty">No recent projects</p>;
  return (
    <ul className="recent-list" aria-label="Recent Projects">
      {actions.recent.map((project) => (
        <li key={project.path} className={project.exists ? 'recent-item' : 'recent-item recent-missing'}>
          <button
            type="button"
            className="recent-open"
            title={project.exists ? project.path : `${project.path} (folder not found or not reachable)`}
            onClick={() => void actions.openRecent(project)}
          >
            <span className="recent-name">{project.name}</span>
            <span className="recent-path">{project.path}</span>
          </button>
          <button
            type="button"
            className="icon-button recent-remove"
            title="Remove from Recent Projects"
            aria-label={`Remove ${project.name} from Recent Projects`}
            onClick={() => void actions.confirmRemoveRecent(project)}
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}
