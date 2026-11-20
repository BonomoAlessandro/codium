// Willkommensfenster: zuletzt geöffnete Projekte und „Open Folder“. Öffnet sich daraus ein Projekt, schliesst
// der Kern dieses Fenster.

import { useEffect, useState } from 'react';
import type { AppInfo, CodiumApi } from '../shared/types';
import type { Notify } from './Notices';
import { RecentProjectList, useProjectActions } from './RecentProjects';

export function WelcomeScreen({ api, notify }: { api: CodiumApi; notify: Notify }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const actions = useProjectActions(api, notify);

  useEffect(() => {
    void api.request('app.info').then(setInfo);
  }, [api]);

  return (
    <main className="welcome">
      <header className="welcome-header">
        <h1>Codium</h1>
        <p className="welcome-version">{info ? `Version ${info.version}` : '…'}</p>
      </header>
      <div className="welcome-actions">
        <button type="button" className="button-primary" onClick={() => void actions.openFolder()}>
          Open Folder
        </button>
        {/* Platz für „Clone Repository“ (Ticket 10). */}
      </div>
      <section className="welcome-recent">
        <h2>Recent Projects</h2>
        <RecentProjectList actions={actions} />
      </section>
    </main>
  );
}
