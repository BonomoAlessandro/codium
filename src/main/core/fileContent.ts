// Erkennt, was eine Datei für einen Tab ist: Bild, Text (mit Kodierung und Zeilenende) oder Binärdatei. Reine
// Funktionen ohne Dateizugriff; das Lesen und die Grössengrenzen übernimmt der Datei-Dienst. Lädt nie Electron.
//
// Reihenfolge nach der Spezifikation („Editor, Tabs und Speichern“): BOM, Null-Bytes in den ersten 8 KB, gültiges
// UTF-8, sonst Windows-1252. Bilder erkennt Codium vorher an der Endung; SVG ist Text. Geschrieben wird in derselben
// Kodierung, mit demselben BOM und Zeilenende (`encodeText`).

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { LARGE_FILE_BYTES, type FileContent, type LineEnding, type TextEncoding } from '../../shared/types';

/** So viele Bytes am Anfang werden nach Null-Bytes durchsucht. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/** Bilder, die als Bild erscheinen, nach Endung (klein geschrieben) mit ihrem Medientyp. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

/** Der Medientyp eines Bildes nach der Endung, `undefined` für alles andere (auch SVG). */
export function imageType(fileName: string): string | undefined {
  return IMAGE_TYPES[path.extname(fileName).toLowerCase()];
}

