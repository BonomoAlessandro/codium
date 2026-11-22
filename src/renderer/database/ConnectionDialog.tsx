// Dialog einer Datenbank-Verbindung (Ticket 20): Name, Host, Port, Datenbank, Benutzer, Passwort, SSL und „Ask for
// password every time“, mit „Test Connection“. Das Passwort geht nur an den Kern, der es verschlüsselt speichert.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CodiumApi, DbConnection, DbConnectionInput } from '../../shared/types';
import { errorText } from '../errors';
import { keepFocusInside } from '../popup/Dialogs';

interface ConnectionDialogProps {
  api: CodiumApi;
  /** Die zu bearbeitende Verbindung; ohne eine neue. */
  connection?: DbConnection;
  onSaved: (connection: DbConnection) => void;
  onClose: () => void;
}

export function ConnectionDialog({ api, connection, onSaved, onClose }: ConnectionDialogProps) {
  const [fields, setFields] = useState({
    name: connection?.name ?? '',
    host: connection?.host ?? 'localhost',
    port: String(connection?.port ?? 5432),
    database: connection?.database ?? 'postgres',
    user: connection?.user ?? 'postgres',
  });
  const [password, setPassword] = useState('');
  const [ssl, setSsl] = useState(connection?.ssl ?? false);
  const [askPassword, setAskPassword] = useState(connection?.askPassword ?? false);
  /** Ein gespeichertes Passwort entfernen (Review). */
  const [clearPassword, setClearPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const id = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement;
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
      window.removeEventListener('keydown', onKeyDown, true);
      const restore = previousFocus.current;
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true });
    };
  }, []);

  const port = Number(fields.port);
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  const ready = !busy && portValid && fields.name.trim() !== '' && fields.host.trim() !== '' && fields.database.trim() !== '' && fields.user.trim() !== '';
  const input = (): DbConnectionInput => ({
    name: fields.name.trim(),
    host: fields.host.trim(),
    port,
    database: fields.database.trim(),
    user: fields.user.trim(),
    ssl,
    askPassword,
  });
  // Ein leeres Feld beim Bearbeiten heisst: das gespeicherte Passwort behalten.
  const typedPassword = password === '' ? undefined : password;

  const test = async () => {
    if (!ready) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await api.request('db.testConnection', {
        connection: input(),
        ...(typedPassword !== undefined ? { password: typedPassword } : {}),
        ...(connection && typedPassword === undefined ? { id: connection.id } : {}),
      });
      setStatus({ ok: true, text: `Connected: PostgreSQL ${result.serverVersion}` });
    } catch (err) {
      setStatus({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const saved = await api.request('db.saveConnection', {
        ...(connection ? { id: connection.id } : {}),
        connection: input(),
        // Mit „Ask for password every time“ gilt das Feld nur für „Test Connection“ und wird nie gespeichert.
        ...(askPassword ? {} : clearPassword ? { password: '' } : typedPassword !== undefined ? { password: typedPassword } : {}),
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setStatus({ ok: false, text: errorText(err) });
      setBusy(false);
    }
  };

  const field = (key: keyof typeof fields, label: string, extra: { autoFocus?: boolean; inputMode?: 'numeric' } = {}) => (
    <>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className={key === 'port' && !portValid ? 'settings-input invalid' : 'settings-input'}
        value={fields[key]}
        spellCheck={false}
        autoComplete="off"
        disabled={busy}
        {...extra}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
      />
    </>
  );

  return createPortal(
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="dialog connection-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div id={`${id}-title`} className="dialog-title">
          {connection ? 'Edit Connection' : 'New Connection'}
        </div>
        <div className="settings-grid">
          {field('name', 'Name', { autoFocus: true })}
          {field('host', 'Host')}
          {field('port', 'Port', { inputMode: 'numeric' })}
          {field('database', 'Database')}
          {field('user', 'User')}
          <label htmlFor={`${id}-password`}>Password</label>
          <input
            id={`${id}-password`}
            className="settings-input"
            type="password"
            value={password}
            autoComplete="off"
            disabled={busy || clearPassword}
            placeholder={askPassword ? 'Only for Test Connection, not saved' : connection?.hasPassword ? 'Saved (leave empty to keep)' : ''}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {connection?.hasPassword && !askPassword && (
          <label className="settings-check">
            <input type="checkbox" checked={clearPassword} disabled={busy} onChange={(e) => setClearPassword(e.target.checked)} />
            Remove saved password
          </label>
        )}
        <label className="settings-check">
          <input type="checkbox" checked={askPassword} disabled={busy} onChange={(e) => setAskPassword(e.target.checked)} />
          Ask for password every time
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={ssl} disabled={busy} onChange={(e) => setSsl(e.target.checked)} />
          SSL (encrypted, certificate not verified)
        </label>
        {status && (
          <p className={status.ok ? 'settings-hint' : 'settings-error'} role={status.ok ? 'status' : 'alert'}>
            {status.text}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="dialog-left-button" disabled={!ready} onClick={() => void test()}>
            Test Connection
          </button>
          <button type="button" className="button-primary" disabled={!ready} onClick={() => void save()}>
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
