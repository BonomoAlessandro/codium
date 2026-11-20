import type { CodiumApi } from '../shared/types';

declare global {
  interface Window {
    codium: CodiumApi;
  }
}
