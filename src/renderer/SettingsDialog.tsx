// Einstellungsdialog (Ctrl + Alt + S, „Settings…“ im Projektmenü): Schriftgrösse der Editoren und JDK für den
// Java-Sprachserver. Die Einstellungen gelten für alle Projekte; „OK“ speichert sie im Kern, der sie an alle Fenster
// schickt. Das Feld „Terminal shell“ kommt mit Ticket 11.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type AppSettings, type CodiumApi, type JdkInfo } from '../shared/types';
import { errorText } from './errors';

/** Mindestversion von Java für den Java-Sprachserver; ältere JDKs stehen nicht zur Auswahl. */
const MIN_JDK = 25;

/** Wert der Auswahl für „Newest detected“. */
const NEWEST = '';

interface SettingsDialogProps {
  api: CodiumApi;
  settings: AppSettings;
  onClose: () => void;
}

export function SettingsDialog({ api, settings, onClose }: SettingsDialogProps) {
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [jdk, setJdk] = useState(settings.jdk ?? NEWEST);
  const [jdks, setJdks] = useState<{ jdks: JdkInfo[]; forLanguageServer: JdkInfo | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousFocus = useRef<Element | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement;
    firstField.current?.select();
    let live = true;
    api.request('app.jdks').then(
      (result) => {
        if (live) setJdks(result);
      },
      (err: unknown) => console.error('JDKs nicht gelesen:', err),
    );
    return () => {
      live = false;
      const restore = previousFocus.current;
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true });
    };
  }, [api]);

  const size = Number(fontSize);
  const sizeValid = Number.isInteger(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE;
  const usable = jdks?.jdks.filter((j) => j.major >= MIN_JDK) ?? [];
  const newest = usable[0];
  // Ein eingestelltes JDK, das nicht mehr erkannt wird, bleibt sichtbar, damit es nicht still verschwindet.
  const unknownConfigured = jdk !== NEWEST && jdks !== null && !usable.some((j) => j.path.toLowerCase() === jdk.toLowerCase());

  const save = async () => {
    if (!sizeValid) return;
    try {
      await api.request('app.updateSettings', { fontSize: size, jdk: jdk === NEWEST ? null : jdk });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return createPortal(
    <div className="dialog-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="dialog settings-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
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
          <label htmlFor={`${id}-jdk`}>JDK for Java language server</label>
          <div>
            <select id={`${id}-jdk`} className="settings-input" value={jdk} onChange={(e) => setJdk(e.target.value)}>
              <option value={NEWEST}>{newest ? `Newest detected (${jdkLabel(newest)})` : 'Newest detected (none found)'}</option>
              {usable.map((j) => (
                <option key={j.path} value={j.path}>
                  {`${jdkLabel(j)} – ${j.path}`}
                </option>
              ))}
              {unknownConfigured && <option value={jdk}>{`${jdk} (not found)`}</option>}
            </select>
            <p className="settings-hint">
              {jdks === null
                ? 'Looking for JDKs…'
                : usable.length === 0
                  ? `No JDK ${MIN_JDK} or newer found. Java language features need one.`
                  : `Java ${MIN_JDK} or newer. Older JDKs for older projects can stay installed.`}
            </p>
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

function jdkLabel(jdk: JdkInfo): string {
  const vendor = jdk.vendor ? `${jdk.vendor} ` : '';
  return `${vendor}${jdk.version}`;
}
