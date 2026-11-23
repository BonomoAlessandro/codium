// Bilder kopiert esbuild nach dist/renderer/assets; der Import liefert ihre Adresse relativ zur Seite.
declare module '*.svg' {
  const url: string;
  export default url;
}
