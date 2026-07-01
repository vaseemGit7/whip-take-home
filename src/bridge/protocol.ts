export type MessageVersion = '1.0';
export const CURRENT_VERSION: MessageVersion = '1.0';

// Direction: these types may ONLY be sent by the guest
export const GUEST_ALLOWED_TYPES = new Set([
  'REQUEST',
  'NOTIFICATION',
  'SUBSCRIBE',
  'UNSUBSCRIBE',
  'HANDSHAKE',
  'ACK',
]);

// Guest → Host
export interface BridgeRequest {
  type: 'REQUEST';
  id: string;
  sessionToken: string;
  version: MessageVersion;
  capability: string;
  method: string;
  payload: unknown;
  timestamp: number;
}

// Host → Guest
export interface BridgeResponse {
  type: 'RESPONSE';
  id: string;
  version: MessageVersion;
  ok: boolean;
  result?: unknown;
  error?: {code: string; message: string};
  timestamp: number;
}

// Guest → Host (fire-and-forget, no response)
export interface BridgeNotification {
  type: 'NOTIFICATION';
  id: string;
  sessionToken: string;
  version: MessageVersion;
  event: string;
  payload: unknown;
  timestamp: number;
}

// Host → Guest (host-initiated)
export interface BridgePush {
  type: 'PUSH';
  id: string;
  version: MessageVersion;
  channel: string;
  payload: unknown;
  timestamp: number;
}

// Guest → Host
export interface BridgeSubscribe {
  type: 'SUBSCRIBE';
  id: string;
  sessionToken: string;
  version: MessageVersion;
  channel: string;
  timestamp: number;
}

// Guest → Host
export interface BridgeUnsubscribe {
  type: 'UNSUBSCRIBE';
  id: string;
  sessionToken: string;
  version: MessageVersion;
  channel: string;
  timestamp: number;
}

// Guest → Host (first message after load)
export interface BridgeHandshake {
  type: 'HANDSHAKE';
  id: string;
  sessionToken: string;
  guestVersion: string;
  timestamp: number;
}

// Host → Guest
export interface BridgeHandshakeAck {
  type: 'HANDSHAKE_ACK';
  id: string;
  version: MessageVersion;
  negotiatedVersion: string;
  ok: boolean;
  error?: {code: string; message: string};
  timestamp: number;
}

// Guest → Host (optional push receipt confirmation)
export interface BridgeAck {
  type: 'ACK';
  id: string;
  sessionToken: string;
  version: MessageVersion;
  timestamp: number;
}

export type GuestMessage =
  | BridgeRequest
  | BridgeNotification
  | BridgeSubscribe
  | BridgeUnsubscribe
  | BridgeHandshake
  | BridgeAck;

export type HostMessage = BridgeResponse | BridgePush | BridgeHandshakeAck;

export interface MiniAppManifest {
  miniAppId: string;
  capabilities: string[]; // e.g. ['storage.kv', 'device.haptics', 'network.fetch']
  domainAllowlist: string[]; // for network.fetch
  storageQuotaBytes: number; // for storage.kv; default 1_048_576 (1 MB)
}
