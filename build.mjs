// Bündelt Main-, Preload- und Renderer-Code mit esbuild nach dist/, dazu Monacos allgemeinen Editor-Worker.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const dev = process.argv.includes('--dev');

rmSync('dist', { recursive: true, force: true });

const common = {
  bundle: true,
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'info',
};

/**
 * Monaco ohne seine eingebauten Sprachdienste (TypeScript, JavaScript, JSON, CSS, HTML) und ohne seinen LSP-Client:
 * Sprachfunktionen kommen nur vom Sprach-Dienst des Kerns. `editor.main` bindet sie als Namensräume ein; sie werden
 * hier zu leeren Modulen. Die Farben nach Wortarten (languages/definitions) bleiben.
 */
const monacoWithoutLanguageServices = {
  name: 'monaco-without-language-services',
  setup(b) {
    b.onResolve({ filter: /(^|[\\/])(languages[\\/]features[\\/]|external[\\/]monaco-lsp-client[\\/])/ }, (args) => {
      if (!/monaco-editor[\\/]/.test(args.importer)) return undefined;
      return { path: args.path, namespace: 'monaco-empty' };
    });
    b.onLoad({ filter: /.*/, namespace: 'monaco-empty' }, () => ({ contents: 'export {};', loader: 'js' }));
  },
};

const browser = {
  ...common,
  platform: 'browser',
  target: 'chrome130',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...browser,
    // React-Oberfläche; JSX wird mit der automatischen Laufzeit von React übersetzt. CSS-Imports (auch die von
    // Monaco) landen in dist/renderer/renderer.css, Schriften (JetBrains Mono, Monacos Symbole) unter assets/.
    entryPoints: ['src/renderer/main.tsx'],
    outfile: 'dist/renderer/renderer.js',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
    assetNames: 'assets/[name]-[hash]',
    plugins: [monacoWithoutLanguageServices],
  }),
  build({
    ...browser,
    // Monacos allgemeiner Editor-Worker (Unterschiede, Verknüpfungen, Wortgrenzen), geladen aus den eigenen Dateien.
    entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],
    outfile: 'dist/renderer/editor.worker.js',
    format: 'iife',
  }),
]);

mkdirSync('dist/renderer', { recursive: true });
copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
