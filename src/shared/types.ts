// Vertrag zwischen Renderer und Hauptprozess (über IPC).
// Vorerst nur ein Beispiel, damit der Weg Main → Preload → Renderer steht; die eigentliche API kommt mit der
// Spezifikation.

/** Name und Version der App, zur Anzeige. */
export interface AppInfo {
  name: string;
  version: string;
}

/** Die API, die das Preload-Skript dem Renderer unter `window.codium` bereitstellt. */
export interface CodiumApi {
  appInfo(): Promise<AppInfo>;
}

/** IPC-Kanalnamen an einem Ort, damit Main und Preload nicht auseinanderlaufen. */
export const IPC = {
  appInfo: 'app:info',
} as const;
