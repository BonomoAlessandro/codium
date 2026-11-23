// Dateiformate rund um das App-Symbol (Ticket 24), ohne weitere Pakete: ICO schreiben und lesen, die Symbole einer
// Windows-Programmdatei (.exe) lesen. Gebraucht von scripts/icons.mjs, den Einheitstests und `npm run test:packaged`.

import { closeSync, openSync, readSync } from 'node:fs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Baut eine ICO-Datei. `images`: je Grösse die Pixel als RGBA mit geradem (nicht vormultipliziertem) Alpha und das
 * fertige PNG. Bis 128 px wird das Bild als 32-Bit-Bitmap gespeichert (das liest jedes Windows-Programm), 256 px als
 * PNG (so empfiehlt es Microsoft, die Datei bleibt klein). Gleiche Eingabe ergibt byte-gleiche Ausgabe.
 * @param {Array<{ size: number, rgba: Buffer, png: Buffer }>} images
 */
export function encodeIco(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const blobs = sorted.map((image) => (image.size >= 256 ? image.png : bitmapEntry(image.size, image.rgba)));
  const header = Buffer.alloc(6 + 16 * sorted.length);
  header.writeUInt16LE(0, 0); // reserviert
  header.writeUInt16LE(1, 2); // 1 = Symbol
  header.writeUInt16LE(sorted.length, 4);
  let offset = header.length;
  sorted.forEach((image, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry); // 0 steht für 256
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2); // keine Farbpalette
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); // Ebenen
    header.writeUInt16LE(32, entry + 6); // Bit je Pixel
    header.writeUInt32LE(blobs[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += blobs[i].length;
  });
  return Buffer.concat([header, ...blobs]);
}

