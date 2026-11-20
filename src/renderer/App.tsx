// Platzhalter, bis die Oberfläche in den folgenden Tickets entsteht. Zeigt, dass Renderer, Preload und Kern
// über den Vertrag verbunden sind.

import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/types';

const api = window.codium;

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void api.request('app.info').then(setInfo);
  }, []);

  return (
    <main className="placeholder">
      <h1>Codium</h1>
      <p>{info ? `Version ${info.version}` : '…'}</p>
    </main>
  );
}
