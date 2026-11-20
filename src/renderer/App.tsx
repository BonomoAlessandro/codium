// Platzhalter, bis die Oberfläche spezifiziert ist. Zeigt, dass Renderer, Preload und Hauptprozess verbunden sind.

import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/types';

const api = window.codium;

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void api.appInfo().then(setInfo);
  }, []);

  return (
    <main className="placeholder">
      <h1>Codium</h1>
      <p>{info ? `Version ${info.version}` : '…'}</p>
    </main>
  );
}
