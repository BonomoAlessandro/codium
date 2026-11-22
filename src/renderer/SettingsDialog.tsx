// Einstellungsdialog (Ctrl + Alt + S, „Settings…“ im Projektmenü): Schriftgrösse der Editoren und JDK für den
// Java-Sprachserver. Die Einstellungen gelten für alle Projekte; „OK“ speichert sie im Kern, der sie an alle Fenster
// schickt. Das Feld „Terminal shell“ zeigt die gefundenen Shells (Ticket 11).
//
// Wie die Rückfragen (popup/Dialogs.tsx): Der Fokus bleibt im Dialog, Escape schliesst auch ohne Fokus darin, Enter in
// einem Feld bestätigt (auf einem Knopf wirkt der Knopf selbst).

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type AppSettings, type CodiumApi, type JdkInfo, type ShellId, type ShellInfo } from '../shared/types';
import { errorText } from './errors';
import { keepFocusInside } from './popup/Dialogs';

/** Mindestversion von Java für den Java-Sprachserver; ältere JDKs stehen nicht zur Auswahl. */
const MIN_JDK = 25;

/** Wert der Auswahl für „Newest detected“. */
const NEWEST = '';

/** Vergleicht Windows-Pfade ohne Gross-/Kleinschreibung und unabhängig von „/“ oder „\“ und einem Trenner am Ende. */
const samePath = (a: string, b: string) => {
  const norm = (p: string) => p.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
  return norm(a) === norm(b);
};

interface SettingsDialogProps {
  api: CodiumApi;
  settings: AppSettings;
  onClose: () => void;
}

type JdkState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; jdks: JdkInfo[] };

export function SettingsDialog({ api, settings, onClose }: SettingsDialogProps) {
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [jdk, setJdk] = useState(settings.jdk ?? NEWEST);
  const [jdks, setJdks] = useState<JdkState>({ status: 'loading' });
  const [shell, setShell] = useState<string>(settings.terminalShell ?? DEFAULT_SHELL);
  const [shells, setShells] = useState<{ shells: ShellInfo[]; standard: ShellId | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousFocus = useRef<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const id = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement;
    firstField.current?.select();
    let live = true;
    api.request('app.shells').then(
      (result) => {
        if (live) setShells(result);
      },
      () => {},
    );
    api.request('app.jdks').then(
      (result) => {
        if (live) setJdks({ status: 'ready', jdks: result.jdks });
      },
      (err: unknown) => {
        console.error('JDKs nicht gelesen:', err);
        if (live) setJdks({ status: 'failed' });
      },
    );
    // Escape und Tab über das Fenster: So schliesst Escape auch, wenn der Fokus nicht im Dialog liegt, und Tab bleibt
    // im Dialog (Review von Ticket 09).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
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

  const size = Number(fontSize);
  const sizeValid = fontSize.trim() !== '' && Number.isInteger(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE;
  const usable = jdks.status === 'ready' ? jdks.jdks.filter((j) => j.major >= MIN_JDK) : [];
  const newest = usable.find((j) => !j.version.includes('-ea')) ?? usable[0];
  // Ein eingestelltes JDK, das (noch) nicht in der Liste steht, bleibt sichtbar, damit es nicht still verschwindet.
  const configuredMissing = jdk !== NEWEST && !usable.some((j) => samePath(j.path, jdk));

  const save = async () => {
    if (!sizeValid) return;
    try {
      // Das JDK nur, wenn es geändert wurde: Ein eingestelltes, inzwischen fehlendes JDK lehnte der Kern sonst ab.
      const chosen = jdk === NEWEST ? null : jdk;
      // Ebenso die Shell: nur, wenn sie geändert wurde.
      const chosenShell = shell === DEFAULT_SHELL ? null : (shell as ShellId);
      await api.request('app.updateSettings', {
        fontSize: size,
        ...(chosen !== settings.jdk ? { jdk: chosen } : {}),
        ...(chosenShell !== settings.terminalShell ? { terminalShell: chosenShell } : {}),
      });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const newestLabel =
    jdks.status !== 'ready' ? 'Newest detected' : newest ? `Newest detected (${jdkLabel(newest)})` : 'Newest detected (none found)';
  const hint =
    jdks.status === 'loading'
      ? 'Looking for JDKs…'
      : jdks.status === 'failed'
        ? 'The installed JDKs could not be determined.'
        : usable.length === 0
          ? `No JDK ${MIN_JDK} or newer found. Java language features need one.`
          : `Java ${MIN_JDK} or newer. Older JDKs for older projects can stay installed.`;

  return createPortal(
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="dialog settings-dialog"
        onKeyDown={(e) => {
          // Enter bestätigt nur in einem Feld; auf „Cancel“ bleibt es „Cancel“ (Review von Ticket 09).
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div id={`${id}-title`} className="dialog-title">
          Settings
        </div>
        <div className="settings-grid">
          <label htmlFor={`${id}-font`}>Editor font size</label>
          <div>
            <input
              ref={firstField}
              id={`${id}-font`}
              className="settings-input"
              type="number"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              aria-invalid={!sizeValid}
            />
            {!sizeValid && <p className="settings-error">{`A whole number from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.`}</p>}
          </div>
          <label htmlFor={`${id}-shell`}>Terminal shell</label>
          <div>
            <select id={`${id}-shell`} className="settings-input" value={shell} onChange={(e) => setShell(e.target.value)}>
              <option value={DEFAULT_SHELL}>{defaultShellLabel(shells)}</option>
              {shells?.shells.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.name} – ${s.path}`}
                </option>
              ))}
              {shells && shell !== DEFAULT_SHELL && !shells.shells.some((s) => s.id === shell) && <option value={shell}>{`${shell} (not found)`}</option>}
            </select>
            <p className="settings-hint">New terminals use this shell; open terminals keep theirs.</p>
          </div>
          <label htmlFor={`${id}-jdk`}>JDK for Java language server</label>
          <div>
            <select id={`${id}-jdk`} className="settings-input" value={jdk} onChange={(e) => setJdk(e.target.value)}>
              <option value={NEWEST}>{newestLabel}</option>
              {usable.map((j) => (
                <option key={j.path} value={j.path}>
                  {`${jdkLabel(j)} – ${j.path}`}
                </option>
              ))}
              {configuredMissing && (
                <option value={jdk}>{jdks.status === 'ready' ? `${jdk} (not found)` : jdk}</option>
              )}
            </select>
            <p className="settings-hint">{hint}</p>
          </div>
        </div>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button-primary" disabled={!sizeValid} onClick={() => void save()}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Wert der Auswahl für „Default“ (PowerShell 7, sonst Windows PowerShell). */
const DEFAULT_SHELL = '';

function defaultShellLabel(shells: { shells: ShellInfo[]; standard: ShellId | null } | null): string {
  if (!shells) return 'Default';
  const standard = shells.shells.find((s) => s.id === shells.standard);
  return standard ? `Default (${standard.name})` : 'Default (none found)';
}

function jdkLabel(jdk: JdkInfo): string {
  const vendor = jdk.vendor ? `${jdk.vendor} ` : '';
  return `${vendor}${jdk.version}`;
}
