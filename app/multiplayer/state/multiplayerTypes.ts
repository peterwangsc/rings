import type { Infer } from "spacetimedb";
import type { MotionState } from "../../lib/CharacterActor";
import {
  ChatMessageEventRow,
  FireballEventRow,
  GoombaStateRow,
  PlayerInventoryRow,
  PlayerStateRow,
  RingDropStateRow,
  RingStateRow,
  WorldStateRow,
} from "../spacetime/bindings";

export type NetPlayerRow = Infer<typeof PlayerStateRow>;
export type NetFireballEventRow = Infer<typeof FireballEventRow>;
export type NetChatMessageEventRow = Infer<typeof ChatMessageEventRow>;
export type NetRingRow = Infer<typeof RingStateRow>;
export type NetRingDropRow = Infer<typeof RingDropStateRow>;
export type NetPlayerInventoryRow = Infer<typeof PlayerInventoryRow>;
export type NetGoombaRow = Infer<typeof GoombaStateRow>;
export type NetWorldStateRow = Infer<typeof WorldStateRow>;

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface NetPlayerSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  planarSpeed: number;
  motionState: MotionState;
  lastInputSeq: number;
}

export interface AuthoritativePlayerState extends NetPlayerSnapshot {
  identity: string;
  displayName: string;
  updatedAtMs: number;
  lastCastAtMs: number;
}

export interface FireballSpawnEvent {
  eventId: string;
  ownerIdentity: string;
  originX: number;
  originY: number;
  originZ: number;
  directionX: number;
  directionY: number;
  directionZ: number;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface ChatMessageEvent {
  messageId: string;
  ownerIdentity: string;
  ownerDisplayName: string;
  messageText: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface GoombaState {
  goombaId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: "idle" | "charge" | "cooldown" | "defeated";
}

export interface MultiplayerDiagnostics {
  playerRowCount: number;
  ringRowCount: number;
  fireballEventRowCount: number;
  chatMessageRowCount: number;
}

export interface MultiplayerState {
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  localIdentity: string | null;
  localDisplayName: string;
  dayCycleAnchorMs: number | null;
  dayCycleDurationSeconds: number;
  serverTimeOffsetMs: number | null;
  authoritativeLocalPlayerState: AuthoritativePlayerState | null;
  remotePlayers: Map<string, AuthoritativePlayerState>;
  goombas: Map<string, GoombaState>;
  collectedRingIds: Set<string>;
  pendingRemoteFireballSpawns: FireballSpawnEvent[];
  chatMessages: ChatMessageEvent[];
  diagnostics: MultiplayerDiagnostics;
}

export interface MultiplayerReducerFns {
  upsertPlayerState: (snapshot: NetPlayerSnapshot) => void;
  castFireball: (request: {
    originX: number;
    originY: number;
    originZ: number;
    directionX: number;
    directionY: number;
    directionZ: number;
  }) => void;
  sendChatMessage: (request: { messageText: string }) => void;
  collectRing: (ringId: string) => void;
}
