// Kopfzeile des Projektfensters, von Codium gezeichnet: links das Projektmenü (Projektname mit Pfeil), daneben der
// Platz für das Branch-Menü (Ticket 15). Die Kopfzeile ist die Zieh-Fläche des Fensters (Verschieben, Doppelklick
// maximiert); rechts liegen die Fensterknöpfe von Windows als Überlagerung darüber.

import { useRef, useState } from 'react';
import type { CodiumApi, GitState, ProjectInfo } from '../../shared/types';
import { branchLabel } from '../git/gitState';
import { BranchIcon, ChevronDownIcon } from '../icons';
import { CLONE_WITHOUT_GIT, useCloneDialog, useGitAvailable } from '../CloneDialog';
import { shortcutLabel } from '../keymap';
import { Menu, type MenuEntry } from '../popup/Menu';
import { sameProjectPath, type ProjectActions } from '../RecentProjects';
import { projectBadgeColor, projectInitials } from './projectBadge';

interface HeaderProps {
  project: ProjectInfo;
  actions: ProjectActions;
  onExit: () => void;
  /** „Settings…“: öffnet den Einstellungsdialog. */
  onSettings: () => void;
  api: CodiumApi;
  /** Zustand des Repositorys; ohne Repository kein Branch-Menü (Ticket 15). */
  git: GitState | null;
  /** Öffnet das Branch-Menü. */
  onBranches: () => void;
}

export function Header({ project, actions, onExit, onSettings, api, git: gitState, onBranches }: HeaderProps) {
  const git = useGitAvailable(api);
  const clone = useCloneDialog(api);
  const [menu, setMenu] = useState<{ viaKeyboard: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Das Projekt dieses Fensters steht nicht in der Liste; es ist ja schon offen.
  const others = actions.recent.filter((p) => !sameProjectPath(p.path, project.path));
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Open Folder…', run: () => void actions.openFolder() },
    {
      kind: 'item',
      label: 'Clone Repository…',
      disabled: git !== true,
      ...(git === false ? { detail: CLONE_WITHOUT_GIT } : {}),
      run: clone.open,
    },
    ...(others.length > 0 ? [{ kind: 'separator' } as const] : []),
    ...others.map(
      (p): MenuEntry => ({ kind: 'item', label: p.name, detail: p.path, muted: !p.exists, run: () => void actions.openRecent(p) }),
    ),
    { kind: 'separator' },
    { kind: 'item', label: 'Settings…', shortcut: shortcutLabel('settings.open'), run: onSettings },
    { kind: 'separator' },
    { kind: 'item', label: 'Exit', run: onExit },
  ];

  return (
    <header className="header">
      <div className="header-content">
        <button
          ref={buttonRef}
          type="button"
          className="header-widget project-widget"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          title={project.path}
          onClick={(e) => {
            if (menu) {
              setMenu(null);
              return;
            }
            // Die Liste kann sich in einem anderen Fenster geändert haben.
            void actions.refresh();
            // Ein Klick per Tastatur (Enter, Leertaste) hat keine Mausposition.
            setMenu({ viaKeyboard: e.detail === 0 });
          }}
        >
          <span className="project-badge" style={{ backgroundColor: projectBadgeColor(project.path) }} aria-hidden="true">
            {projectInitials(project.name)}
          </span>
          <span className="header-widget-label">{project.name}</span>
          <ChevronDownIcon />
        </button>
        {/* Branch-Menü (Ticket 15); in einem Ordner ohne Git-Repository bleibt der Platz leer. */}
        <div className="header-branch">
          {gitState?.repository && (
            <button
              type="button"
              className="header-widget branch-widget"
              aria-haspopup="dialog"
              aria-label={`Branch ${branchLabel(gitState).name}`}
              title={gitState.upstream ? `${branchLabel(gitState).name} → ${gitState.upstream}` : branchLabel(gitState).name}
              onClick={onBranches}
            >
              <BranchIcon />
              <span className="header-widget-label">{branchLabel(gitState).name}</span>
              {branchLabel(gitState).sync && <span className="branch-sync">{branchLabel(gitState).sync}</span>}
              <ChevronDownIcon />
            </button>
          )}
        </div>
      </div>
      {menu && buttonRef.current && (
        <Menu
          label="Project"
          entries={entries}
          anchor={buttonRef.current}
          highlightFirst={menu.viaKeyboard}
          onClose={() => {
            setMenu(null);
            buttonRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {clone.dialog}
    </header>
  );
}
