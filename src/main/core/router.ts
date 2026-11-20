// Verteilt Befehle aus dem Vertrag an ihre Handler. Kennt kein Electron: Der Hauptprozess reicht nur die
// Kennung des anfragenden Fensters herein, die Tests tun dasselbe mit nachgemachten Kennungen.

import type { CommandArgs, CommandName, CommandParams, CommandResult, ResponseMessage } from '../../shared/types';

/** Wer fragt: das Fenster, aus dem die Anfrage kommt. */
export interface CallContext {
  windowId: number;
}

/**
 * Fehler eines Befehls mit Code und strukturierten Daten, die unverändert in der Oberfläche ankommen (etwa die
 * Dateiliste eines verweigerten Checkouts).
 */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'CommandError';
  }
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
    if (!handler) return { ok: false, error: { message: `Unbekannter Befehl: ${name}`, code: 'UNKNOWN_COMMAND' } };
    try {
      return { ok: true, result: await handler(ctx, params) };
    } catch (err) {
      if (err instanceof CommandError) {
        return { ok: false, error: { message: err.message, code: err.code, data: err.data } };
      }
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  /**
   * Bequemer, typisierter Aufruf für den Kern und die Tests: wirft einen `CommandError`, wenn der Befehl
   * scheitert, so wie es die API in der Oberfläche tut.
   */
  async call<K extends CommandName>(ctx: CallContext, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    const response = await this.dispatch(ctx, name, args[0]);
    if (!response.ok) throw new CommandError(response.error.message, response.error.code, response.error.data);
    return response.result as CommandResult<K>;
  }
}
