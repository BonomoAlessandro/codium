import type { CodiumBridge } from '../shared/types';

declare global {
  interface Window {
    /** Die Brücke aus dem Preload; die Oberfläche benutzt sie über createApi (api.ts). */
    codium: CodiumBridge;
  }
}
