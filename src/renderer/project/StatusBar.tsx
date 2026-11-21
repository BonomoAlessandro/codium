// Statusleiste: links der Fortschritt laufender Arbeiten des Kerns (mehrere zusammengefasst), rechts die Plätze für
// Zeile:Spalte, Zeilenende und Kodierung (gefüllt ab Ticket 05 bzw. 07).

import { summarizeProgress, type RunningWork } from '../progress';

export function StatusBar({ work }: { work: readonly RunningWork[] }) {
  const summary = summarizeProgress(work);
  const percent = summary?.fraction === undefined ? undefined : Math.round(summary.fraction * 100);
  return (
    <footer className="statusbar">
      <div className="status-progress" title={summary?.titles.join('\n')}>
        {summary && (
          <>
            <span className="status-progress-text">{summary.text}</span>
            <div
              className="progress-bar"
              role="progressbar"
              aria-label={summary.text}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className={percent === undefined ? 'progress-fill indeterminate' : 'progress-fill'}
                style={percent === undefined ? undefined : { width: `${percent}%` }}
              />
            </div>
          </>
        )}
      </div>
      <div className="status-spacer" />
      <span className="status-item status-position" aria-label="Line and column" />
      <span className="status-item status-line-ending" aria-label="Line ending" />
      <span className="status-item status-encoding" aria-label="Encoding" />
    </footer>
  );
}
