// Statusleiste: links der Fortschritt laufender Arbeiten des Kerns (mehrere zusammengefasst), rechts Zeile:Spalte,
// Zeilenende und Kodierung des aktiven Text-Tabs.

import type { TextEncoding } from '../../shared/types';
import type { EditorStatus } from '../editor/EditorArea';
import { ProgressIndicator } from '../ProgressIndicator';
import type { RunningWork } from '../progress';

/** Anzeige der Kodierung wie in IntelliJ. */
export const ENCODING_LABELS: Record<TextEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  'windows-1252': 'windows-1252',
};

export function StatusBar({ work, editor }: { work: readonly RunningWork[]; editor: EditorStatus | null }) {
  return (
    <footer className="statusbar">
      <ProgressIndicator work={work} />
      <div className="status-spacer" />
      <span className="status-item status-position" aria-label="Line and column">
        {editor ? `${editor.line}:${editor.column}` : ''}
      </span>
      <span className="status-item status-line-ending" aria-label="Line ending">
        {editor?.lineEnding ?? ''}
      </span>
      <span className="status-item status-encoding" aria-label="Encoding">
        {editor ? ENCODING_LABELS[editor.encoding] : ''}
      </span>
    </footer>
  );
}
