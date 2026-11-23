// App-Symbol aus dem Logo (Ticket 24): scripts/icons.mjs, scripts/iconFormat.mjs und der Pfad für die Fenster.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeIco, readIco } from '../../scripts/iconFormat.mjs';
import { buildIcons, ICO_FILE, ICO_SIZES, PNG_DIR, PNG_SIZES, rasterize } from '../../scripts/icons.mjs';
import { appIconPath } from '../../src/main/appIcon';

const ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

describe('App-Symbol', () => {
  it('das ICO enthält alle verlangten Grössen, bis 128 px als 32-Bit-Bitmap, 256 px als PNG', () => {
    const images = readIco(fs.readFileSync(path.join(ROOT, ICO_FILE)));
    expect(images.map((i) => i.width)).toEqual(REQUIRED_ICO_SIZES);
    expect(ICO_SIZES).toEqual(REQUIRED_ICO_SIZES);
    for (const image of images) {
      expect(image.height, `${image.width} px`).toBe(image.width);
      expect([image.pixelWidth, image.pixelHeight], `${image.width} px`).toEqual([image.width, image.width]);
      expect(image.bitCount, `${image.width} px`).toBe(32);
      expect(image.format, `${image.width} px`).toBe(image.width === 256 ? 'png' : 'bmp');
      if (image.format === 'bmp') expect(image.pixelBits).toBe(32);
    }
  });

  it('jedes Bild im ICO zeigt etwas: mindestens ein Fünftel der Fläche ist deckend', () => {
    for (const image of readIco(fs.readFileSync(path.join(ROOT, ICO_FILE))).filter((i) => i.format === 'bmp')) {
      const pixels = image.data.subarray(40, 40 + image.width * image.width * 4);
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) opaque++;
      expect(opaque / (image.width * image.width), `${image.width} px`).toBeGreaterThan(0.2);
    }
  });

  it('die eingecheckten Symbole entsprechen der SVG-Quelle; zweimal erzeugt sind sie byte-gleich', () => {
    const first = buildIcons();
    const second = buildIcons();
    expect([...first.keys()].sort()).toEqual([ICO_FILE, ...PNG_SIZES.map((s) => `${PNG_DIR}/codium-${s}.png`)].sort());
    for (const [file, content] of first) {
      expect(second.get(file)!.equals(content), `${file} zweimal gleich`).toBe(true);
      // Weicht die eingecheckte Datei ab, wurde die Quelle geändert, ohne `npm run icons` auszuführen.
      expect(fs.readFileSync(path.join(ROOT, file)).equals(content), `${file} passt zur Quelle (npm run icons)`).toBe(true);
    }
    expect(fs.readdirSync(path.join(ROOT, PNG_DIR)).sort()).toEqual(PNG_SIZES.map((s) => `codium-${s}.png`).sort());
    expect(PNG_SIZES.at(-1)).toBe(512);
  });

  it('schreibt Bitmaps von unten nach oben, mit geradem Alpha und Maske für durchsichtige Pixel', () => {
    // 16 × 16: obere Hälfte deckend rot, untere durchsichtig.
    const rgba = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) rgba.set([255, 0, 0, 255], (y * 16 + x) * 4);
    const ico = encodeIco([{ size: 16, rgba, png: Buffer.alloc(0) }]);
    const [image] = readIco(ico);
    expect(image.format).toBe('bmp');
    const pixels = image.data.subarray(40, 40 + 16 * 16 * 4);
    // Erste gespeicherte Zeile = unterste Bildzeile: durchsichtig; letzte = oberste: rot als BGRA.
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...pixels.subarray(15 * 16 * 4, 15 * 16 * 4 + 4)]).toEqual([0, 0, 255, 255]);
    // Maske: je Zeile 4 Byte; 1 = durchsichtig.
    const mask = image.data.subarray(40 + 16 * 16 * 4);
    expect(mask.length).toBe(16 * 4);
    expect([...mask.subarray(0, 4)]).toEqual([0xff, 0xff, 0, 0]);
    expect([...mask.subarray(15 * 4, 16 * 4)]).toEqual([0, 0, 0, 0]);
  });

  it('halbtransparente Pixel kommen mit gerader Farbe ins ICO, nicht vormultipliziert wie aus resvg', () => {
    // Halb deckend: vormultipliziert wäre Rot etwa 128 statt 255 und das Akzentblau nur halb so hell.
    const half = (color: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="${color}" fill-opacity="0.5"/></svg>`;
    const red = rasterize(half('#ff0000'), 4);
    expect([...red.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 128]);
    const accent = [...rasterize(half('#3574f0'), 4).rgba.subarray(0, 4)];
    expect(accent[3]).toBe(128);
    [0x35, 0x74, 0xf0].forEach((channel, i) => expect(Math.abs(accent[i] - channel), `Kanal ${i}: ${accent}`).toBeLessThanOrEqual(2));
    // Im ICO landet dieselbe gerade Farbe, als BGRA.
    const [image] = readIco(encodeIco([red]));
    expect([...image.data.subarray(40, 44)]).toEqual([0, 0, 255, 128]);
  });

  it('die Fenster nehmen das ICO aus assets/icons, im Paket das neben dem App-Archiv', () => {
    const dev = appIconPath(ROOT, false, 'C:\\Programme\\Codium\\resources');
    expect(fs.readFileSync(dev).equals(fs.readFileSync(path.join(ROOT, ICO_FILE)))).toBe(true);
    expect(appIconPath('C:\\Programme\\Codium\\resources\\app.asar', true, 'C:\\Programme\\Codium\\resources')).toBe(
      path.join('C:\\Programme\\Codium\\resources', 'codium.ico'),
    );
  });

  it('electron-builder verwendet das ICO für exe, Installer und Deinstallierer und legt es neben das App-Archiv', () => {
    const build = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build;
    expect(build.win.icon).toBe(ICO_FILE);
    expect(build.nsis.installerIcon).toBe(ICO_FILE);
    expect(build.nsis.uninstallerIcon).toBe(ICO_FILE);
    expect(build.extraResources).toContainEqual({ from: ICO_FILE, to: 'codium.ico' });
  });
});
