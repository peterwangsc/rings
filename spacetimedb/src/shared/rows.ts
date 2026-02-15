export type RingDropStateRow = {
  ringId: string;
  x: number;
  y: number;
  z: number;
  source: string;
  collected: boolean;
  collectedBy: string | undefined;
  collectedAtMs: number | undefined;
  spawnedAtMs: number;
};

export type PlayerInventoryRow = {
  identity: string;
  ringCount: number;
  updatedAtMs: number;
};

export type PlayerStateRow = {
  identity: string;
  displayName: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  planarSpeed: number;
  motionState: string;
  lastInputSeq: number;
  updatedAtMs: number;
  lastCastAtMs: number;
};

export type GoombaStateRow = {
  goombaId: string;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: string;
  targetIdentity: string | undefined;
  stateEndsAtMs: number;
  nextChargeAllowedAtMs: number;
  respawnAtMs: number | undefined;
  updatedAtMs: number;
};

export type FireballEventRow = {
  eventId: string;
  ownerIdentity: string;
  expiresAtMs: number;
};

export type ChatMessageEventRow = {
  expiresAtMs: number;
};

export type WorldStateRow = {
  id: string;
  dayCycleAnchorMs: number;
  dayCycleDurationSeconds: number;
};
