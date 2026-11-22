// Sprachfunktionen in Monaco über den Sprach-Dienst des Kerns (Ticket 12): Definition (Ctrl + Linksklick, Ctrl + B),
// Verwendungen (als Ersatz, wenn die Definition die Stelle selbst ist), Implementierungen, Hover und Fehler. Monaco hat
// keine eigenen Sprachdienste (siehe build.mjs).
//
// - Dokumente meldet der Code-Bereich (`DocumentSync`): geöffnet, geändert (der ganze Text, auch ungespeichert),
//   geschlossen. Tabs ab 5 MB und schreibgeschützte Ziele nicht.
// - Ziele in anderen Dateien: Bevor Monaco sie bekommt, gibt es für jedes ein Modell (für die Vorschau im Peek und
//   für das Öffnen über den Editor-Opener). Ziele in Bibliotheken kommen über `language.readTarget`.

import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  type CodeLocation,
  type CodiumApi,
  type CompletionEntry,
  type LanguageDiagnostic,
  type TextRange,
} from '../../shared/types';
import { languageOf, monaco } from '../editor/monaco';

/** Monaco-Sprachen, für die der Sprach-Dienst einen Server hat. */
export const SERVER_LANGUAGES = ['typescript', 'javascript'];

const SERVER_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

/** Ob der Sprach-Dienst eine Datei versteht. */
export function hasLanguageServer(filePath: string): boolean {
  return SERVER_EXTENSIONS.test(filePath);
}

/** Pfad eines Modells in der Schreibweise von Windows. */
export function pathOfUri(uri: monaco.Uri): string {
  const fsPath = uri.fsPath;
  return /^[a-z]:/.test(fsPath) ? fsPath[0].toUpperCase() + fsPath.slice(1) : fsPath;
}

