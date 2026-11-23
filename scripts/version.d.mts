// Typen zu version.mjs, damit die Tests in TypeScript es benutzen können.

export function nextInstallerVersion(version: string): string;
export function replaceVersion(text: string, from: string, to: string, kind: 'package' | 'lock'): string;
