// Typen zu iconFormat.mjs, damit die Tests in TypeScript es benutzen können.

export interface IcoImage {
  /** Grösse laut Verzeichnis der ICO-Datei (0 dort steht für 256). */
  width: number;
  height: number;
  bitCount: number;
  format: 'png' | 'bmp';
  /** Grösse laut den Bilddaten selbst. */
  pixelWidth: number;
  pixelHeight: number;
  /** Bit je Pixel einer Bitmap. */
  pixelBits?: number;
  data: Buffer;
}

export interface ExeIconGroup {
  name: number | string;
  images: Array<{ width: number; height: number; bitCount: number; id: number; data: Buffer }>;
}

export function encodeIco(images: Array<{ size: number; rgba: Buffer; png: Buffer }>): Buffer;
export function readIco(buffer: Buffer): IcoImage[];
export function readExeIconGroups(file: string): ExeIconGroup[];