export function toMonacoRange(range: TextRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function at(model: monaco.editor.ITextModel, position: monaco.Position) {
  return { path: pathOfUri(model.uri), line: position.lineNumber - 1, character: position.column - 1 };
}

/** Ziele, die schreibgeschützt öffnen (Bibliotheken); der Code-Bereich fragt hier beim Öffnen eines Tabs nach. */
const readOnlyTargets = new Set<string>();
export function isReadOnlyTarget(filePath: string): boolean {
  return readOnlyTargets.has(filePath.toLowerCase());
}

/** Registriert die Sprachfunktionen in Monaco; liefert eine Funktion zum Abmelden. */
export function registerLanguageFeatures(api: CodiumApi, beforeRequest: (filePath: string) => void): () => void {
  /** Die Stelle einer Anfrage; ausstehende Eingaben gehen vorher an den Kern. */
  const ask = (model: monaco.editor.ITextModel, position: monaco.Position) => {
    beforeRequest(pathOfUri(model.uri));
    return at(model, position);
  };

  /**
   * Modelle für Ziele ohne Tab (Vorschau im Peek): schreibgeschützt, und vor jeder neuen Abfrage frisch angelegt, soweit
   * kein Editor sie zeigt (Review von Ticket 12). Öffnet ein Ziel als Tab, ersetzt der Code-Bereich das Modell.
   */
  const previews = new Set<monaco.editor.ITextModel>();
  const dropUnusedPreviews = () => {
    const shown = new Set(monaco.editor.getEditors().map((e) => e.getModel()));
    for (const model of previews) if (!shown.has(model)) model.dispose();
  };
  const readOnlyPreviews = monaco.editor.onDidCreateEditor((editor) => {
    // Nur, was hier schreibgeschützt wurde, wird wieder freigegeben (der Haupteditor regelt das je Tab selbst).
    let lockedHere = false;
    const update = () => {
      const model = editor.getModel();
      const preview = model !== null && previews.has(model);
      if (preview || lockedHere) editor.updateOptions({ readOnly: preview });
      lockedHere = preview;
    };
    editor.onDidChangeModel(update);
    update();
  });

  /** Legt für jedes Ziel ein Modell an, falls es keines gibt. */
  const withModels = async (locations: CodeLocation[]): Promise<monaco.languages.Location[]> => {
    dropUnusedPreviews();
    const result: monaco.languages.Location[] = [];
    for (const location of locations) {
      const uri = monaco.Uri.file(location.path);
      if (location.readOnly) readOnlyTargets.add(location.path.toLowerCase());
      if (!monaco.editor.getModel(uri)) {
        try {
          const text = location.readOnly
            ? (await api.request('language.readTarget', { path: location.path })).text
            : await readText(api, location.path);
          if (text === null) continue;
          if (!monaco.editor.getModel(uri)) {
            const model = monaco.editor.createModel(text, languageOf(location.path), uri);
            previews.add(model);
            model.onWillDispose(() => previews.delete(model));
          }
        } catch {
          continue;
        }
      }
      result.push({ uri, range: toMonacoRange(location.range) });
    }
    return result;
  };

  const disposables = SERVER_LANGUAGES.flatMap((language) => [
    monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: async (model, position) => withModels(await api.request('language.definition', ask(model, position)).catch(() => [])),
    }),
    monaco.languages.registerReferenceProvider(language, {
      provideReferences: async (model, position) => withModels(await api.request('language.references', ask(model, position)).catch(() => [])),
    }),
    monaco.languages.registerImplementationProvider(language, {
      provideImplementation: async (model, position) =>
        withModels(await api.request('language.implementations', ask(model, position)).catch(() => [])),
    }),
    // Vervollständigung (Ticket 13): automatisch beim Tippen und mit Ctrl + Leertaste; Details beim Auswählen.
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', '"', "'", '`', '/', '@', '<', '#'],
      provideCompletionItems: async (model, position, context) => {
        const result = await api
          .request('language.completion', {
            ...ask(model, position),
            ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}),
          })
          .catch(() => null);
        if (!result) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return { incomplete: result.incomplete, suggestions: result.items.map((entry) => completionItem(entry, fallback)) };
      },
      resolveCompletionItem: async (item) => {
        const id = completionIds.get(item);
        if (id === undefined) return item;
        const details = await api.request('language.resolveCompletion', { id }).catch(() => null);
        if (details?.detail) item.detail = details.detail;
        if (details?.documentation) item.documentation = { value: details.documentation, isTrusted: false, supportHtml: false };
        return item;
      },
    }),
    // Semantische Färbung (Ticket 13) mit der gemeinsamen Legende; die Farben stehen im Schema (theme.ts).
    monaco.languages.registerDocumentSemanticTokensProvider(language, {
      getLegend: () => ({ tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS] }),
      provideDocumentSemanticTokens: async (model) => {
        const filePath = pathOfUri(model.uri);
        beforeRequest(filePath);
        const version = model.getVersionId();
        const result = await api.request('language.semanticTokens', { path: filePath }).catch(() => null);
        // Hat sich der Text inzwischen geändert, fragt Monaco ohnehin neu.
        if (!result || model.isDisposed() || model.getVersionId() !== version) return null;
        return { data: new Uint32Array(result.data) };
      },
      releaseDocumentSemanticTokens: () => {},
    }),
    monaco.languages.registerHoverProvider(language, {
      provideHover: async (model, position) => {
        const hover = await api.request('language.hover', ask(model, position)).catch(() => null);
        if (!hover) return null;
        return {
          contents: [{ value: hover.markdown, isTrusted: false, supportHtml: false }],
          ...(hover.range ? { range: toMonacoRange(hover.range) } : {}),
        };
      },
    }),
  ]);

  // Fehler und Warnungen als Markierungen; kommen sie vor dem Modell, gelten sie, sobald es da ist.
  const pending = new Map<string, LanguageDiagnostic[]>();
  const apply = (model: monaco.editor.ITextModel, diagnostics: LanguageDiagnostic[]) => {
    monaco.editor.setModelMarkers(model, 'codium-language', diagnostics.map(toMarker));
  };
  const offDiagnostics = api.on('language.diagnostics', ({ path, diagnostics }) => {
    const model = monaco.editor.getModel(monaco.Uri.file(path));
    if (model) apply(model, diagnostics);
    else pending.set(path.toLowerCase(), diagnostics);
  });
  const created = monaco.editor.onDidCreateModel((model) => {
    const diagnostics = pending.get(pathOfUri(model.uri).toLowerCase());
    if (diagnostics) apply(model, diagnostics);
  });

  return () => {
    for (const d of disposables) d.dispose();
    offDiagnostics();
    created.dispose();
    readOnlyPreviews.dispose();
    for (const model of [...previews]) model.dispose();
  };
}

/** Kennung eines Vorschlags beim Kern, für das Nachladen der Details. */
const completionIds = new WeakMap<monaco.languages.CompletionItem, number>();

/** CompletionItemKind von LSP (1–25) in die Art von Monaco. */
const COMPLETION_KINDS: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter,
};

function completionItem(entry: CompletionEntry, fallback: monaco.IRange): monaco.languages.CompletionItem {
  const item: monaco.languages.CompletionItem = {
    label: entry.label,
    kind: COMPLETION_KINDS[entry.kind] ?? monaco.languages.CompletionItemKind.Text,
    insertText: entry.insertText,
    range: entry.range ? toMonacoRange(entry.range) : fallback,
    ...(entry.snippet ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
    ...(entry.detail ? { detail: entry.detail } : {}),
    ...(entry.documentation ? { documentation: { value: entry.documentation, isTrusted: false, supportHtml: false } } : {}),
    ...(entry.sortText ? { sortText: entry.sortText } : {}),
    ...(entry.filterText ? { filterText: entry.filterText } : {}),
    ...(entry.commitCharacters ? { commitCharacters: entry.commitCharacters } : {}),
  };
  completionIds.set(item, entry.id);
  return item;
}

async function readText(api: CodiumApi, filePath: string): Promise<string | null> {
  const content = await api.request('files.read', { path: filePath });
  return content.kind === 'text' ? content.text : null;
}

function toMarker(d: LanguageDiagnostic): monaco.editor.IMarkerData {
  const severity =
    d.severity === 'error'
      ? monaco.MarkerSeverity.Error
      : d.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : d.severity === 'info'
          ? monaco.MarkerSeverity.Info
          : monaco.MarkerSeverity.Hint;
  return {
    ...toMonacoRange(d.range),
    severity,
    message: d.message,
    ...(d.source ? { source: d.source } : {}),
    ...(d.code ? { code: d.code } : {}),
    ...(d.tags
      ? { tags: d.tags.map((t) => (t === 'unnecessary' ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated)) }
      : {}),
  };
}

/** Meldet die Dokumente des Code-Bereichs an den Sprach-Dienst. */
export class DocumentSync {
  private readonly open = new Map<string, { model: monaco.editor.ITextModel; listener: monaco.IDisposable; timer: number | null }>();

  constructor(private readonly api: CodiumApi) {}

  /** Ein Tab mit Text: meldet das Dokument, wenn es einen Server gibt. */
  didOpen(filePath: string, model: monaco.editor.ITextModel): void {
    if (!hasLanguageServer(filePath)) return;
    this.didClose(filePath);
    const k = filePath.toLowerCase();
    const entry = {
      model,
      timer: null as number | null,
      listener: model.onDidChangeContent(() => {
        if (entry.timer !== null) window.clearTimeout(entry.timer);
        // Kurz bündeln: Schnelles Tippen schickt nicht bei jedem Zeichen den ganzen Text.
        entry.timer = window.setTimeout(() => {
          entry.timer = null;
          this.send('language.didChange', filePath, model);
        }, 100);
      }),
    };
    this.open.set(k, entry);
    this.send('language.didOpen', filePath, model);
  }

  /** Vor einer Anfrage an den Kern: ausstehende Änderungen sofort melden. */
  flush(filePath: string): void {
    const entry = this.open.get(filePath.toLowerCase());
    if (!entry || entry.timer === null) return;
    window.clearTimeout(entry.timer);
    entry.timer = null;
    this.send('language.didChange', filePath, entry.model);
  }

  didClose(filePath: string): void {
    const k = filePath.toLowerCase();
    const entry = this.open.get(k);
    if (!entry) return;
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    entry.listener.dispose();
    this.open.delete(k);
    void this.api.request('language.didClose', { path: filePath }).catch(() => {});
  }

  dispose(): void {
    for (const entry of this.open.values()) {
      if (entry.timer !== null) window.clearTimeout(entry.timer);
      entry.listener.dispose();
    }
    this.open.clear();
  }

  private send(name: 'language.didOpen' | 'language.didChange', filePath: string, model: monaco.editor.ITextModel): void {
    if (model.isDisposed()) return;
    void this.api.request(name, { path: filePath, text: model.getValue(), version: model.getVersionId() }).catch(() => {});
  }
}
