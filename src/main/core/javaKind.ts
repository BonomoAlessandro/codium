// Art einer Java-Datei für ihr Symbol im Dateibaum (Ticket 32): eine reine Funktion, Text rein, Art raus, ohne
// Electron und ohne Sprachserver. Sie liest nur so viel Struktur, wie das Symbol braucht. Lädt nie Electron.
//
// - Übersprungen werden Leerraum, Kommentare (auch Javadoc), Strings, Textblöcke und Zeichen, dazu `package`,
//   `import` (auch `import static` und `import module`) und Annotationen vor einem Typ.
// - Gezählt werden die obersten Typen (class, interface, enum, record, @interface); was in ihrem Rumpf steht, zählt
//   nicht. Wie in IntelliJ (ClassesTreeStructureProvider) bekommt eine Datei die Art ihres Typs nur, wenn sie genau
//   einen obersten Typ hat und dieser so heisst wie die Datei, mit Gross-/Kleinschreibung. Sonst ist sie eine
//   „Java-Datei“ (`java`), ebenso `package-info.java`, `module-info.java` und eine Datei ohne Typ.
// - Die Arten folgen IntelliJ (ElementPresentationUtil): Annotation, Enum, Record und Interface nach dem
//   Schlüsselwort; eine Klasse mit dem Modifikator `abstract` ist abstrakt. Ausnahme ist eine Klasse, deren Oberklasse
//   nach ihrem Namen eine Ausnahme ist (`…Exception`, `…Error`, `Throwable`); IntelliJ prüft die ganze Vererbung, das
//   geht ohne Sprachserver nicht (Grenzen im Ticket).
// - Fehlertoleranz: Ein Syntaxfehler vor dem ersten Typ oder in seinem Kopf ergibt `java`. Endet der Text in einem
//   Rumpf (etwa nach den gelesenen 64 KB oder bei einer offenen Klammer mitten im Tippen), zählen die Typen bis dahin;
//   ebenso bei Unerwartetem nach dem ersten vollständigen Typ. So bleibt das Symbol beim Tippen ruhig, wie in IntelliJ,
//   dessen Parser Fehler ebenfalls übergeht.

import type { JavaKind } from '../../shared/types';

/** Modifikatoren vor einem obersten Typ (`non-sealed` wird eigens gelesen). */
const MODIFIERS = new Set(['public', 'protected', 'private', 'abstract', 'static', 'final', 'sealed', 'strictfp']);

/** Schlüsselwörter und Literale; sie kommen in keinem Namen vor. */
const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default',
  'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import',
  'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return',
  'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
  'void', 'volatile', 'while', 'true', 'false', 'null', '_',
]);

/** Dazu die eingeschränkten Namen, die kein Typ tragen darf (in Paketnamen sind sie erlaubt). */
const RESTRICTED_TYPE_NAMES = new Set([...KEYWORDS, 'var', 'yield', 'record', 'sealed', 'permits']);

type TypeKeyword = 'class' | 'interface' | 'enum' | 'record' | '@interface';

interface TypeDeclaration {
  keyword: TypeKeyword;
  name: string;
  isAbstract: boolean;
  /** Der einfache Name der Oberklasse (`a.b.Base<T>` → `Base`), `null` ohne `extends`. */
  superclass: string | null;
}

/** Ein Wort (Bezeichner oder Schlüsselwort), ein Satzzeichen oder ein Literal (String, Textblock, Zeichen, Zahl). */
type Token = { type: 'word'; text: string } | { type: 'punct'; text: string } | { type: 'literal' };

/**
 * Die Art einer Java-Datei aus ihrem Text (oder dessen Anfang) und ihrem Dateinamen samt Endung, etwa
 * `OrderService.java`. Wirft nie.
 */
export function javaKindOf(text: string, fileName: string): JavaKind {
  const base = fileName.replace(/\.java$/i, '');
  const types = new Parser(text).topLevelTypes();
  if (types === null || types.length !== 1 || types[0].name !== base) return 'java';
  return kindOf(types[0]);
}

