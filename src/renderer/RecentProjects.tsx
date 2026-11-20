// „Open Folder“ und die zuletzt geöffneten Projekte: im Willkommensfenster und vorläufig im Platzhalter des
// Projektfensters (bis das Projektmenü mit Ticket 03 kommt).

import { useCallback, useEffect, useState } from 'react';
import { CodiumError, ErrorCode, type CodiumApi, type RecentProject } from '../shared/types';
import { errorText } from './errors';
import type { Notify } from './Notices';

export interface ProjectActions {
  recent: RecentProject[];
  openFolder: () => Promise<void>;
  openRecent: (project: RecentProject) => Promise<void>;
  removeRecent: (project: RecentProject) => Promise<void>;
}

/** Befehle rund ums Öffnen von Projekten; Fehler erscheinen als Hinweis. */
export function useProjectActions(api: CodiumApi, notify: Notify): ProjectActions {
  const [recent, setRecent] = useState<RecentProject[]>([]);

  const refresh = useCallback(async () => {
    setRecent(await api.request('app.recentProjects'));
  }, [api]);

  useEffect(() => {
    void refresh();
    // Ein anderes Fenster kann die Liste inzwischen geändert haben.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const removeRecent = useCallback(
    async (project: RecentProject) => {
      setRecent(await api.request('app.removeRecentProject', { path: project.path }));
    },
    [api],
  );

  const showError = useCallback(
    (err: unknown, project?: RecentProject) => {
      const folderGone = err instanceof CodiumError && (err.code === ErrorCode.projectNotFound || err.code === ErrorCode.projectUnreachable);
      if (folderGone && project) {
        notify({
          level: 'error',
          text: errorText(err),
          actions: [{ label: 'Remove from List', run: () => void removeRecent(project) }],
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

  return { recent, openFolder, openRecent, removeRecent };
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
            className="recent-remove"
            title="Remove from Recent Projects"
            aria-label={`Remove ${project.name} from Recent Projects`}
            onClick={() => void actions.removeRecent(project)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