/** Erkennt den Inhalt einer gelesenen Datei. */
export function decodeFileContent(fileName: string, data: Buffer): FileContent {
  const size = data.length;
  const mime = imageType(fileName);
  if (mime) return { kind: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}`, size };
  const decoded = decodeText(data);
  if (decoded === null) return { kind: 'binary', size };
  return {
    kind: 'text',
    text: decoded.text,
    encoding: decoded.encoding,
    lineEnding: lineEndingOf(decoded.text),
    size,
    large: size >= LARGE_FILE_BYTES,
    stamp: stampOf(data),
  };
}

/** Der Stand einer Datei: ein Hash ihrer Bytes (unabhängig von Zeitstempeln, die Werkzeuge auch zurücksetzen). */
export function stampOf(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex');
}

/**
 * Setzt die Zeilenenden eines neuen Textes so, dass gleich gebliebene Zeilen am Anfang und am Ende ihr bisheriges
 * Zeilenende behalten (auch einzelne CR und gemischte Dateien); dazwischen, bei neuen und geänderten Zeilen, gilt
 * `lineEnding`. Der neue Text kommt aus dem Editor mit beliebigen Umbrüchen.
 */
export function withPreservedLineEndings(oldText: string, newText: string, lineEnding: LineEnding): string {
  const old = splitLines(oldText);
  const lines = newText.split(/\r\n|\r|\n/);
  const fallback = lineEnding === 'CRLF' ? '\r\n' : '\n';
  let prefix = 0;
  while (prefix < lines.length && prefix < old.lines.length && lines[prefix] === old.lines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < lines.length - prefix &&
    suffix < old.lines.length - prefix &&
    lines[lines.length - 1 - suffix] === old.lines[old.lines.length - 1 - suffix]
  ) suffix++;
  const shift = old.lines.length - lines.length;
  let result = lines[0];
  const oldMiddle = old.lines.length - suffix - prefix;
  for (let j = 0; j < lines.length - 1; j++) {
    // Der Umbruch nach Zeile j: im gleichen Anfang und vor einer Zeile des gleichen Endes der alte; im geänderten
    // Bereich der Reihe nach die der alten Zeilen dort; darüber hinaus (eingefügte Zeilen) `lineEnding`.
    let separator = fallback;
    if (j < prefix && j < old.separators.length) separator = old.separators[j];
    else if (j + 1 >= lines.length - suffix && j + shift >= 0 && j + shift < old.separators.length) separator = old.separators[j + shift];
    else if (j - prefix < oldMiddle && j < old.separators.length) separator = old.separators[j];
    result += separator + lines[j + 1];
  }
  return result;
}

function splitLines(text: string): { lines: string[]; separators: string[] } {
  const parts = text.split(/(\r\n|\r|\n)/);
  return { lines: parts.filter((_, i) => i % 2 === 0), separators: parts.filter((_, i) => i % 2 === 1) };
}

/** Die Bytes eines Textes in einer Kodierung (mit BOM), ohne die Zeilenumbrüche anzufassen. */
export function encodeExact(text: string, encoding: TextEncoding): Buffer {
  return encodeText(text, encoding, null);
}

/**
 * Text in einer bekannten Kodierung (etwa der Stand einer Datei in einem Commit mit der Kodierung der Arbeitsdatei);
 * `null` für Binärinhalt. Ein BOM gehört nicht zum Text; ein BOM im Inhalt gewinnt.
 */
export function decodeAs(data: Buffer, encoding: TextEncoding): string | null {
  const detected = decodeText(data);
  if (detected === null) return null;
  if (detected.encoding !== 'utf-8' && detected.encoding !== 'windows-1252') return detected.text;
  if (encoding === 'windows-1252') return new TextDecoder('windows-1252').decode(data);
  return detected.text;
}

/** Text und Kodierung einer Datei; `null` für eine Binärdatei. Ein BOM gehört nicht zum Text. */
export function decodeText(data: Buffer): { text: string; encoding: TextEncoding } | null {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(data.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), encoding: 'utf-16le' };
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(data.subarray(2)), encoding: 'utf-16be' };
  }
  if (data.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(data), encoding: 'windows-1252' };
  }
}

/**
 * Die Bytes eines Textes zum Schreiben: in der Kodierung der Datei, mit ihrem BOM, alle Zeilenumbrüche mit dem
 * Zeilenende der Datei. Sonst wird nichts verändert. Ein Zeichen, das Windows-1252 nicht kennt, ergibt
 * `UnencodableError`.
 */
export function encodeText(text: string, encoding: TextEncoding, lineEnding: LineEnding | null): Buffer {
  const normalized = lineEnding === null ? text : text.replace(/\r\n|\r|\n/g, lineEnding === 'CRLF' ? '\r\n' : '\n');
  switch (encoding) {
    case 'utf-8':
      return Buffer.from(normalized, 'utf8');
    case 'utf-8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(normalized, 'utf8')]);
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(normalized, 'utf16le')]);
    case 'utf-16be': {
      const body = Buffer.from(normalized, 'utf16le');
      body.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
    }
    case 'windows-1252':
      return encodeWindows1252(normalized);
  }
}

/** Ein Zeichen lässt sich in der Kodierung der Datei nicht schreiben. */
export class UnencodableError extends Error {
  constructor(readonly character: string) {
    super(`The character “${character}” cannot be saved in windows-1252.`);
  }
}

/** Zeichen von 0x80 bis 0x9F in Windows-1252 (die übrigen Bytes sind Latin-1); fehlende Stellen sind unbelegt. */
const WINDOWS_1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

const WINDOWS_1252 = new Map<number, number>();
for (let byte = 0; byte < 256; byte++) {
  const char = byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH.charCodeAt(byte - 0x80) : byte;
  WINDOWS_1252.set(char, byte);
}

function encodeWindows1252(text: string): Buffer {
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const byte = WINDOWS_1252.get(text.charCodeAt(i));
    if (byte === undefined) throw new UnencodableError(String.fromCodePoint(text.codePointAt(i)!));
    bytes[i] = byte;
  }
  return bytes;
}

/** Das überwiegende Zeilenende; bei Gleichstand und ohne Zeilenumbruch LF. Ein einzelnes CR zählt nicht. */
export function lineEndingOf(text: string): LineEnding {
  const { crlf, lf } = countLineEndings(text);
  return crlf > lf ? 'CRLF' : 'LF';
}

/** Wie viele Zeilenumbrüche CRLF und wie viele nur LF sind. */
export function countLineEndings(text: string): { crlf: number; lf: number } {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return { crlf, lf };
}
