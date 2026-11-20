// Verteilt Befehle aus dem Vertrag an ihre Handler. Kennt kein Electron: Der Hauptprozess reicht nur die
// Kennung des anfragenden Fensters herein, die Tests tun dasselbe mit nachgemachten Kennungen.

import type { CommandArgs, CommandName, CommandParams, CommandResult, ResponseMessage } from '../../shared/types';

/** Wer fragt: das Fenster, aus dem die Anfrage kommt. */
export interface CallContext {
  windowId: number;
}

export type CommandHandler<K extends CommandName> = (
  ctx: CallContext,
  params: CommandParams<K>,
) => CommandResult<K> | Promise<CommandResult<K>>;

export class CommandRouter {
  private readonly handlers = new Map<string, (ctx: CallContext, params: unknown) => unknown>();

  /** Meldet den Handler eines Befehls an. Jeder Befehl hat genau einen Handler. */
  register<K extends CommandName>(name: K, handler: CommandHandler<K>): void {
    if (this.handlers.has(name)) throw new Error(`Befehl ${name} ist schon angemeldet.`);
    this.handlers.set(name, handler as (ctx: CallContext, params: unknown) => unknown);
  }

  /** Führt einen Befehl aus. Fehler kommen als Antwort zurück, nie als Ausnahme. */
  async dispatch(ctx: CallContext, name: string, params: unknown): Promise<ResponseMessage> {
    const handler = this.handlers.get(name);
    if (!handler) return { ok: false, error: { message: `Unbekannter Befehl: ${name}` } };
    try {
      return { ok: true, result: await handler(ctx, params) };
    } catch (err) {
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  /**
   * Bequemer, typisierter Aufruf für den Kern und die Tests: wirft mit der Meldung, wenn der Befehl
   * scheitert, so wie es die API in der Oberfläche tut.
   */
  async call<K extends CommandName>(ctx: CallContext, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    const response = await this.dispatch(ctx, name, args[0]);
    if (!response.ok) throw new Error(response.error.message);
    return response.result as CommandResult<K>;
  }
}
