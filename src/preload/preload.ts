import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type CodiumApi, type EventMessage, type ResponseMessage } from '../shared/types';

const api: CodiumApi = {
  async request(name, ...args) {
    const response = (await ipcRenderer.invoke(IPC.request, { name, params: args[0] })) as ResponseMessage;
    if (!response.ok) throw new Error(response.error.message);
    return response.result as never;
  },
  on(name, listener) {
    const handler = (_event: IpcRendererEvent, message: EventMessage): void => {
      if (message.name === name) listener(message.payload as never);
    };
    ipcRenderer.on(IPC.event, handler);
    return () => {
      ipcRenderer.removeListener(IPC.event, handler);
    };
  },
};

contextBridge.exposeInMainWorld('codium', api);
