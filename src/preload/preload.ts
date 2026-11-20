import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EventHub } from '../shared/eventHub';
import { IPC, type CodiumBridge, type EventMessage, type ResponseMessage } from '../shared/types';

// Ein einziger Listener für alle Ereignisse, schon bevor die Seite läuft; der Hub hält Ereignisse zurück, bis die
// Oberfläche sie zum ersten Mal abonniert.
const hub = new EventHub();
ipcRenderer.on(IPC.event, (_event: IpcRendererEvent, message: EventMessage) => hub.deliver(message.name, message.payload));

// Die Brücke wirft nie, sondern liefert die Antwort als Wert: Über contextBridge käme von einem Fehler nur die
// Meldung an, Code und Daten gingen verloren. Das Werfen übernimmt die Oberfläche (renderer/api.ts).
const bridge: CodiumBridge = {
  invoke: (name, params) => ipcRenderer.invoke(IPC.request, { name, params }) as Promise<ResponseMessage>,
  on: (name, listener) => hub.subscribe(name, listener),
};

contextBridge.exposeInMainWorld('codium', bridge);
