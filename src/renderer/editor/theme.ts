// Monaco-Farbschema nach dem IntelliJ-Editorschema „Dark“ (neues Design). Reine Daten ohne Monaco und ohne DOM,
// damit es sich in Node prüfen lässt; monaco.ts meldet es an.
//
// - Wortarten: Monarch-Token der mitgelieferten Sprachen (etwa `keyword.java`, `tag.xml`, `type.yaml`). Monaco
//   vergleicht nach Präfix, die Endung mit der Sprache ist für Ausnahmen da.
// - Semantische Token (ab Ticket 13 vom Sprach-Dienst): Monaco sucht `typ.modifikator1.modifikator2` in der
//   Reihenfolge, in der der Sprachserver die Modifikatoren nennt. Deshalb gibt es die Regeln für jede Reihenfolge.

/** Eine Regel für ein Token, im Format von Monaco (Farben ohne `#`). */
export interface TokenRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

/** Farben des IntelliJ-Schemas „Dark“. */
export const SCHEME = {
  background: '#1e1f22',
  text: '#bcbec4',
  keyword: '#cf8e6d',
  string: '#6aab73',
  number: '#2aacb8',
  comment: '#7a7e85',
  docComment: '#5f826b',
  annotation: '#b3ae60',
  field: '#c77dbb',
  methodDeclaration: '#56a8f5',
  typeParameter: '#16baac',
  tag: '#d5b778',
  attribute: '#bababa',
  escape: '#cf8e6d',
  regexp: '#42c3d4',
} as const;

const hex = (color: string) => color.slice(1);

/** Wortarten der Monarch-Sprachen. */
const SYNTAX_RULES: TokenRule[] = [
  { token: '', foreground: hex(SCHEME.text) },
  { token: 'keyword', foreground: hex(SCHEME.keyword) },
  { token: 'string', foreground: hex(SCHEME.string) },
  { token: 'string.escape', foreground: hex(SCHEME.escape) },
  { token: 'string.invalid', foreground: 'f75464' },
  { token: 'number', foreground: hex(SCHEME.number) },
  { token: 'comment', foreground: hex(SCHEME.comment) },
  { token: 'comment.doc', foreground: hex(SCHEME.docComment), fontStyle: 'italic' },
  { token: 'annotation', foreground: hex(SCHEME.annotation) },
  { token: 'regexp', foreground: hex(SCHEME.regexp) },
  { token: 'type', foreground: hex(SCHEME.text) },
  { token: 'identifier', foreground: hex(SCHEME.text) },
  { token: 'delimiter', foreground: hex(SCHEME.text) },
  { token: 'operator', foreground: hex(SCHEME.text) },
  { token: 'predefined', foreground: hex(SCHEME.text) },
  // XML und HTML: Tags gelb, Attributnamen grau, Werte grün.
  { token: 'tag', foreground: hex(SCHEME.tag) },
  { token: 'metatag', foreground: hex(SCHEME.tag) },
  { token: 'delimiter.xml', foreground: hex(SCHEME.tag) },
  { token: 'delimiter.html', foreground: hex(SCHEME.tag) },
  { token: 'attribute.name', foreground: hex(SCHEME.attribute) },
  { token: 'attribute.value', foreground: hex(SCHEME.string) },
  // CSS: Selektoren wie Tags, Eigenschaften wie Felder.
  { token: 'tag.css', foreground: hex(SCHEME.tag) },
  { token: 'attribute.name.css', foreground: hex(SCHEME.field) },
  { token: 'attribute.value.css', foreground: hex(SCHEME.text) },
  { token: 'attribute.value.number.css', foreground: hex(SCHEME.number) },
  { token: 'attribute.value.unit.css', foreground: hex(SCHEME.number) },
  // JSON (eigene Monarch-Sprache, siehe jsonLanguage.ts): Schlüssel violett, Werte grün.
  { token: 'string.key.json', foreground: hex(SCHEME.field) },
  { token: 'string.value.json', foreground: hex(SCHEME.string) },
  // YAML: Schlüssel wie Schlüsselwörter.
  { token: 'type.yaml', foreground: hex(SCHEME.keyword) },
  // Properties und INI: Schlüssel orange, Werte grün, Abschnitte gelb.
  { token: 'key.ini', foreground: hex(SCHEME.keyword) },
  { token: 'metatag.ini', foreground: hex(SCHEME.tag) },
  // Shell und PowerShell: Variablen violett.
  { token: 'variable.shell', foreground: hex(SCHEME.field) },
  { token: 'variable.ps1', foreground: hex(SCHEME.field) },
  { token: 'variable.predefined', foreground: hex(SCHEME.field) },
  // Markdown: Überschriften orange und fett, Code grün.
  { token: 'keyword.md', foreground: hex(SCHEME.keyword), fontStyle: 'bold' },
  { token: 'variable.source.md', foreground: hex(SCHEME.string) },
  { token: 'string.link.md', foreground: '548af7' },
  { token: 'strong.md', fontStyle: 'bold' },
  { token: 'emphasis.md', fontStyle: 'italic' },
];

/** Modifikatoren, deren Reihenfolge der Sprachserver bestimmt. */
const SEMANTIC_MODIFIERS = ['static', 'readonly', 'declaration'] as const;
type SemanticModifier = (typeof SEMANTIC_MODIFIERS)[number];

/**
 * Darstellung eines semantischen Tokens wie in IntelliJ: Felder und Konstanten violett, statische Member kursiv,
 * Methodendeklarationen blau, Parameter und lokale Variablen in der Grundfarbe. `undefined` heisst: keine eigene
 * Regel, es gilt die des Typs.
 */