function kindOf(type: TypeDeclaration): JavaKind {
  switch (type.keyword) {
    case '@interface':
      return 'annotation';
    case 'enum':
      return 'enum';
    case 'record':
      return 'record';
    case 'interface':
      return 'interface';
    case 'class':
      if (type.superclass !== null && isThrowableName(type.superclass)) return type.isAbstract ? 'abstractException' : 'exception';
      return type.isAbstract ? 'abstractClass' : 'class';
  }
}

/** Ob eine Oberklasse nach ihrem Namen eine Ausnahme ist. */
function isThrowableName(name: string): boolean {
  return name === 'Throwable' || name.endsWith('Exception') || name.endsWith('Error');
}

const isAsciiIdentStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36;
const isAsciiIdentPart = (c: number) => isAsciiIdentStart(c) || (c >= 48 && c <= 57);
const UNICODE_IDENT_START = /[\p{L}\p{Nl}\p{Sc}\p{Pc}]/u;
const UNICODE_IDENT_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]/u;

class Parser {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /** Die obersten Typen; `null` bei einem Syntaxfehler vor dem ersten Typ oder in seinem Kopf. */
  topLevelTypes(): TypeDeclaration[] | null {
    const types: TypeDeclaration[] = [];
    let modifiers = { any: false, keyword: false, isAbstract: false };
    const resetModifiers = () => (modifiers = { any: false, keyword: false, isAbstract: false });
    let canPackage = true;
    let canImport = true;
    for (;;) {
      const token = this.next();
      if (token === null) break;
      let keyword: TypeKeyword | null = null;
      if (token.type === 'punct' && token.text === ';' && !modifiers.any) continue;
      if (token.type === 'punct' && token.text === '@') {
        if (this.peekWord('interface')) {
          this.next();
          keyword = '@interface';
        } else if (this.annotationRest()) {
          modifiers.any = true;
          continue;
        }
      } else if (token.type === 'word') {
        const word = token.text;
        if (word === 'package' && canPackage && !modifiers.keyword && types.length === 0) {
          if (!this.qualifiedName(false) || !this.punct(';')) return null;
          canPackage = false;
          resetModifiers();
          continue;
        }
        if (word === 'import' && canImport && !modifiers.any && types.length === 0) {
          // `import static a.B.c;` und, seit Java 25 (JEP 511), `import module java.base;`; `import module.Foo;` ist ein Paket.
          if (this.peekWord('static') || this.isModuleImport()) this.next();
          if (!this.qualifiedName(true) || !this.punct(';')) return null;
          canPackage = false;
          continue;
        }
        if (MODIFIERS.has(word) || (word === 'non' && this.nonSealedRest())) {
          modifiers = { any: true, keyword: true, isAbstract: modifiers.isAbstract || word === 'abstract' };
          canPackage = false;
          canImport = false;
          continue;
        }
        if (word === 'class' || word === 'interface' || word === 'enum') keyword = word;
        else if (word === 'record' && this.looksLikeRecord()) keyword = 'record';
      }
      const declaration = keyword === null ? null : this.typeHeader(keyword, modifiers.isAbstract);
      if (declaration === null) {
        // Unerwartetes: vor dem ersten Typ ein Syntaxfehler, danach zählen die Typen bis hier.
        return types.length === 0 ? null : types;
      }
      types.push(declaration);
      resetModifiers();
      canPackage = false;
      canImport = false;
      // Endet der Text im Rumpf, zählen die Typen bis hier.
      if (!this.skipBody()) break;
    }
    return types;
  }

