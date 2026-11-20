// Typisierte API der Oberfläche über der Brücke aus dem Preload. Wirft bei einem gescheiterten Befehl einen
// CodiumError mit Code und Daten aus dem Kern. Ohne DOM, damit es sich in Node testen lässt.

import { CodiumError, type CodiumApi, type CodiumBridge } from '../shared/types';

export function createApi(bridge: CodiumBridge): CodiumApi {
  return {
    async request(name, ...args) {
      const response = await bridge.invoke(name, args[0]);
      if (!response.ok) throw new CodiumError(response.error.message, response.error.code, response.error.data);
      return response.result as never;
    },
    on(name, listener) {
      return bridge.on(name, listener as (payload: unknown) => void);
    },
  };
}