function semanticStyle(type: string, modifiers: ReadonlySet<SemanticModifier>): Omit<TokenRule, 'token'> | undefined {
  const italic = modifiers.has('static') ? 'italic' : '';
  switch (type) {
    case 'property':
    case 'enumMember':
      return { foreground: hex(SCHEME.field), fontStyle: type === 'enumMember' ? 'italic' : italic };
    case 'method':
    case 'function':
      return { foreground: hex(modifiers.has('declaration') ? SCHEME.methodDeclaration : SCHEME.text), fontStyle: italic };
    case 'variable':
      // Eine statische Konstante (etwa in TypeScript ein `static readonly`) wie ein Feld.
      if (modifiers.has('static')) return { foreground: hex(SCHEME.field), fontStyle: 'italic' };
      return { foreground: hex(SCHEME.text), fontStyle: '' };
    case 'parameter':
    case 'class':
    case 'interface':
    case 'enum':
    case 'struct':
    case 'namespace':
    case 'type':
      return { foreground: hex(SCHEME.text), fontStyle: italic };
    case 'typeParameter':
      return { foreground: hex(SCHEME.typeParameter), fontStyle: '' };
    case 'annotation':
    case 'decorator':
      return { foreground: hex(SCHEME.annotation), fontStyle: '' };
    case 'keyword':
    case 'modifier':
      return { foreground: hex(SCHEME.keyword), fontStyle: '' };
    case 'string':
      return { foreground: hex(SCHEME.string), fontStyle: '' };
    case 'number':
      return { foreground: hex(SCHEME.number), fontStyle: '' };
    case 'comment':
      return { foreground: hex(SCHEME.comment), fontStyle: '' };
    default:
      return undefined;
  }
}

/** Typen semantischer Token nach dem Language Server Protocol, die das Schema abbildet. */
export const SEMANTIC_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'function',
  'method',
  'annotation',
  'decorator',
  'keyword',
  'modifier',
  'string',
  'number',
  'comment',
] as const;

/** Alle Reihenfolgen aller Teilmengen der Modifikatoren (ohne die leere Menge). */
function modifierOrders(): SemanticModifier[][] {
  const result: SemanticModifier[][] = [];
  const extend = (prefix: SemanticModifier[]) => {
    for (const modifier of SEMANTIC_MODIFIERS) {
      if (prefix.includes(modifier)) continue;
      const next = [...prefix, modifier];
      result.push(next);
      extend(next);
    }
  };
  extend([]);
  return result;
}

/** Regeln für semantische Token: je Typ eine, dazu je Reihenfolge der Modifikatoren eine. */
export function semanticRules(): TokenRule[] {
  const orders = modifierOrders();
  return SEMANTIC_TYPES.flatMap((type) => {
    const base = semanticStyle(type, new Set());
    const rules: TokenRule[] = base ? [{ token: type, ...base }] : [];
    for (const order of orders) {
      const style = semanticStyle(type, new Set(order));
      if (style) rules.push({ token: [type, ...order].join('.'), ...style });
    }
    return rules;
  });
}

/** Farben der Editorfläche, im Format von Monaco. */
export const EDITOR_COLORS: Readonly<Record<string, string>> = {
  'editor.background': SCHEME.background,
  'editor.foreground': SCHEME.text,
  'editorGutter.background': SCHEME.background,
  'editorLineNumber.foreground': '#4b5059',
  'editorLineNumber.activeForeground': '#a1a3ab',
  'editor.lineHighlightBackground': '#26282e',
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': '#214283',
  'editor.inactiveSelectionBackground': '#214283a0',
  'editor.selectionHighlightBackground': '#3a3f4b',
  'editor.wordHighlightBackground': '#373b39',
  'editor.wordHighlightStrongBackground': '#40332b',
  'editor.findMatchBackground': '#32593d',
  'editor.findMatchHighlightBackground': '#2e436e',
  'editorCursor.foreground': '#ced0d6',
  'editorWhitespace.foreground': '#6f737a66',
  'editorIndentGuide.background1': '#393b40',
  'editorIndentGuide.activeBackground1': '#55585e',
  // Klammern sind in IntelliJ nicht nach Paaren gefärbt.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`editorBracketHighlight.foreground${i}`, SCHEME.text])),
  'editorBracketHighlight.unexpectedBracket.foreground': SCHEME.text,
  'editorBracketMatch.background': '#43454a',
  'editorBracketMatch.border': '#00000000',
  'editorOverviewRuler.border': '#00000000',
  'editorWidget.background': '#2b2d30',
  'editorWidget.border': '#4e5157',
  'editorHoverWidget.background': '#2b2d30',
  'editorHoverWidget.border': '#4e5157',
  'editorSuggestWidget.background': '#2b2d30',
  'editorSuggestWidget.border': '#4e5157',
  'editorSuggestWidget.selectedBackground': '#2e436e',
  'input.background': '#1e1f22',
  'input.border': '#4e5157',
  'focusBorder': '#3574f0',
  'scrollbar.shadow': '#00000000',
  'scrollbarSlider.background': '#4e515766',
  'scrollbarSlider.hoverBackground': '#5a5d6399',
  'scrollbarSlider.activeBackground': '#6f737aaa',
  'menu.background': '#2b2d30',
  'menu.foreground': '#dfe1e5',
  'menu.selectionBackground': '#2e436e',
  'menu.border': '#43454a',
};

export const THEME_NAME = 'codium-dark';

/** Das Farbschema für `monaco.editor.defineTheme`. */
export function codiumTheme() {
  return {
    base: 'vs-dark' as const,
    inherit: false,
    rules: [...SYNTAX_RULES, ...semanticRules()],
    colors: EDITOR_COLORS,
  };
}
