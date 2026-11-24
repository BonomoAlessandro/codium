// Wurzel der Oberfläche: fragt den Kern, was dieses Fenster ist, und zeigt das Willkommensfenster oder das
// Projektfenster. Meldungen und Fortschritt des Kerns werden hier abonniert, bevor ein Teil der Oberfläche sie
// braucht; Meldungen erscheinen in beiden Fenstern unten rechts.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoticeAction, WindowInfo } from '../shared/types';
import { createApi } from './api';
import { errorText } from './errors';
import { NoticeList, useNotices } from './Notices';
import { DialogHost, useAsk } from './popup/Dialogs';
import { applyProgress, type RunningWork } from './progress';
import { OPEN_README_EVENT, OPEN_SERVER_LOG_EVENT, ProjectWindow } from './project/ProjectWindow';
import { useProjectActions, type ProjectActions } from './RecentProjects';
import { WelcomeScreen } from './WelcomeScreen';

const api = createApi(window.codium);

export function App() {
  return (
    <DialogHost>
      <Root />
    </DialogHost>
  );
}

function Root() {
  const ask = useAsk();
  const [windowInfo, setWindowInfo] = useState<WindowInfo | null>(null);
  const { notices, notify, dismiss } = useNotices();
  const actions = useProjectActions(api, notify, ask);
  const work = useRunningWork();

  useEffect(() => {
    void api.request('window.info').then((info) => {
      setWindowInfo(info);
      if (info) document.title = info.title;
    });
  }, []);

  // Meldungen des Kerns; ihre Knöpfe führt die Oberfläche aus (siehe `NoticeActions` im Vertrag).
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const runAction = useCallback((action: NoticeAction) => runNoticeAction(actionsRef.current, action, notify), [notify]);
  useEffect(
    () =>
      api.on('app.notice', (notice) =>
        notify({
          level: notice.level,
          text: notice.text,
          ...(notice.actions
            ? { actions: notice.actions.map((a) => ({ label: a.label, run: () => runAction(a), ...(a.keepOpen ? { keepOpen: true } : {}) })) }
            : {}),
        }),
      ),
    [notify, runAction],
  );

  return (
    <>
      {windowInfo?.kind === 'welcome' && <WelcomeScreen api={api} actions={actions} title={windowInfo.title} work={work} />}
      {windowInfo?.kind === 'project' && (
        <ProjectWindow api={api} project={windowInfo.project} actions={actions} work={work} notify={notify} />
      )}
      <NoticeList notices={notices} onDismiss={dismiss} />
    </>
  );
}

/** Laufende Arbeiten des Kerns für die Statusleiste. */
function useRunningWork(): RunningWork[] {
  const [work, setWork] = useState<RunningWork[]>([]);
  useEffect(() => api.on('app.progress', (event) => setWork((list) => applyProgress(list, event))), []);
  return work;
}

/** Führt den Knopf einer Meldung des Kerns aus. Kommt eine Aktion zur Tabelle dazu, verlangt TypeScript sie hier. */
function runNoticeAction(actions: ProjectActions, action: NoticeAction, notify: ReturnType<typeof useNotices>['notify']): void {
  const kind = action.action;
  switch (kind) {
    case 'recentProjects.remove':
      void actions.removeRecent(action.params.path);
      return;
    case 'readme.open':
      // Das Projektfenster öffnet das README in einem Tab (siehe ProjectWindow).
      window.dispatchEvent(new CustomEvent(OPEN_README_EVENT));
      return;
    case 'languageServers.showLog':
      // Das Projektfenster öffnet das Protokoll in einem Tab (siehe ProjectWindow).
      window.dispatchEvent(new CustomEvent(OPEN_SERVER_LOG_EVENT));
      return;
    case 'language.restart':
      void api.request('language.restart', { server: action.params.server }).catch((err: unknown) => notify({ level: 'error', text: errorText(err) }));
      return;
    default:
      assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unbekannte Aktion an einer Meldung: ${String(value)}`);
}