  /**
   * Der Kopf eines Typs nach dem Schlüsselwort, bis und mit `{`: Name, dazu bei einer Klasse der Name der Oberklasse.
   * `null` bei einem Fehler (kein Name, `;` oder `}` im Kopf, Ende des Textes).
   */
  private typeHeader(keyword: TypeKeyword, isAbstract: boolean): TypeDeclaration | null {
    const name = this.next();
    if (name === null || name.type !== 'word' || RESTRICTED_TYPE_NAMES.has(name.text)) return null;
    let angles = 0;
    let parens = 0;
    let readingSuperclass = false;
    let superclass: string | null = null;
    for (;;) {
      const token = this.next();
      if (token === null) return null;
      if (token.type === 'punct') {
        const c = token.text;
        if (c === '{' && angles === 0 && parens === 0) break;
        if (c === '{' || c === '}' || c === ';') return null;
        if (c === '<') {
          angles++;
          readingSuperclass = false;
        } else if (c === '>') {
          if (--angles < 0) return null;
        } else if (c === '(') parens++;
        else if (c === ')') {
          if (--parens < 0) return null;
        } else if (c === '@') {
          if (!this.annotationRest()) return null;
        } else if (c === ',') readingSuperclass = false;
        continue;
      }
      if (token.type !== 'word' || angles > 0 || parens > 0) continue;
      if (token.text === 'extends' && keyword === 'class' && superclass === null) readingSuperclass = true;
      else if (token.text === 'extends' || token.text === 'implements' || token.text === 'permits') readingSuperclass = false;
      else if (readingSuperclass) superclass = token.text;
    }
    return { keyword, name: name.text, isAbstract, superclass };
  }

  /** Nach `@`: ein (qualifizierter) Name und Argumente in Klammern, falls vorhanden. */
  private annotationRest(): boolean {
    if (!this.qualifiedName(false)) return false;
    const save = this.pos;
    const open = this.next();
    if (open === null || open.type !== 'punct' || open.text !== '(') {
      this.pos = save;
      return true;
    }
    let depth = 1;
    while (depth > 0) {
      const token = this.next();
      if (token === null) return false;
      if (token.type === 'punct' && token.text === '(') depth++;
      else if (token.type === 'punct' && token.text === ')') depth--;
    }
    return true;
  }

  /** `a.b.C`, mit `wildcard` auch `a.b.*`. */
  private qualifiedName(wildcard: boolean): boolean {
    for (;;) {
      const part = this.next();
      if (part === null) return false;
      if (part.type === 'word' ? KEYWORDS.has(part.text) : !(wildcard && part.type === 'punct' && part.text === '*')) return false;
      if (part.type === 'punct') return true;
      const save = this.pos;
      const dot = this.next();
      if (dot === null || dot.type !== 'punct' || dot.text !== '.') {
        this.pos = save;
        return true;
      }
    }
  }

  /** Nach `non`: `-sealed`. */
  private nonSealedRest(): boolean {
    const save = this.pos;
    if (this.punct('-') && this.peekWord('sealed')) {
      this.next();
      return true;
    }
    this.pos = save;
    return false;
  }

  /** Nach `import`: `module` gefolgt von einem Wort (nicht von `.`) ist ein Modul-Import. */
  private isModuleImport(): boolean {
    const save = this.pos;
    const first = this.next();
    const second = this.next();
    this.pos = save;
    return first?.type === 'word' && first.text === 'module' && second?.type === 'word';
  }

  /** `record` ist nur vor `Name(` bzw. `Name<` ein Schlüsselwort. */
  private looksLikeRecord(): boolean {
    const save = this.pos;
    const name = this.next();
    const after = this.next();
    this.pos = save;
    return name?.type === 'word' && after?.type === 'punct' && (after.text === '(' || after.text === '<');
  }

  private punct(text: string): boolean {
    const token = this.next();
    return token !== null && token.type === 'punct' && token.text === text;
  }

  private peekWord(text: string): boolean {
    const save = this.pos;
    const token = this.next();
    this.pos = save;
    return token !== null && token.type === 'word' && token.text === text;
  }

