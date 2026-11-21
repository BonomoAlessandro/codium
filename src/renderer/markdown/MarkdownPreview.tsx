// Markdown-Vorschau neben dem Editor (oder allein): rendert aus dem Modell des Editors, entprellt etwa 200 ms nach der
// letzten Eingabe, auch vor dem Speichern. Das HTML wird mit DOMPurify bereinigt (keine Skripte, keine
// Ereignis-Attribute, keine eingebetteten Seiten oder Formulare). Danach:
// - Code-Blöcke bekommen Monacos Farben in der Sprache aus der Angabe nach den Backticks.
// - Mermaid-Blöcke werden zu SVG (dunkles Schema, strenge Sicherheitsstufe); die Bibliothek lädt erst dann.
// - Bilder mit relativem Pfad im Projekt kommen als Daten über den Vertrag; andere zeigen ihren Alternativtext.
// - Web-Links öffnen im Standardbrowser; relative Links und Anker zeigen ihr Ziel nur als Tooltip.
// - In der geteilten Ansicht scrollt die Vorschau zum Block der obersten sichtbaren Editorzeile.

import DOMPurify from 'dompurify';
import { useEffect, useRef } from 'react';
import type { Mermaid } from 'mermaid';
import type { CodiumApi } from '../../shared/types';
import { monaco } from '../editor/monaco';
import { blockForLine, classifyLink, renderMarkdown, resolveImagePath } from './markdown';

/** So lange nach der letzten Eingabe wird neu gerendert. */
const RENDER_DELAY_MS = 200;

interface MarkdownPreviewProps {
  api: CodiumApi;
  model: monaco.editor.ITextModel;
  filePath: string;
  projectPath: string;
  /** Oberste sichtbare Editorzeile (ab 1) für das synchrone Scrollen; `null`, wenn die Vorschau allein steht. */
  topLine: number | null;
}

const purifier = DOMPurify(window);
// Bilder laden nie selbst (auch keine aus dem Netz): Ihre Adresse wandert nach `data-src`, die Vorschau setzt danach
// Daten aus dem Projekt ein oder zeigt den Alternativtext.
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'IMG') {
    const element = node as Element;
    element.setAttribute('data-src', element.getAttribute('src') ?? '');
    element.removeAttribute('src');
    element.removeAttribute('srcset');
  }
});

const SANITIZE_OPTIONS = {
  FORBID_TAGS: ['style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'video', 'audio', 'source'],
  ADD_ATTR: ['data-source-line', 'data-lang', 'aria-checked', 'aria-disabled'],
};

export function MarkdownPreview({ api, model, filePath, projectPath, topLine }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  // Rendern beim Öffnen und nach jeder Eingabe (entprellt).
  useEffect(() => {
    let timer: number | null = null;
    const render = () => {
      const container = containerRef.current;
      if (!container) return;
      const gen = ++generation.current;
      const { html, hasMermaid } = renderMarkdown(model.getValue());
      const scroll = container.scrollTop;
      container.innerHTML = purifier.sanitize(html, SANITIZE_OPTIONS);
      container.scrollTop = scroll;
      decorate(container, { api, filePath, projectPath, hasMermaid, isCurrent: () => gen === generation.current });
    };
    render();
    const listener = model.onDidChangeContent(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(render, RENDER_DELAY_MS);
    });
    return () => {
      listener.dispose();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [api, model, filePath, projectPath]);

  // Synchrones Scrollen: Der Block zur obersten sichtbaren Editorzeile steht oben (nur Editor → Vorschau).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || topLine === null) return;
    // In der Reihenfolge des Dokuments; bei gleicher Zeile (Liste und ihr erster Punkt) zählt der äussere Block.
    const sorted = [...container.querySelectorAll<HTMLElement>('[data-source-line]')]
      .map((el) => ({ el, line: Number(el.dataset.sourceLine) }))
      .filter((block, i, all) => i === 0 || all[i - 1].line !== block.line)
      .sort((a, b) => a.line - b.line);
    const index = blockForLine(
      sorted.map((b) => b.line),
      topLine,
    );
    if (index < 0) return;
    const target = sorted[index].el;
    container.scrollTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8;
  }, [topLine]);

  return (
    <div
      ref={containerRef}
      className="markdown-preview"
      role="document"
      aria-label="Markdown Preview"
      onClick={(e) => {
        const link = (e.target as Element).closest('a');
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute('href') ?? '';
        if (classifyLink(href) === 'web') void api.request('app.openExternal', { url: href }).catch(() => {});
      }}
    />
  );
}

