// Reine Funktionen der Markdown-Vorschau ohne DOM: HTML mit Quellzeilen, Aufgabenlisten, Code und Mermaid, Bildpfade,
// Links und die Zuordnung einer Editorzeile zu einem Block.

import { describe, expect, it } from 'vitest';
import { blockForLine, classifyLink, isMarkdownFile, mermaidSource, renderMarkdown, resolveImagePath, stripEventHandlers } from '../../src/renderer/markdown/markdown';

const ROOT = 'C:\\work\\Alpha';

describe('Markdown in HTML', () => {
  it('trägt die Quellzeilen an den Blöcken', () => {
    const { html } = renderMarkdown('# Titel\n\nText\n\n- a\n- b\n');
    expect(html).toContain('<h1 data-source-line="1">Titel</h1>');
    expect(html).toContain('<p data-source-line="3">Text</p>');
    expect(html).toContain('<li data-source-line="5">');
    expect(html).toContain('<li data-source-line="6">');
  });

  it('kennt Tabellen, Durchstreichen und Aufgabenlisten wie GitHub', () => {
    const { html } = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n\n~~weg~~\n\n- [ ] offen\n- [x] erledigt\n');
    expect(html).toContain('<table data-source-line="1">');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<s>weg</s>');
    expect(html).toMatch(/<li class="md-task-item" data-source-line="7"><span class="md-task" role="checkbox" aria-checked="false"[^>]*><\/span>offen<\/li>|<li[^>]*class="md-task-item"[^>]*><span class="md-task"[^>]*aria-checked="false"/);
    expect(html).toMatch(/<span class="md-task checked"[^>]*aria-checked="true"[^>]*><\/span>erledigt/);
  });

  it('markiert Code-Blöcke mit Sprache und erkennt Mermaid', () => {
    const code = renderMarkdown('```ts\nconst a = <b>;\n```\n');
    expect(code.html).toBe('<pre class="md-code" data-lang="ts" data-source-line="1"><code>const a = &lt;b&gt;;\n</code></pre>\n');
    expect(code.hasMermaid).toBe(false);
    const diagram = renderMarkdown('Text\n\n```mermaid\ngraph LR\n  A --> B\n```\n');
    expect(diagram.hasMermaid).toBe(true);
    expect(diagram.html).toContain('<div class="md-mermaid" data-source-line="3">graph LR\n  A --&gt; B\n</div>');
  });
});

describe('HTML im Markdown', () => {
  it('lässt Ereignis-Attribute schon vor dem Bereinigen weg', () => {
    const { html } = renderMarkdown('<img src="x" onerror="alert(1)">\n\nText <b onclick=\'x()\'>fett</b> und <a href="#" ONMOUSEOVER=y>a</a>\n');
    expect(html).not.toMatch(/on(error|click|mouseover)/i);
    expect(html).toContain('<img src="x"');
    expect(html).toContain('fett</b>');
  });
});

describe('Bildpfade', () => {
  const md = `${ROOT}\\docs\\guide.md`;

  it('löst relative Pfade gegen den Ordner der Datei auf', () => {
    expect(resolveImagePath(md, 'img/shot.png', ROOT)).toBe(`${ROOT}\\docs\\img\\shot.png`);
    expect(resolveImagePath(md, './a b.png', ROOT)).toBe(`${ROOT}\\docs\\a b.png`);
    expect(resolveImagePath(md, 'a%20b.png', ROOT)).toBe(`${ROOT}\\docs\\a b.png`);
    expect(resolveImagePath(md, '../logo.svg?raw=1', ROOT)).toBe(`${ROOT}\\logo.svg`);
  });

  it('lehnt Pfade ausserhalb des Projekts, absolute Pfade und Web-Adressen ab', () => {
    expect(resolveImagePath(md, '../../outside.png', ROOT)).toBeNull();
    expect(resolveImagePath(md, '../../Alpha2/x.png', ROOT)).toBeNull();
    expect(resolveImagePath(md, 'C:\\temp\\x.png', ROOT)).toBeNull();
    expect(resolveImagePath(md, '/x.png', ROOT)).toBeNull();
    expect(resolveImagePath(md, '\\\\server\\share\\x.png', ROOT)).toBeNull();
    expect(resolveImagePath(md, 'https://example.com/x.png', ROOT)).toBeNull();
    expect(resolveImagePath(md, 'data:image/png;base64,AAAA', ROOT)).toBeNull();
    expect(resolveImagePath(md, 'file:///C:/x.png', ROOT)).toBeNull();
  });
});

describe('Links und Zeilen', () => {
  it('ordnet Links ein', () => {
    expect(classifyLink('https://example.com')).toBe('web');
    expect(classifyLink('mailto:a@b.ch')).toBe('web');
    expect(classifyLink('#abschnitt')).toBe('anchor');
    expect(classifyLink('docs/specs/codium-v1.md')).toBe('relative');
    expect(classifyLink('javascript:alert(1)')).toBe('other');
    expect(classifyLink('file:///C:/x')).toBe('other');
  });

  it('findet den Block zur obersten sichtbaren Editorzeile', () => {
    const starts = [1, 3, 10, 20];
    expect(blockForLine(starts, 1)).toBe(0);
    expect(blockForLine(starts, 9)).toBe(1);
    expect(blockForLine(starts, 10)).toBe(2);
    expect(blockForLine(starts, 500)).toBe(3);
    expect(blockForLine([], 5)).toBe(-1);
    expect(isMarkdownFile('README.MD')).toBe(true);
    expect(isMarkdownFile('notes.txt')).toBe(false);
  });
});

describe('Funde aus dem Review', () => {
  it('lässt Text zwischen Tags beim Entfernen der Ereignis-Attribute stehen', () => {
    expect(stripEventHandlers('<div>\nThe service is online = true, see only=3\n</div>')).toBe('<div>\nThe service is online = true, see only=3\n</div>');
    expect(stripEventHandlers('<p class="a" onclick="x()">only=3</p>')).toBe('<p class="a" >only=3</p>');
  });

  it('macht HTML in Mermaid-Beschriftungen zu Text, Pfeile bleiben', () => {
    expect(mermaidSource('A["<img src=x onerror=y>"] <--> B</br>')).toBe('A["#lt;img src=x onerror=y>"] <--> B#lt;/br>');
    expect(mermaidSource('A --> B\nB <-- C')).toBe('A --> B\nB <-- C');
  });
});
