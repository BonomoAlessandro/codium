// Willkommensfenster: zuletzt geöffnete Projekte und „Open Folder“. Öffnet sich daraus ein Projekt, schliesst der
// Kern dieses Fenster. Oben eine schlichte Kopfzeile als Zieh-Fläche, rechts die Fensterknöpfe von Windows.

import { useEffect, useState } from 'react';
import type { AppInfo, CodiumApi } from '../shared/types';
import { RecentProjectList, type ProjectActions } from './RecentProjects';

export function WelcomeScreen({ api, actions, title }: { api: CodiumApi; actions: ProjectActions; title: string }) {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void api.request('app.info').then(setInfo);
  }, [api]);

  return (
    <div className="welcome-window">
      <header className="header">
        <div className="header-content">
          <span className="welcome-title">{title}</span>
        </div>
      </header>
      <main className="welcome">
        <div className="welcome-header">
          <h1>Codium</h1>
          <p className="welcome-version">{info ? `Version ${info.version}` : '…'}</p>
        </div>
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
    </div>
  );
}
