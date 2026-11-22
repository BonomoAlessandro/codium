// Vergleichsansicht (Ticket 17) mit Monacos Vergleichsansicht: nebeneinander oder in einer Spalte, Pfeile für nächste
// und vorherige Änderung, Syntaxfarben wie im Editor. Links der alte Stand (schreibgeschützt); rechts beim Vergleich mit
// dem Arbeitsordner das gemeinsame Modell der Datei (bearbeitbar, automatisch gespeichert), bei Vergleichen aus der
// Historie ein schreibgeschützter Text.

import { useEffect, useRef, useState } from 'react';
import { EDITOR_FONT_FAMILY, monaco } from './monaco';

interface DiffViewProps {
  title: string;
  /** Linke Seite; `null`, solange sie noch geholt wird. */
  original: string | null;
  language: string;
  /** Rechte Seite: das Modell der Datei, oder ein fester Text; `null`, solange die Datei noch lädt. */
  modified: monaco.editor.ITextModel | { text: string } | null;
  fontSize: number;
  /** Meldet den Diff-Editor, damit der Code-Bereich ein Modell vor dem Entsorgen freigeben kann. */
  onEditor: (editor: monaco.editor.IStandaloneDiffEditor | null) => void;
}

export function DiffView({ title, original, language, modified, fontSize, onEditor }: DiffViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [sideBySide, setSideBySide] = useState(true);

  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(hostRef.current!, {
      automaticLayout: true,
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize,
      lineHeight: 1.4,
      originalEditable: false,
      renderSideBySide: true,
      // Die Spalten wechselt nur der Knopf, nicht die Fensterbreite (sonst stimmte seine Beschriftung nicht; Review).
      useInlineViewWhenSpaceIsLimited: false,
      minimap: { enabled: false },
      ignoreTrimWhitespace: false,
      renderOverviewRuler: true,
      scrollBeyondLastLine: false,
      ariaLabel: title,
    });
    editorRef.current = editor;
    onEditor(editor);
    return () => {
      // Erst die Modelle lösen: Das der Datei gehört dem Code-Bereich und lebt weiter.
      editorRef.current = null;
      onEditor(null);
      editor.setModel(null);
      editor.dispose();
    };
    // Die Schriftgrösse folgt unten; der Titel ändert sich nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide });
  }, [sideBySide]);

  // Modelle: links immer ein eigenes, rechts das der Datei oder ein eigenes für einen festen Text.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || modified === null || original === null) return;
    const left = monaco.editor.createModel(original, language);
    const ownRight = 'text' in modified ? monaco.editor.createModel(modified.text, language) : null;
    editor.setModel({ original: left, modified: ownRight ?? (modified as monaco.editor.ITextModel) });
    editor.getModifiedEditor().updateOptions({ readOnly: ownRight !== null });
    return () => {
      // Beim Schliessen der Ansicht ist der Editor schon entsorgt (Effekte räumen in ihrer Reihenfolge auf).
      if (editorRef.current === editor) editor.setModel(null);
      left.dispose();
      ownRight?.dispose();
    };
  }, [original, language, modified]);

  const go = (target: 'next' | 'previous') => {
    const editor = editorRef.current as (monaco.editor.IStandaloneDiffEditor & { goToDiff?: (t: 'next' | 'previous') => void }) | null;
    editor?.goToDiff?.(target);
    editor?.getModifiedEditor().focus();
  };

  return (
    <div className="diff-view">
      <div className="diff-toolbar" role="toolbar" aria-label="Diff">
        <button type="button" className="icon-button" aria-label="Previous Difference" title="Previous Difference" onClick={() => go('previous')}>
          ↑
        </button>
        <button type="button" className="icon-button" aria-label="Next Difference" title="Next Difference" onClick={() => go('next')}>
          ↓
        </button>
        <button type="button" aria-pressed={!sideBySide} onClick={() => setSideBySide((v) => !v)}>
          {sideBySide ? 'Unified' : 'Side-by-side'}
        </button>
        <span className="diff-title">{title}</span>
      </div>
      <div ref={hostRef} className="diff-host" role="region" aria-label={`Diff ${title}`} />
      {(modified === null || original === null) && <p className="tool-window-placeholder">Loading…</p>}
    </div>
  );
}