interface DecorateOptions {
  api: CodiumApi;
  filePath: string;
  projectPath: string;
  hasMermaid: boolean;
  /** Ob dieses Rendern noch das aktuelle ist; ein späteres macht ältere Nacharbeiten überflüssig. */
  isCurrent: () => boolean;
}

/** Farben für Code, Mermaid, Bilder und Links nach dem Einsetzen des bereinigten HTML. */
function decorate(container: HTMLElement, { api, filePath, projectPath, hasMermaid, isCurrent }: DecorateOptions): void {
  // Links: Tooltip mit dem Ziel; Web-Links öffnen beim Klick (siehe oben).
  for (const link of container.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    link.title = href;
    link.removeAttribute('target');
  }

  // Code-Blöcke in den Farben von Monaco.
  for (const pre of container.querySelectorAll<HTMLElement>('pre.md-code')) {
    const code = pre.querySelector('code');
    const language = languageForFence(pre.dataset.lang ?? '');
    if (!code || !language) continue;
    void monaco.editor.colorize(code.textContent ?? '', language, { tabSize: 4 }).then((colored) => {
      if (isCurrent()) code.innerHTML = colored;
    });
  }

  // Bilder: nur relative Pfade im Projekt, über den Vertrag; sonst der Alternativtext.
  for (const img of container.querySelectorAll<HTMLImageElement>('img')) {
    const target = resolveImagePath(filePath, img.dataset.src ?? '', projectPath);
    const showAlt = () => {
      if (!img.isConnected) return;
      const alt = document.createElement('span');
      alt.className = 'md-image-alt';
      alt.textContent = img.alt || img.dataset.src || '';
      alt.title = img.dataset.src ?? '';
      img.replaceWith(alt);
    };
    if (target === null) {
      showAlt();
      continue;
    }
    api.request('files.readImage', { path: target }).then(
      ({ dataUrl }) => {
        if (isCurrent()) img.src = dataUrl;
      },
      () => {
        if (isCurrent()) showAlt();
      },
    );
  }

  // Mermaid: erst jetzt laden, dann jedes Diagramm für sich; ein fehlerhaftes zeigt seine Meldung.
  if (hasMermaid) {
    void loadMermaid().then(async (mermaid) => {
      let index = 0;
      for (const block of container.querySelectorAll<HTMLElement>('.md-mermaid')) {
        if (!isCurrent()) return;
        const source = block.textContent ?? '';
        try {
          const { svg } = await mermaid.render(`codium-mermaid-${Date.now()}-${index++}`, source);
          if (isCurrent()) block.innerHTML = svg;
        } catch (err) {
          if (!isCurrent()) return;
          block.textContent = '';
          const message = document.createElement('div');
          message.className = 'md-mermaid-error';
          message.setAttribute('role', 'note');
          message.textContent = `Mermaid: ${(err as Error).message ?? String(err)}`;
          block.append(message);
        }
      }
    }, () => {});
  }
}

let mermaidLoading: Promise<Mermaid> | null = null;

/** Lädt Mermaid aus den eigenen Dateien (einmal je Fenster). */
function loadMermaid(): Promise<Mermaid> {
  mermaidLoading ??= new Promise<Mermaid>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './mermaid.js';
    script.onload = () => {
      const mermaid = (globalThis as unknown as { codiumMermaid?: Mermaid }).codiumMermaid;
      if (!mermaid) {
        reject(new Error('Mermaid fehlt.'));
        return;
      }
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', fontFamily: 'Segoe UI, sans-serif' });
      resolve(mermaid);
    };
    script.onerror = () => {
      mermaidLoading = null;
      reject(new Error('Mermaid liess sich nicht laden.'));
    };
    document.head.append(script);
  });
  return mermaidLoading;
}

/** Die Sprache von Monaco zu einer Angabe nach den Backticks (Name, Alias oder Endung); `null`, wenn unbekannt. */
function languageForFence(fence: string): string | null {
  const wanted = fence.trim().toLowerCase();
  if (wanted === '') return null;
  for (const language of monaco.languages.getLanguages()) {
    if (language.id.toLowerCase() === wanted) return language.id;
    if (language.aliases?.some((a) => a.toLowerCase() === wanted)) return language.id;
    if (language.extensions?.some((e) => e.toLowerCase() === `.${wanted}`)) return language.id;
  }
  return null;
}
