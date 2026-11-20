import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EventHub } from '../shared/eventHub';
import { IPC, type CodiumApi, type EventMessage, type ResponseMessage } from '../shared/types';

// Ein einziger Listener für alle Ereignisse, schon bevor die Seite läuft; der Hub hält Ereignisse ohne
// Abonnenten zurück, bis die Oberfläche sie abonniert.
const hub = new EventHub();
ipcRenderer.on(IPC.event, (_event: IpcRendererEvent, message: EventMessage) => hub.deliver(message.name, message.payload));

const api: CodiumApi = {
  async request(name, ...args) {
    const response = (await ipcRenderer.invoke(IPC.request, { name, params: args[0] })) as ResponseMessage;
    if (!response.ok) {
      // Code und Daten bleiben erhalten, etwa die Dateiliste eines verweigerten Checkouts.
      throw Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data });
    }
    return response.result as never;
  },
  on(name, listener) {
    return hub.subscribe(name, listener as (payload: unknown) => void);
  },
};

contextBridge.exposeInMainWorld('codium', api);
