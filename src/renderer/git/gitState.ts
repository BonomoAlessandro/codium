// Zustand des Repositorys in der Oberfläche (Ticket 15): beim Start vom Kern geladen, danach bei jeder Änderung
// aktualisiert; bekommt das Fenster den Fokus, liest der Kern ihn neu (etwa nach Git auf der Konsole).

import { useEffect, useState } from 'react';
import type { CodiumApi, GitState } from '../../shared/types';

export function useGitState(api: CodiumApi): GitState | null {
  const [state, setState] = useState<GitState | null>(null);
  useEffect(() => {
    let live = true;
    const off = api.on('git.stateChanged', (next) => setState(next));
    api.request('git.state').then(
      (current) => {
        if (live) setState((known) => known ?? current);
      },
      () => {},
    );
    const onFocus = () => void api.request('git.refresh').catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [api]);
  return state;
}

/** Text der Kopfzeile: Branch bzw. kurzer Hash, dazu ↑n ↓m gegenüber dem Upstream. */
export function branchLabel(state: GitState): { name: string; sync: string } {
  const name = state.branch ?? state.detached ?? 'No commits';
  const sync = [state.ahead > 0 ? `↑${state.ahead}` : '', state.behind > 0 ? `↓${state.behind}` : ''].filter(Boolean).join(' ');
  return { name, sync };
}

/** Hinweis, wenn Git fehlt (Ticket 09). */
export const GIT_NOT_FOUND_TEXT = 'Git was not found. Install Git and restart Codium to use Git functions.';