  /** Das nächste Token nach Leerraum und Kommentaren; `null` am Ende des Textes. */
  private next(): Token | null {
    this.skipTrivia();
    const s = this.text;
    const start = this.pos;
    if (start >= s.length) return null;
    const c = s.charCodeAt(start);
    if (isAsciiIdentStart(c) || (c > 127 && UNICODE_IDENT_START.test(s[start]))) {
      let end = start + 1;
      while (end < s.length) {
        const d = s.charCodeAt(end);
        if (!(isAsciiIdentPart(d) || (d > 127 && UNICODE_IDENT_PART.test(s[end])))) break;
        end++;
      }
      this.pos = end;
      return { type: 'word', text: s.slice(start, end) };
    }
    if (c >= 48 && c <= 57) {
      // Eine Zahl, grob: Ziffern, Buchstaben, Unterstriche und Punkte (1_000L, 0x1F, 1.5e3).
      let end = start + 1;
      while (end < s.length && (isAsciiIdentPart(s.charCodeAt(end)) || s.charCodeAt(end) === 46)) end++;
      this.pos = end;
      return { type: 'literal' };
    }
    if (c === 34 || c === 39) {
      this.pos = this.skipQuoted(start);
      return { type: 'literal' };
    }
    this.pos = start + 1;
    return { type: 'punct', text: s[start] };
  }

  /** Überspringt Leerraum und Kommentare; ein offener Blockkommentar reicht bis zum Ende. */
  private skipTrivia(): void {
    const s = this.text;
    let i = this.pos;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) i++;
      else if (c === 47 && s.charCodeAt(i + 1) === 47) i = this.lineEnd(i);
      else if (c === 47 && s.charCodeAt(i + 1) === 42) i = this.blockCommentEnd(i);
      else break;
    }
    this.pos = i;
  }

  /**
   * Überspringt einen Rumpf nach `{` bis zur passenden `}`, samt Strings, Textblöcken, Zeichen und Kommentaren darin.
   * `false`, wenn der Text vorher endet.
   */
  private skipBody(): boolean {
    const s = this.text;
    let i = this.pos;
    let depth = 1;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 123) {
        depth++;
        i++;
      } else if (c === 125) {
        i++;
        if (--depth === 0) {
          this.pos = i;
          return true;
        }
      } else if (c === 34 || c === 39) i = this.skipQuoted(i);
      else if (c === 47 && s.charCodeAt(i + 1) === 47) i = this.lineEnd(i);
      else if (c === 47 && s.charCodeAt(i + 1) === 42) i = this.blockCommentEnd(i);
      else i++;
    }
    this.pos = i;
    return false;
  }

  /**
   * Das Ende eines Strings, Textblocks oder Zeichens ab dem öffnenden Anführungszeichen. Ein String oder ein Zeichen
   * ohne Ende endet mit der Zeile, ein Textblock ohne Ende mit dem Text.
   */
  private skipQuoted(start: number): number {
    const s = this.text;
    const quote = s.charCodeAt(start);
    if (quote === 34 && s.charCodeAt(start + 1) === 34 && s.charCodeAt(start + 2) === 34) {
      let i = start + 3;
      while (i < s.length) {
        const c = s.charCodeAt(i);
        if (c === 92) i += 2;
        else if (c === 34 && s.charCodeAt(i + 1) === 34 && s.charCodeAt(i + 2) === 34) return i + 3;
        else i++;
      }
      return s.length;
    }
    let i = start + 1;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === quote) return i + 1;
      else if (c === 10 || c === 13) return i;
      else i++;
    }
    return s.length;
  }

  private lineEnd(start: number): number {
    const end = this.text.indexOf('\n', start);
    return end < 0 ? this.text.length : end + 1;
  }

  private blockCommentEnd(start: number): number {
    const end = this.text.indexOf('*/', start + 2);
    return end < 0 ? this.text.length : end + 2;
  }
}
