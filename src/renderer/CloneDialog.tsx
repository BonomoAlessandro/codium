// „Clone Repository“ (Willkommensfenster und Projektmenü): Adresse und Zielordner. Der Zielordner wird aus der Adresse
// vorgeschlagen (Ordnername unter dem zuletzt gewählten Elternordner), bis der Nutzer ihn selbst ändert. Das Klonen
// läuft im Kern mit Fortschritt in der Statusleiste; danach öffnet sich das Projekt in einem neuen Fenster. Ohne Git ist
// „Clone Repository“ aus (`useGitAvailable`).

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { folderNameFromUrl } from '../shared/cloneUrl';
import type { CodiumApi } from '../shared/types';
import { errorText } from './errors';
import { keepFocusInside } from './popup/Dialogs';

/** Erklärung am inaktiven „Clone Repository“ ohne Git. */
export const CLONE_WITHOUT_GIT = 'Git not found. Install Git to clone repositories.';

/** Ob Git da ist (für „Clone Repository“); `null`, solange die Antwort aussteht. */
export function useGitAvailable(api: CodiumApi): boolean | null {
  const [git, setGit] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api.request('app.prerequisites').then(
      (result) => {
        if (live) setGit(result.git);
      },
      () => {
        if (live) setGit(false);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);
  return git;
}

/** Der Dialog und eine Funktion, die ihn öffnet. */
export function useCloneDialog(api: CodiumApi): { open: () => void; dialog: ReactNode } {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  return { open, dialog: isOpen ? <CloneDialog api={api} onClose={() => setOpen(false)} /> : null };
}

function CloneDialog({ api, onClose }: { api: CodiumApi; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  /** Der Zielordner, wenn der Nutzer ihn selbst geändert hat; sonst folgt er der Adresse. */
  const [ownDirectory, setOwnDirectory] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const cloningRef = useRef(cloning);
  cloningRef.current = cloning;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const id = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement;
    let live = true;
    api.request('app.cloneDefaults').then(
      (defaults) => {
        if (live) setParent(defaults.parent);
      },
      () => {},
    );
    // Wie die Rückfragen: Tab bleibt im Dialog, Escape schliesst (nicht während des Klonens).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!cloningRef.current) onCloseRef.current();
      } else if (e.key === 'Tab' && dialogRef.current) {
        keepFocusInside(e, dialogRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKeyDown, true);
      const restore = previousFocus.current;
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true });
    };
  }, [api]);

  const suggested = parent === null ? '' : joinDirectory(parent, folderNameFromUrl(url));
  const directory = ownDirectory ?? suggested;
  const ready = url.trim() !== '' && directory.trim() !== '' && !cloning;

  const browse = async () => {
    const picked = await api.request('app.pickFolder', { title: 'Choose Parent Directory' }).catch(() => null);
    if (picked === null) return;
    setParent(picked);
    setOwnDirectory(null);
  };

  const clone = async () => {
    if (!ready) return;
    setCloning(true);
    setError(null);
    try {
      await api.request('app.clone', { url: url.trim(), directory: directory.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setCloning(false);
    }
  };

  return createPortal(
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="dialog clone-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void clone();
          }
        }}
      >
        <div id={`${id}-title`} className="dialog-title">
          Clone Repository
        </div>
        <div className="settings-grid">
          <label htmlFor={`${id}-url`}>URL</label>
          <input
            id={`${id}-url`}
            className="settings-input"
            value={url}
            autoFocus
            spellCheck={false}
            disabled={cloning}
            placeholder="https://… or git@host:path/name.git"
            onChange={(e) => setUrl(e.target.value)}
          />
          <label htmlFor={`${id}-dir`}>Directory</label>
          <div className="clone-directory">
            <input
              id={`${id}-dir`}
              className="settings-input"
              value={directory}
              spellCheck={false}
              disabled={cloning}
              onChange={(e) => setOwnDirectory(e.target.value)}
            />
            <button type="button" disabled={cloning} onClick={() => void browse()}>
              Browse…
            </button>
          </div>
        </div>
        {cloning && (
          <p className="settings-hint clone-status" role="status">
            Cloning… Sign-in, if needed, opens in its own window.
          </p>
        )}
        {error && (
          <p className="settings-error clone-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button-primary" disabled={!ready} onClick={() => void clone()}>
            Clone
          </button>
          <button type="button" disabled={cloning} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Ein Ordner unter einem Elternordner; ohne Namen der Elternordner selbst. */
function joinDirectory(parent: string, name: string): string {
  if (name === '') return parent;
  return `${parent.replace(/[\\/]+$/, '')}\\${name}`;
}
