// Wurzel der Oberfläche: fragt den Kern, was dieses Fenster ist, und zeigt das Willkommensfenster oder den
// Platzhalter des Projektfensters (das Layout folgt mit Ticket 03). Hinweise des Kerns erscheinen in beiden.

import { useEffect, useState } from 'react';
import type { WindowInfo } from '../shared/types';
import { createApi } from './api';
import { NoticeList, useNotices } from './Notices';
import { ProjectPlaceholder } from './ProjectPlaceholder';
import { WelcomeScreen } from './WelcomeScreen';

const api = createApi(window.codium);

export function App() {
  const [windowInfo, setWindowInfo] = useState<WindowInfo | null>(null);
  const { notices, notify, dismiss } = useNotices();

  useEffect(() => {
    void api.request('window.info').then((info) => {
      setWindowInfo(info);
      if (info) document.title = info.title;
    });
  }, []);

  useEffect(() => api.on('app.notice', (notice) => notify(notice)), [notify]);

  return (
    <>
      {windowInfo?.kind === 'welcome' && <WelcomeScreen api={api} notify={notify} />}
      {windowInfo?.kind === 'project' && <ProjectPlaceholder api={api} notify={notify} project={windowInfo.project} />}
      <NoticeList notices={notices} onDismiss={dismiss} />
    </>
  );
}
