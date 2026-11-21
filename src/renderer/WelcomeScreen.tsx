// Willkommensfenster: zuletzt geöffnete Projekte, „Open Folder“ und „Clone Repository“. Öffnet sich daraus ein Projekt, schliesst der
// Kern dieses Fenster. Oben eine schlichte Kopfzeile als Zieh-Fläche, rechts die Fensterknöpfe von Windows.

import { useEffect, useState } from 'react';
import type { AppInfo, CodiumApi } from '../shared/types';
import { CLONE_WITHOUT_GIT, useCloneDialog, useGitAvailable } from './CloneDialog';
import { ProgressIndicator } from './ProgressIndicator';
import type { RunningWork } from './progress';
import { RecentProjectList, type ProjectActions } from './RecentProjects';

interface WelcomeScreenProps {
  api: CodiumApi;
  actions: ProjectActions;
  title: string;
  /** Laufende Arbeiten des Kerns für dieses Fenster (etwa Klonen); dann erscheint unten eine schmale Leiste. */
  work: readonly RunningWork[];
}

export function WelcomeScreen({ api, actions, title, work }: WelcomeScreenProps) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const git = useGitAvailable(api);
  const clone = useCloneDialog(api);

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
          <button type="button" disabled={git !== true} title={git === false ? CLONE_WITHOUT_GIT : undefined} onClick={clone.open}>
            Clone Repository
          </button>
        </div>
        <section className="welcome-recent">
          <h2>Recent Projects</h2>
          <RecentProjectList actions={actions} />
        </section>
      </main>
      {clone.dialog}
      {work.length > 0 && (
        <footer className="statusbar welcome-statusbar">
          <ProgressIndicator work={work} />
        </footer>
      )}
    </div>
  );
}
