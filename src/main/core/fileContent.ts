// Erkennt, was eine Datei für einen Tab ist: Bild, Text (mit Kodierung und Zeilenende) oder Binärdatei. Reine
// Funktionen ohne Dateizugriff; das Lesen und die Grössengrenzen übernimmt der Datei-Dienst. Lädt nie Electron.
//
// Reihenfolge nach der Spezifikation („Editor, Tabs und Speichern“): BOM, Null-Bytes in den ersten 8 KB, gültiges
// UTF-8, sonst Windows-1252. Bilder erkennt Codium vorher an der Endung; SVG ist Text.

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
  };
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

/** Das überwiegende Zeilenende; bei Gleichstand und ohne Zeilenumbruch LF. Ein einzelnes CR zählt nicht. */
export function lineEndingOf(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? 'CRLF' : 'LF';
}
