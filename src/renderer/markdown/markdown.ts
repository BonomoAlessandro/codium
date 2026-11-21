// Markdown-Vorschau: reine Funktionen ohne DOM, damit sie sich in Node prüfen lassen. Markdown wird mit markdown-it
// (CommonMark, Tabellen, Durchstreichen) und einer kleinen Regel für Aufgabenlisten zu HTML; jeder Block trägt seine
// erste Quellzeile (`data-source-line`, ab 1) für das synchrone Scrollen. Code-Blöcke und Mermaid-Diagramme werden nur
// markiert; Farben und Diagramme setzt die Vorschau danach (MarkdownPreview.tsx). Das HTML ist noch nicht bereinigt.

import markdownIt, { type MarkdownIt, type RendererRule } from 'markdown-it';

export interface RenderedMarkdown {
  html: string;
  /** Ob es Mermaid-Blöcke gibt: nur dann lädt die Vorschau die (grosse) Mermaid-Bibliothek. */
  hasMermaid: boolean;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Blöcke, die ihre Quellzeile tragen. */
const SOURCE_LINE_TOKENS = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'table_open',
  'tr_open',
  'hr',
  'html_block',
  'code_block',
]);

function createRenderer(): MarkdownIt {
  const md = markdownIt({ html: true, linkify: true, typographer: false });

  // Quellzeilen an den Blöcken.
  md.core.ruler.push('source_lines', (state) => {
    for (const token of state.tokens) {
      if (token.map && SOURCE_LINE_TOKENS.has(token.type)) token.attrSet('data-source-line', String(token.map[0] + 1));
    }
  });

  // HTML im Markdown: Ereignis-Attribute (onerror, onclick …) fallen schon hier weg. DOMPurify entfernt sie ebenfalls,
  // aber schon sein Einlesen meldet Chromium als Verstoss gegen die Sicherheitsrichtlinie (ausgeführt wird nichts).
  md.core.ruler.push('strip_event_handlers', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'html_block') token.content = stripEventHandlers(token.content);
      for (const child of token.children ?? []) {
        if (child.type === 'html_inline') child.content = stripEventHandlers(child.content);
      }
    }
  });

  // Aufgabenlisten wie auf GitHub: „[ ]“ bzw. „[x]“ am Anfang eines Listenpunkts.
  md.core.ruler.push('task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const match = /^\[([ xX])\]\s/.exec(inline.content);
      const first = inline.children?.[0];
      if (!match || !first || first.type !== 'text') continue;
      const checked = match[1] !== ' ';
      first.content = first.content.slice(match[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<span class="md-task${checked ? ' checked' : ''}" role="checkbox" aria-checked="${checked}" aria-disabled="true"></span>`;
      inline.children!.unshift(box);
      tokens[i - 2].attrJoin('class', 'md-task-item');
    }
  });

  // Code-Blöcke: Mermaid als eigener Block, sonst mit Sprache für die Farben von Monaco.
  const fence: RendererRule = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0] ?? '';
    const line = token.map ? ` data-source-line="${token.map[0] + 1}"` : '';
    if (lang.toLowerCase() === 'mermaid') return `<div class="md-mermaid"${line}>${escapeHtml(token.content)}</div>\n`;
    const langAttr = lang === '' ? '' : ` data-lang="${escapeHtml(lang)}"`;
    return `<pre class="md-code"${langAttr}${line}><code>${escapeHtml(token.content)}</code></pre>\n`;
  };
  md.renderer.rules.fence = fence;
  return md;
}

let renderer: MarkdownIt | null = null;

/** Markdown in HTML (unbereinigt) mit Quellzeilen an den Blöcken. */
export function renderMarkdown(text: string): RenderedMarkdown {
  renderer ??= createRenderer();
  const tokens = renderer.parse(text, {});
  const hasMermaid = tokens.some((t) => t.type === 'fence' && t.info.trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid');
  return { html: renderer.renderer.render(tokens, renderer.options, {}), hasMermaid };
}

/** Entfernt Ereignis-Attribute (`on…=`) aus rohem HTML; das Bereinigen danach bleibt DOMPurify. */
export function stripEventHandlers(html: string): string {
  return html.replace(/[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ' ');
}

/** Was ein Link in der Vorschau ist: Web-Adresse (öffnet den Browser), Anker, relativer Link oder etwas anderes. */
export type LinkKind = 'web' | 'anchor' | 'relative' | 'other';

export function classifyLink(href: string): LinkKind {
  const value = href.trim();
  if (value.startsWith('#')) return 'anchor';
  if (/^(https?:\/\/|mailto:)/i.test(value)) return 'web';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('\\\\')) return 'other';
  return 'relative';
}

/**
 * Der Pfad eines Bildes aus der Vorschau, relativ zum Ordner der Markdown-Datei; `null` für Web-Adressen, absolute Pfade,
 * andere Schemata (`data:`, `file:`) und Pfade ausserhalb des Projekts. Windows-Pfade mit „\“.
 */
export function resolveImagePath(markdownFile: string, src: string, projectRoot: string): string | null {
  let value = src.trim().replace(/[?#].*$/, '');
  if (value === '' || classifyLink(value) !== 'relative' || /^[\\/]/.test(value)) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (/^[a-z]:/i.test(value)) return null;
  const parts = markdownFile.split(/[\\/]/).slice(0, -1);
  for (const segment of value.split(/[\\/]/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length <= 1) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const resolved = parts.join('\\');
  const root = projectRoot.replace(/[\\/]+$/, '').toLowerCase();
  return resolved.toLowerCase().startsWith(`${root}\\`) ? resolved : null;
}

/**
 * Der Block der Vorschau, der zur obersten sichtbaren Editorzeile gehört: der letzte, der an oder vor ihr beginnt.
 * `startLines` sind die Quellzeilen der Blöcke in der Reihenfolge des Dokuments; `-1` ohne Blöcke.
 */
export function blockForLine(startLines: readonly number[], line: number): number {
  let found = startLines.length > 0 ? 0 : -1;
  for (let i = 0; i < startLines.length; i++) {
    if (startLines[i] <= line) found = i;
    else break;
  }
  return found;
}

/** Ob eine Datei eine Markdown-Datei ist (Vorschau mit „Editor“, „Split“, „Preview“). */
export function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}
