// JSON nur mit Farben. Monacos eigene JSON-Sprache gehört zu seinem abgeschalteten Sprachdienst (siehe build.mjs);
// diese kleine Monarch-Sprache färbt Schlüssel, Werte, Zahlen und Schlüsselwörter wie IntelliJ. Kommentare (JSONC)
// werden mitgefärbt. Reine Daten ohne Monaco.

export const JSON_LANGUAGE = {
  id: 'json',
  extensions: ['.json', '.jsonc', '.json5', '.jsonl', '.babelrc', '.eslintrc', '.code-workspace', '.webmanifest', '.har'],
  filenames: ['.prettierrc', '.jshintrc', 'composer.lock'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
};

export const JSON_CONFIGURATION = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] as [string, string] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ] as Array<[string, string]>,
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};

/** Monarch-Regeln; die Token bekommen die Endung `.json` (etwa `string.key.json`). */
export const JSON_MONARCH = {
  tokenPostfix: '.json',
  defaultToken: '',
  tokenizer: {
    root: [
      [/\s+/, ''],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      // Ein String, auf den ein Doppelpunkt folgt, ist ein Schlüssel.
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
      [/"(?:[^"\\]|\\.)*"/, 'string.value'],
      [/"(?:[^"\\]|\\.)*$/, 'string.invalid'],
      [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\]]/, 'delimiter.bracket'],
      [/[,:]/, 'delimiter'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
  },
};
