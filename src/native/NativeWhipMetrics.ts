import {NativeModules} from 'react-native';
import {MetricsSnapshot} from '../bridge/BridgeHost';

export type {MetricsSnapshot};

// Legacy module interface — methods bridged via RCT_EXPORT_MODULE / RCT_EXPORT_METHOD.
// Using NativeModules (not TurboModuleRegistry) because our module is a legacy
// ObjC/Kotlin module; TurboModuleRegistry only resolves codegen-generated TurboModules.
interface WhipMetricsInterface {
  recordRequest(capability: string, latencyMs: number, ok: boolean): void;
  recordDropped(reason: string): void;
  // RCT_REMAP_METHOD with resolve/reject blocks → Promise in JS
  getSnapshot(): Promise<MetricsSnapshot>;
}

const mod = NativeModules.WhipMetrics as WhipMetricsInterface | undefined;

// Export null when the native module isn't registered (tests, Expo Go, etc.)
export default (mod ?? null) as WhipMetricsInterface | null;
