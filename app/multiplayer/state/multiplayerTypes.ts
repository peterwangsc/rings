import type { Infer } from "spacetimedb";
import {
  ChatMessageEventRow,
  FireballEventRow,
  GoombaStateRow,
  PlayerInventoryRow,
  PlayerStateRow,
  PlayerStatsRow,
  RingDropStateRow,
  RingStateRow,
  WorldStateRow,
} from "../spacetime/bindings";
import type {
  CastFireballCommand,
  CollectRingCommand,
  LocalPlayerSnapshot,
  SendChatMessageCommand,
} from "../protocol";

export type NetPlayerRow = Infer<typeof PlayerStateRow>;
export type NetFireballEventRow = Infer<typeof FireballEventRow>;
export type NetChatMessageEventRow = Infer<typeof ChatMessageEventRow>;
export type NetRingRow = Infer<typeof RingStateRow>;
export type NetRingDropRow = Infer<typeof RingDropStateRow>;
export type NetPlayerInventoryRow = Infer<typeof PlayerInventoryRow>;
export type NetPlayerStatsRow = Infer<typeof PlayerStatsRow>;
export type NetGoombaRow = Infer<typeof GoombaStateRow>;
export type NetWorldStateRow = Infer<typeof WorldStateRow>;

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type NetPlayerSnapshot = LocalPlayerSnapshot;

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
  state: "idle" | "charge" | "enraged" | "cooldown" | "defeated";
}

export interface PlayerInventorySnapshot {
  identity: string;
  ringCount: number;
  updatedAtMs: number;
}

export interface PlayerStatsSnapshot {
  identity: string;
  displayName: string;
  highestRingCount: number;
  updatedAtMs: number;
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
  playerInventories: Map<string, PlayerInventorySnapshot>;
  playerStats: Map<string, PlayerStatsSnapshot>;
  goombas: Map<string, GoombaState>;
  collectedRingIds: Set<string>;
  chatMessages: ChatMessageEvent[];
  diagnostics: MultiplayerDiagnostics;
}

export interface MultiplayerReducerFns {
  upsertPlayerState: (snapshot: NetPlayerSnapshot) => void;
  castFireball: (request: CastFireballCommand) => void;
  sendChatMessage: (request: SendChatMessageCommand) => void;
  collectRing: (request: CollectRingCommand) => void;
}
