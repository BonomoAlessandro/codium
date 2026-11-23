// Typen zu icons.mjs, damit die Tests in TypeScript es benutzen können.

export const ICO_SIZES: number[];
export const PNG_SIZES: number[];
export const SMALL_SOURCE_MAX: number;
export const LOGO_FILE: string;
export const LOGO_SMALL_FILE: string;
export const ICO_FILE: string;
export const PNG_DIR: string;

/** Rastert ein SVG quadratisch auf `size` Pixel: PNG und RGBA mit geradem (nicht vormultipliziertem) Alpha. */
export function rasterize(svg: string, size: number): { size: number; png: Buffer; rgba: Buffer };

/** Alle Symbole im Speicher: Pfad relativ zum Projekt (mit `/`) → Inhalt. */
export function buildIcons(root?: string): Map<string, Buffer>;
export function writeIcons(root?: string): Map<string, Buffer>;
