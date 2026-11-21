// Fortschritt laufender Arbeiten des Kerns (mehrere zusammengefasst): links in der Statusleiste des Projektfensters
// und unten im Willkommensfenster (etwa beim Klonen, Ticket 10).

import { summarizeProgress, type RunningWork } from './progress';

export function ProgressIndicator({ work }: { work: readonly RunningWork[] }) {
  const summary = summarizeProgress(work);
  const percent = summary?.fraction === undefined ? undefined : Math.round(summary.fraction * 100);
  return (
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
  );
}
