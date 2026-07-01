import {BridgeError, ErrorCode} from './errors';
import {MiniAppManifest} from './protocol';

export interface MethodContext {
  miniAppId: string;
  manifest: MiniAppManifest;
}

export interface MethodHandler {
  execute: (ctx: MethodContext, payload: unknown) => Promise<unknown>;
  validatePayload?: (payload: unknown) => void; // throws BridgeError on invalid
}

export interface CapabilityHandler {
  readonly name: string; // e.g. 'storage.kv'
  readonly methods: Record<string, MethodHandler>;
}

export class CapabilityRouter {
  private handlers = new Map<string, CapabilityHandler>();

  register(handler: CapabilityHandler): void {
    this.handlers.set(handler.name, handler);
  }

  async route(
    ctx: MethodContext,
    capability: string,
    method: string,
    payload: unknown,
  ): Promise<unknown> {
    const handler = this.handlers.get(capability);
    if (!handler) {
      throw new BridgeError(ErrorCode.CAPABILITY_DENIED);
    }

    const methodHandler = handler.methods[method];
    if (!methodHandler) {
      throw new BridgeError(ErrorCode.METHOD_NOT_FOUND);
    }

    methodHandler.validatePayload?.(payload);

    return methodHandler.execute(ctx, payload);
  }
}
