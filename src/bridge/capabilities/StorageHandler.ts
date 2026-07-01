import AsyncStorage from '@react-native-async-storage/async-storage';
import {BridgeError, ErrorCode} from '../errors';
import type {CapabilityHandler, MethodContext} from '../CapabilityRouter';

function namespacedKey(miniAppId: string, key: string): string {
  return `whip::${miniAppId}::${key}`;
}

// In-memory usage counter per mini app.
// Starts at 0 on process start; accurate within a session.
// Known limitation: resets if the process is killed; post-restart writes can
// exceed the quota until the first delete recalibrates the counter.
const usageBytes = new Map<string, number>();

function getUsage(miniAppId: string): number {
  return usageBytes.get(miniAppId) ?? 0;
}

function adjustUsage(miniAppId: string, delta: number): void {
  usageBytes.set(miniAppId, Math.max(0, getUsage(miniAppId) + delta));
}

// Per-mini-app write serialization — one active write chain per miniAppId.
// Prevents quota counter races on concurrent set/delete calls.
const writeChains = new Map<string, Promise<unknown>>();

function chainWrite<T>(miniAppId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(miniAppId) ?? Promise.resolve();
  // Run fn after prev regardless of outcome so the chain never deadlocks
  const next = prev.then(() => fn(), () => fn());
  writeChains.set(miniAppId, next);
  return next;
}

export const StorageHandler: CapabilityHandler = {
  name: 'storage.kv',
  methods: {
    get: {
      validatePayload(payload) {
        const p = payload as {key?: unknown};
        if (typeof p?.key !== 'string' || !p.key) {
          throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'key must be a non-empty string');
        }
      },
      async execute(ctx: MethodContext, payload: unknown) {
        const {key} = payload as {key: string};
        const val = await AsyncStorage.getItem(namespacedKey(ctx.miniAppId, key));
        return val ?? null;
      },
    },

    set: {
      validatePayload(payload) {
        const p = payload as {key?: unknown; value?: unknown};
        if (typeof p?.key !== 'string' || !p.key) {
          throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'key must be a non-empty string');
        }
        if (typeof p?.value !== 'string') {
          throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'value must be a string');
        }
      },
      execute(ctx: MethodContext, payload: unknown) {
        const {key, value} = payload as {key: string; value: string};
        const quota = ctx.manifest.storageQuotaBytes;

        return chainWrite(ctx.miniAppId, async () => {
          const nsKey = namespacedKey(ctx.miniAppId, key);
          const existing = await AsyncStorage.getItem(nsKey);
          const existingSize = existing?.length ?? 0;
          const newSize = value.length;

          // projected = current usage - old value size + new value size
          const projected = getUsage(ctx.miniAppId) - existingSize + newSize;
          if (projected > quota) {
            throw new BridgeError(ErrorCode.QUOTA_EXCEEDED);
          }

          await AsyncStorage.setItem(nsKey, value);
          adjustUsage(ctx.miniAppId, newSize - existingSize);
          return null;
        });
      },
    },

    delete: {
      validatePayload(payload) {
        const p = payload as {key?: unknown};
        if (typeof p?.key !== 'string' || !p.key) {
          throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'key must be a non-empty string');
        }
      },
      execute(ctx: MethodContext, payload: unknown) {
        const {key} = payload as {key: string};
        return chainWrite(ctx.miniAppId, async () => {
          const nsKey = namespacedKey(ctx.miniAppId, key);
          const existing = await AsyncStorage.getItem(nsKey);
          await AsyncStorage.removeItem(nsKey);
          adjustUsage(ctx.miniAppId, -(existing?.length ?? 0));
          return null;
        });
      },
    },

    list: {
      async execute(ctx: MethodContext) {
        const allKeys = await AsyncStorage.getAllKeys();
        const prefix = `whip::${ctx.miniAppId}::`;
        return (allKeys as string[])
          .filter((k: string) => k.startsWith(prefix))
          .map((k: string) => k.slice(prefix.length));
      },
    },
  },
};
