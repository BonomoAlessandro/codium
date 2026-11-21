// Statusleiste: links der Fortschritt laufender Arbeiten des Kerns (mehrere zusammengefasst), rechts die Plätze für
// Zeile:Spalte, Zeilenende und Kodierung (gefüllt ab Ticket 05 bzw. 07).

import { ProgressIndicator } from '../ProgressIndicator';
import type { RunningWork } from '../progress';

export function StatusBar({ work }: { work: readonly RunningWork[] }) {
  return (
    <footer className="statusbar">
      <ProgressIndicator work={work} />
      <div className="status-spacer" />
      <span className="status-item status-position" aria-label="Line and column" />
      <span className="status-item status-line-ending" aria-label="Line ending" />
      <span className="status-item status-encoding" aria-label="Encoding" />
    </footer>
  );
}