/** Ein Bild im ICO als Bitmap: Kopf (BITMAPINFOHEADER), Farben BGRA von unten nach oben, dann die 1-Bit-Maske. */
function bitmapEntry(size, rgba) {
  if (rgba.length !== size * size * 4) throw new Error(`RGBA für ${size} px hat die falsche Länge (${rgba.length})`);
  const maskRow = Math.ceil(size / 32) * 4;
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(size, 4);
  head.writeInt32LE(size * 2, 8); // Farben und Maske übereinander
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  head.writeUInt32LE(0, 16); // unkomprimiert
  head.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y; // Bitmaps stehen auf dem Kopf
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = (row * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
      // Maske: 1 = durchsichtig; nur für Programme, die den Alphakanal nicht kennen.
      if (rgba[from + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([head, pixels, mask]);
}

/**
 * Liest eine ICO-Datei: je Bild Breite, Höhe, Bit je Pixel, Format (`png` oder `bmp`) und die Bilddaten. Prüft dabei
 * den Aufbau und wirft bei einer beschädigten Datei.
 * @param {Buffer} buffer
 */
export function readIco(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw new Error('keine ICO-Datei');
  const count = buffer.readUInt16LE(4);
  const images = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i;
    if (entry + 16 > buffer.length) throw new Error('ICO-Verzeichnis abgeschnitten');
    const width = buffer.readUInt8(entry) || 256;
    const height = buffer.readUInt8(entry + 1) || 256;
    const bitCount = buffer.readUInt16LE(entry + 6);
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (offset + length > buffer.length) throw new Error(`Bild ${i} reicht über das Dateiende`);
    const data = buffer.subarray(offset, offset + length);
    images.push({ width, height, bitCount, ...describeImage(data), data });
  }
  return images;
}

/** Format und tatsächliche Grösse der Bilddaten eines Symbols (PNG oder Bitmap). */
function describeImage(data) {
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { format: 'png', pixelWidth: data.readUInt32BE(16), pixelHeight: data.readUInt32BE(20) };
  }
  if (data.length >= 40 && data.readUInt32LE(0) === 40) {
    return { format: 'bmp', pixelWidth: data.readInt32LE(4), pixelHeight: data.readInt32LE(8) / 2, pixelBits: data.readUInt16LE(14) };
  }
  throw new Error('unbekanntes Bildformat im Symbol');
}

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

/**
 * Liest die Symbolgruppen einer Windows-Programmdatei (Ressourcen RT_GROUP_ICON und RT_ICON) in der Reihenfolge des
 * Ressourcenverzeichnisses; die erste Gruppe zeigt Windows als Symbol der Datei. Liest nur Kopf und Ressourcenteil,
 * nicht die ganze Datei.
 * @param {string} file
 */
export function readExeIconGroups(file) {
  const fd = openSync(file, 'r');
  try {
    const read = (position, length) => {
      const buffer = Buffer.alloc(length);
      const got = readSync(fd, buffer, 0, length, position);
      if (got !== length) throw new Error(`${file}: unerwartetes Dateiende bei ${position}`);
      return buffer;
    };
    const dos = read(0, 64);
    if (dos.toString('latin1', 0, 2) !== 'MZ') throw new Error(`${file}: keine Programmdatei`);
    const peOffset = dos.readUInt32LE(0x3c);
    const pe = read(peOffset, 24);
    if (pe.toString('latin1', 0, 4) !== 'PE\0\0') throw new Error(`${file}: kein PE-Kopf`);
    const sectionCount = pe.readUInt16LE(6);
    const optionalSize = pe.readUInt16LE(20);
    const optional = read(peOffset + 24, optionalSize);
    const magic = optional.readUInt16LE(0);
    const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1;
    if (directories < 0) throw new Error(`${file}: unbekannter optionaler Kopf`);
    const resourceRva = optional.readUInt32LE(directories + 2 * 8);
    if (resourceRva === 0) return [];
    const sections = read(peOffset + 24 + optionalSize, 40 * sectionCount);
    let section = null;
    for (let i = 0; i < sectionCount; i++) {
      const at = 40 * i;
      const va = sections.readUInt32LE(at + 12);
      const size = Math.max(sections.readUInt32LE(at + 8), sections.readUInt32LE(at + 16));
      if (resourceRva >= va && resourceRva < va + size) {
        section = { va, rawSize: sections.readUInt32LE(at + 16), rawOffset: sections.readUInt32LE(at + 20) };
        break;
      }
    }
    if (!section) throw new Error(`${file}: Ressourcenteil nicht gefunden`);
    const rsrc = read(section.rawOffset, section.rawSize);
    const base = resourceRva - section.va;
    const atRva = (rva) => rva - section.va;

    /** Einträge eines Ressourcenverzeichnisses: Name (Zahl oder Text) und Ziel (Unterverzeichnis oder Daten). */
    const entries = (dirOffset) => {
      const at = base + dirOffset;
      const count = rsrc.readUInt16LE(at + 12) + rsrc.readUInt16LE(at + 14);
      const list = [];
      for (let i = 0; i < count; i++) {
        const e = at + 16 + 8 * i;
        const nameField = rsrc.readUInt32LE(e);
        const target = rsrc.readUInt32LE(e + 4);
        let name;
        if (nameField & 0x80000000) {
          const s = base + (nameField & 0x7fffffff);
          name = rsrc.toString('utf16le', s + 2, s + 2 + 2 * rsrc.readUInt16LE(s));
        } else {
          name = nameField;
        }
        list.push({ name, directory: (target & 0x80000000) !== 0, offset: target & 0x7fffffff });
      }
      return list;
    };
    /** Die Daten der ersten Sprache unter einem Namen. */
    const dataOf = (entry) => {
      let current = entry;
      while (current.directory) current = entries(current.offset)[0];
      const d = base + current.offset;
      const start = atRva(rsrc.readUInt32LE(d));
      return rsrc.subarray(start, start + rsrc.readUInt32LE(d + 4));
    };

    const types = entries(0);
    const iconType = types.find((t) => t.name === RT_ICON);
    const groupType = types.find((t) => t.name === RT_GROUP_ICON);
    if (!iconType || !groupType) return [];
    const icons = new Map(entries(iconType.offset).map((e) => [e.name, dataOf(e)]));
    return entries(groupType.offset).map((group) => {
      const data = dataOf(group);
      const count = data.readUInt16LE(4);
      const images = [];
      for (let i = 0; i < count; i++) {
        const e = 6 + 14 * i;
        const id = data.readUInt16LE(e + 12);
        const image = icons.get(id);
        if (!image) throw new Error(`${file}: Symbol ${id} der Gruppe ${group.name} fehlt`);
        images.push({
          width: data.readUInt8(e) || 256,
          height: data.readUInt8(e + 1) || 256,
          bitCount: data.readUInt16LE(e + 6),
          id,
          data: image,
        });
      }
      return { name: group.name, images };
    });
  } finally {
    closeSync(fd);
  }
}
