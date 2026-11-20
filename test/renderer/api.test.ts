import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/renderer/api';
import { CodiumError, type CodiumBridge, type ResponseMessage } from '../../src/shared/types';

function fakeBridge(response: ResponseMessage) {
  const calls: Array<{ name: string; params: unknown }> = [];
  const bridge: CodiumBridge = {
    async invoke(name, params) {
      calls.push({ name, params });
      return response;
    },
    on: () => () => {},
  };
  return { bridge, calls };
}

describe('API der Oberfläche', () => {
  it('liefert das Ergebnis eines Befehls, auch ohne Parameter', async () => {
    const { bridge, calls } = fakeBridge({ ok: true, result: { name: 'Codium', version: '1.2.3' } });
    expect(await createApi(bridge).request('app.info')).toEqual({ name: 'Codium', version: '1.2.3' });
    expect(calls).toEqual([{ name: 'app.info', params: undefined }]);
  });

  it('wirft bei einem gescheiterten Befehl einen CodiumError mit Code und Daten', async () => {
    const { bridge } = fakeBridge({ ok: false, error: { message: 'verweigert', code: 'CHECKOUT_BLOCKED', data: ['a.txt'] } });
    const error = await createApi(bridge).request('app.info').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodiumError);
    expect(error).toMatchObject({ message: 'verweigert', code: 'CHECKOUT_BLOCKED', data: ['a.txt'] });
  });
});
