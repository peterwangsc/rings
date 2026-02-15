import { schema, table, t } from 'spacetimedb/server';

const playerState = table(
  { name: 'player_state', public: true },
  {
    identity: t.string().primaryKey(),
    displayName: t.string(),
    x: t.f64(),
    y: t.f64(),
    z: t.f64(),
    yaw: t.f64(),
    pitch: t.f64(),
    vx: t.f64(),
    vy: t.f64(),
    vz: t.f64(),
    planarSpeed: t.f64(),
    motionState: t.string(),
    lastInputSeq: t.f64(),
    updatedAtMs: t.f64(),
    lastCastAtMs: t.f64(),
  },
);

const playerInventory = table(
  { name: 'player_inventory', public: true },
  {
    identity: t.string().primaryKey(),
    ringCount: t.f64(),
    updatedAtMs: t.f64(),
  },
);

const ringState = table(
  { name: 'ring_state', public: true },
  {
    ringId: t.string().primaryKey(),
    collected: t.bool(),
    collectedBy: t.option(t.string()),
    collectedAtMs: t.option(t.f64()),
  },
);

const ringDropState = table(
  { name: 'ring_drop_state', public: true },
  {
    ringId: t.string().primaryKey(),
    x: t.f64(),
    y: t.f64(),
    z: t.f64(),
    source: t.string(),
    collected: t.bool(),
    collectedBy: t.option(t.string()),
    collectedAtMs: t.option(t.f64()),
    spawnedAtMs: t.f64(),
  },
);

const goombaState = table(
  { name: 'goomba_state', public: true },
  {
    goombaId: t.string().primaryKey(),
    spawnX: t.f64(),
    spawnY: t.f64(),
    spawnZ: t.f64(),
    x: t.f64(),
    y: t.f64(),
    z: t.f64(),
    yaw: t.f64(),
    state: t.string(),
    targetIdentity: t.option(t.string()),
    stateEndsAtMs: t.f64(),
    nextChargeAllowedAtMs: t.f64(),
    respawnAtMs: t.option(t.f64()),
    updatedAtMs: t.f64(),
  },
);

const worldState = table(
  { name: 'world_state', public: true },
  {
    id: t.string().primaryKey(),
    dayCycleAnchorMs: t.f64(),
    dayCycleDurationSeconds: t.f64(),
  },
);

const fireballEvent = table(
  { name: 'fireball_event', public: true },
  {
    eventId: t.string().primaryKey(),
    ownerIdentity: t.string(),
    originX: t.f64(),
    originY: t.f64(),
    originZ: t.f64(),
    directionX: t.f64(),
    directionY: t.f64(),
    directionZ: t.f64(),
    createdAtMs: t.f64(),
    expiresAtMs: t.f64(),
  },
);

const chatMessageEvent = table(
  { name: 'chat_message_event', public: true },
  {
    messageId: t.string().primaryKey(),
    ownerIdentity: t.string(),
    ownerDisplayName: t.string(),
    messageText: t.string(),
    createdAtMs: t.f64(),
    expiresAtMs: t.f64(),
  },
);

const session = table(
  { name: 'session' },
  {
    connectionId: t.string().primaryKey(),
    identity: t.string(),
    connectedAtMs: t.f64(),
  },
);

export const spacetimedb = schema(
  playerState,
  playerInventory,
  ringState,
  ringDropState,
  goombaState,
  worldState,
  fireballEvent,
  chatMessageEvent,
  session,
);
