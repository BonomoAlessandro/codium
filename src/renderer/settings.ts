// Die Einstellungen in der Oberfläche: beim Start vom Kern geladen, danach bei jeder Änderung aktualisiert (der Kern
// schickt sie an alle Fenster). Bis sie geladen sind, gelten die Standardwerte.

import { useEffect, useState } from 'react';
import { DEFAULT_FONT_SIZE, type AppSettings, type CodiumApi } from '../shared/types';

export const DEFAULT_SETTINGS: AppSettings = { fontSize: DEFAULT_FONT_SIZE, jdk: null, terminalShell: null };

export function useSettings(api: CodiumApi): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let changed = false;
    const off = api.on('app.settingsChanged', (next) => {
      changed = true;
      setSettings(next);
    });
    api.request('app.settings').then(
      // Kam schon eine Änderung, ist sie neuer als die Antwort.
      (loaded) => {
        if (!changed) setSettings(loaded);
      },
      (err: unknown) => console.error('Einstellungen nicht geladen:', err),
    );
    return off;
  }, [api]);
  return settings;
}
