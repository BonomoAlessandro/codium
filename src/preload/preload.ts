import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CodiumApi } from '../shared/types';

const api: CodiumApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
};

contextBridge.exposeInMainWorld('codium', api);
