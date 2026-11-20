// Platzhalter des Projektfensters mit dem Projektnamen, bis das Layout mit Ticket 03 kommt. Die Leiste oben
// vertritt bis dahin das Projektmenü: „Open Folder“, zuletzt geöffnete Projekte und „Exit“.

import type { CodiumApi, ProjectInfo } from '../shared/types';
import type { Notify } from './Notices';
import { RecentProjectList, useProjectActions } from './RecentProjects';

export function ProjectPlaceholder({ api, notify, project }: { api: CodiumApi; notify: Notify; project: ProjectInfo }) {
  const actions = useProjectActions(api, notify);
  const others = { ...actions, recent: actions.recent.filter((p) => p.path !== project.path) };

  return (
    <main className="project-placeholder">
      <header className="placeholder-bar">
        <span className="placeholder-bar-name">{project.name}</span>
        <span className="placeholder-bar-spacer" />
        <button type="button" onClick={() => void actions.openFolder()}>
          Open Folder
        </button>
        <button type="button" onClick={() => void api.request('app.exit')}>
          Exit
        </button>
      </header>
      <section className="placeholder-body">
        <h1>{project.name}</h1>
        <p className="placeholder-path">{project.path}</p>
        <h2>Recent Projects</h2>
        <RecentProjectList actions={others} />
      </section>
    </main>
  );
}
