import {Vibration, Platform} from 'react-native';
import {BridgeError, ErrorCode} from '../errors';
import type {CapabilityHandler, MethodContext} from '../CapabilityRouter';

// Per-mini-app haptic rate limiter: max 10 per second
const hapticTimestamps = new Map<string, number[]>();
const HAPTIC_MAX_PER_SEC = 10;

function checkHapticRate(miniAppId: string): void {
  const now = Date.now();
  const ts = hapticTimestamps.get(miniAppId) ?? [];
  const window = ts.filter(t => now - t < 1000);
  if (window.length >= HAPTIC_MAX_PER_SEC) {
    throw new BridgeError(ErrorCode.RATE_LIMITED, 'haptic rate limit exceeded');
  }
  window.push(now);
  hapticTimestamps.set(miniAppId, window);
}

// Vibration patterns in ms — (delay, duration) pairs repeated for effect
const VIBRATION_PATTERNS: Record<string, number | number[]> = {
  impactLight:           Platform.OS === 'android' ? 30  : 10,
  impactMedium:          Platform.OS === 'android' ? 50  : 20,
  impactHeavy:           Platform.OS === 'android' ? 80  : 40,
  notificationSuccess:   [0, 30, 80, 20],
  notificationWarning:   [0, 40, 80, 40, 80, 20],
  notificationError:     [0, 60, 80, 60, 80, 60],
  selectionChanged:      Platform.OS === 'android' ? 20  : 10,
};

const HAPTIC_METHODS = Object.keys(VIBRATION_PATTERNS);

function makeHapticMethod(type: string) {
  return {
    async execute(ctx: MethodContext) {
      checkHapticRate(ctx.miniAppId);
      Vibration.vibrate(VIBRATION_PATTERNS[type] as number | number[]);
      return null;
    },
  };
}

export const HapticsHandler: CapabilityHandler = {
  name: 'device.haptics',
  methods: Object.fromEntries(HAPTIC_METHODS.map(name => [name, makeHapticMethod(name)])),
};

