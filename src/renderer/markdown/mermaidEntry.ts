// Eigene gebündelte Datei (dist/renderer/mermaid.js) für Mermaid: Die Bibliothek ist gross und wird erst geladen, wenn
// eine Markdown-Datei ein Diagramm enthält (siehe MarkdownPreview.tsx). Sie legt sich unter `globalThis.codiumMermaid`
// ab.

import mermaid from 'mermaid';

(globalThis as unknown as { codiumMermaid: typeof mermaid }).codiumMermaid = mermaid;
