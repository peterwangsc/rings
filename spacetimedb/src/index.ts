import { schema, table, t } from 'spacetimedb/server';

const MAX_WORLD_ABS = 1000;
const MAX_SNAPSHOT_SPEED = 40;
const MAX_VERTICAL_DELTA = 18;
const SNAPSHOT_POSITION_LEEWAY = 1.5;
const PLAYER_CAST_COOLDOWN_MS = 200;
const FIREBALL_EVENT_TTL_MS = 2400;
const CHAT_MESSAGE_EVENT_TTL_MS = 10000;
const CHAT_MESSAGE_MAX_LENGTH = 120;
const FIREBALL_MIN_DIR_LENGTH = 0.5;
const FIREBALL_MAX_DIR_LENGTH = 1.5;
const FIREBALL_MIN_SPAWN_DISTANCE = 0.2;
const FIREBALL_MAX_SPAWN_DISTANCE = 2.8;
const RING_SERVER_COLLECT_RADIUS = 1.35;
const RING_HOVER_HEIGHT = 1.2;
const RING_DROP_HOVER_HEIGHT = 0.9;
// Keep in sync with app/utils/constants.ts (RING_DROP_LIFETIME_MS).
const RING_DROP_LIFETIME_MS = 12_000;
const RING_DROP_PRUNE_AFTER_COLLECT_MS = 20_000;
const MAX_SPILL_RING_COUNT = 24;
const MAX_RING_COUNT = 999;

const GOOMBA_DETECT_RADIUS = 11;
const GOOMBA_CHARGE_SPEED = 7.5;
const GOOMBA_CHARGE_DURATION_MS = 900;
const GOOMBA_CHARGE_COOLDOWN_MS = 2800;
const GOOMBA_PLAYER_HIT_RADIUS = 1.1;
const GOOMBA_RESPAWN_MS = 6000;
const GOOMBA_INTERACT_RADIUS = 9;

const WORLD_STATE_ROW_ID = 'global';
const WORLD_DAY_CYCLE_DURATION_SECONDS = 300;

const GOOMBA_STATE_IDLE = 'idle';
const GOOMBA_STATE_CHARGE = 'charge';
const GOOMBA_STATE_COOLDOWN = 'cooldown';
const GOOMBA_STATE_DEFEATED = 'defeated';

const RING_DROP_SOURCE_GOOMBA = 'goomba_reward';
const RING_DROP_SOURCE_SPILL = 'spill';

type GoombaStateTag =
  | typeof GOOMBA_STATE_IDLE
  | typeof GOOMBA_STATE_CHARGE
  | typeof GOOMBA_STATE_COOLDOWN
  | typeof GOOMBA_STATE_DEFEATED;

type RingDropSource =
  | typeof RING_DROP_SOURCE_GOOMBA
  | typeof RING_DROP_SOURCE_SPILL;

const MOTION_STATES = new Set([
  'idle',
  'walk',
  'running',
  'jump',
  'jump_running',
  'happy',
  'sad',
] as const);

type MotionState =
  | 'idle'
  | 'walk'
  | 'running'
  | 'jump'
  | 'jump_running'
  | 'happy'
  | 'sad';

const RING_PLACEMENTS: ReadonlyArray<readonly [number, number]> = [
  [3, 0],
  [-2, 3.5],
  [5.5, -3],
  [0, 5],
  [-5.5, -2],
  [6, 3.5],
  [-1, -5.5],
  [4, 7],
  [-6.5, 1],
  [1.5, -6],
];

const GOOMBA_SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [2.4, 2.8],
];

// Keep this terrain sampler in sync with app/utils/terrain.ts so ring height checks match gameplay.
const TERRAIN_HEIGHT_AMPLITUDE = 2.5;
const TERRAIN_BASE_NOISE_SCALE = 0.045;
const TERRAIN_DETAIL_NOISE_SCALE = 0.12;
const TERRAIN_MICRO_NOISE_SCALE = 0.26;
const TERRAIN_RIDGE_STRENGTH = 0.38;
const TERRAIN_FLAT_RADIUS = 9;

function fract(value: number) {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const range = edge1 - edge0;
  const t = Math.max(
    0,
    Math.min(1, (x - edge0) / (Math.abs(range) < 1e-6 ? 1e-6 : range)),
  );
  return t * t * (3 - 2 * t);
}

function hash2D(x: number, z: number) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function valueNoise2D(x: number, z: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;

  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const n00 = hash2D(x0, z0);
  const n10 = hash2D(x0 + 1, z0);
  const n01 = hash2D(x0, z0 + 1);
  const n11 = hash2D(x0 + 1, z0 + 1);

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

function sampleTerrainHeight(x: number, z: number) {
  const base =
    valueNoise2D(x * TERRAIN_BASE_NOISE_SCALE, z * TERRAIN_BASE_NOISE_SCALE) *
      2 -
    1;
  const detail =
    valueNoise2D(
      (x + 39.2) * TERRAIN_DETAIL_NOISE_SCALE,
      (z - 12.7) * TERRAIN_DETAIL_NOISE_SCALE,
    ) *
      2 -
    1;
  const micro =
    valueNoise2D(
      (x - 14.4) * TERRAIN_MICRO_NOISE_SCALE,
      (z + 24.3) * TERRAIN_MICRO_NOISE_SCALE,
    ) *
      2 -
    1;

  const ridgeNoise = valueNoise2D((x + 71.1) * 0.08, (z - 8.9) * 0.08) * 2 - 1;
  const ridgeShape = 1 - Math.abs(ridgeNoise);
  const ridge = Math.pow(Math.max(ridgeShape, 0), 2.1) * TERRAIN_RIDGE_STRENGTH;

  const radius = Math.hypot(x, z);
  const spawnMask = smoothstep(
    TERRAIN_FLAT_RADIUS * 0.45,
    TERRAIN_FLAT_RADIUS,
    radius,
  );

  const combinedNoise = base * 0.62 + detail * 0.26 + micro * 0.12;
  return (combinedNoise + ridge) * TERRAIN_HEIGHT_AMPLITUDE * spawnMask;
}

const ringSeedData = RING_PLACEMENTS.map((ring, index) => ({
  ringId: `ring-${index}`,
  x: ring[0],
  y: sampleTerrainHeight(ring[0], ring[1]) + RING_HOVER_HEIGHT,
  z: ring[1],
}));

const ringPositionById = new Map(
  ringSeedData.map((ring) => [ring.ringId, ring] as const),
);

const goombaSeedData = GOOMBA_SPAWNS.map((spawn, index) => {
  const x = spawn[0];
  const z = spawn[1];
  const y = sampleTerrainHeight(x, z);
  return {
    goombaId: `goomba-${index}`,
    spawnX: x,
    spawnY: y,
    spawnZ: z,
  };
});

type RingDropStateRow = {
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

type PlayerInventoryRow = {
  identity: string;
  ringCount: number;
  updatedAtMs: number;
};

type PlayerStateRow = {
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

type GoombaStateRow = {
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

type FireballEventRow = {
  eventId: string;
  ownerIdentity: string;
  expiresAtMs: number;
};

type ChatMessageEventRow = {
  expiresAtMs: number;
};

type WorldStateRow = {
  id: string;
  dayCycleAnchorMs: number;
  dayCycleDurationSeconds: number;
};

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

function nowMs(ctx: { timestamp: { toMillis(): bigint } }) {
  return Number(ctx.timestamp.toMillis());
}

function isFiniteNumber(value: number) {
  return Number.isFinite(value) && !Number.isNaN(value);
}

function sanitizeMotionState(motionState: string): MotionState {
  return MOTION_STATES.has(motionState as MotionState)
    ? (motionState as MotionState)
    : 'idle';
}

function sanitizeDisplayName(displayName: string, identity: string) {
  const trimmed = displayName.trim().slice(0, 24);
  if (trimmed.length > 0) {
    return trimmed;
  }
  const suffix = identity.replace(/^0x/, '').slice(0, 6);
  return `Guest-${suffix}`;
}

function getConnectionIdHex(connectionId: { toHexString(): string } | null) {
  return connectionId ? connectionId.toHexString() : null;
}

function sanitizeGoombaState(state: string): GoombaStateTag {
  switch (state) {
    case GOOMBA_STATE_IDLE:
    case GOOMBA_STATE_CHARGE:
    case GOOMBA_STATE_COOLDOWN:
    case GOOMBA_STATE_DEFEATED:
      return state;
    default:
      return GOOMBA_STATE_IDLE;
  }
}

function normalizeRingCount(value: number) {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_RING_COUNT, Math.floor(value)));
}

function createDropRingId(
  ctx: { newUuidV4(): { toString(): string } },
  prefix: string,
  timestampMs: number,
) {
  return `${prefix}-${Math.floor(timestampMs)}-${ctx.newUuidV4().toString()}`;
}

type WorldStateContext = {
  timestamp: { toMillis(): bigint };
  db: {
    worldState: {
      id: {
        find(id: string): WorldStateRow | null;
      };
      insert(row: WorldStateRow): void;
    };
  };
};

function ensureWorldStateRow(ctx: WorldStateContext) {
  const existing = ctx.db.worldState.id.find(WORLD_STATE_ROW_ID);
  if (existing) {
    return existing;
  }

  const nextWorldState: WorldStateRow = {
    id: WORLD_STATE_ROW_ID,
    dayCycleAnchorMs: nowMs(ctx),
    dayCycleDurationSeconds: WORLD_DAY_CYCLE_DURATION_SECONDS,
  };
  ctx.db.worldState.insert(nextWorldState);
  return nextWorldState;
}

type InventoryContext = {
  timestamp: { toMillis(): bigint };
  db: {
    playerInventory: {
      identity: {
        find(identity: string): PlayerInventoryRow | null;
        update(row: PlayerInventoryRow): number;
      };
      insert(row: PlayerInventoryRow): void;
    };
  };
};

function ensurePlayerInventory(
  ctx: InventoryContext,
  identity: string,
  timestampMs: number,
) {
  const existing = ctx.db.playerInventory.identity.find(identity);
  if (existing) {
    return existing;
  }

  const created: PlayerInventoryRow = {
    identity,
    ringCount: 0,
    updatedAtMs: timestampMs,
  };
  ctx.db.playerInventory.insert(created);
  return created;
}

type GoombaSeedContext = {
  db: {
    goombaState: {
      iter(): IteratorObject<GoombaStateRow, undefined>;
      delete(row: GoombaStateRow): boolean;
      insert(row: GoombaStateRow): void;
      goombaId: {
        find(goombaId: string): GoombaStateRow | null;
      };
    };
  };
};

function ensureGoombaRows(ctx: GoombaSeedContext, timestampMs: number) {
  const seedById = new Map(goombaSeedData.map((seed) => [seed.goombaId, seed] as const));

  for (const existing of ctx.db.goombaState.iter()) {
    if (seedById.has(existing.goombaId)) {
      continue;
    }
    ctx.db.goombaState.delete(existing);
  }

  for (const goomba of goombaSeedData) {
    if (ctx.db.goombaState.goombaId.find(goomba.goombaId)) {
      continue;
    }
    ctx.db.goombaState.insert({
      goombaId: goomba.goombaId,
      spawnX: goomba.spawnX,
      spawnY: goomba.spawnY,
      spawnZ: goomba.spawnZ,
      x: goomba.spawnX,
      y: goomba.spawnY,
      z: goomba.spawnZ,
      yaw: 0,
      state: GOOMBA_STATE_IDLE,
      targetIdentity: undefined,
      stateEndsAtMs: 0,
      nextChargeAllowedAtMs: timestampMs,
      respawnAtMs: undefined,
      updatedAtMs: timestampMs,
    });
  }
}

type PruneContext = {
  db: {
    fireballEvent: {
      iter(): IteratorObject<FireballEventRow, undefined>;
      delete(row: FireballEventRow): boolean;
    };
    chatMessageEvent: {
      iter(): IteratorObject<ChatMessageEventRow, undefined>;
      delete(row: ChatMessageEventRow): boolean;
    };
    ringDropState: {
      iter(): IteratorObject<RingDropStateRow, undefined>;
      delete(row: RingDropStateRow): boolean;
    };
  };
};

function pruneExpiredRows(ctx: PruneContext, timestampMs: number) {
  for (const event of ctx.db.fireballEvent.iter()) {
    if (event.expiresAtMs <= timestampMs) {
      ctx.db.fireballEvent.delete(event);
    }
  }

  for (const chatMessage of ctx.db.chatMessageEvent.iter()) {
    if (chatMessage.expiresAtMs <= timestampMs) {
      ctx.db.chatMessageEvent.delete(chatMessage);
    }
  }

  for (const drop of ctx.db.ringDropState.iter()) {
    if (timestampMs - drop.spawnedAtMs >= RING_DROP_LIFETIME_MS) {
      ctx.db.ringDropState.delete(drop);
      continue;
    }

    if (!drop.collected || drop.collectedAtMs === undefined) {
      continue;
    }
    if (timestampMs - drop.collectedAtMs >= RING_DROP_PRUNE_AFTER_COLLECT_MS) {
      ctx.db.ringDropState.delete(drop);
    }
  }
}

type GoombaTickContext = {
  newUuidV4(): { toString(): string };
  db: {
    playerState: {
      identity: {
        find(identity: string): PlayerStateRow | null;
      };
      iter(): IteratorObject<PlayerStateRow, undefined>;
    };
    playerInventory: {
      identity: {
        find(identity: string): PlayerInventoryRow | null;
        update(row: PlayerInventoryRow): number;
      };
    };
    goombaState: {
      iter(): IteratorObject<GoombaStateRow, undefined>;
      goombaId: {
        update(row: GoombaStateRow): number;
      };
    };
    ringDropState: {
      insert(row: RingDropStateRow): void;
    };
  };
};

function insertDropRing(
  ctx: GoombaTickContext,
  timestampMs: number,
  source: RingDropSource,
  x: number,
  z: number,
) {
  const terrainY = sampleTerrainHeight(x, z) + RING_DROP_HOVER_HEIGHT;
  ctx.db.ringDropState.insert({
    ringId: createDropRingId(ctx, source, timestampMs),
    x,
    y: terrainY,
    z,
    source,
    collected: false,
    collectedBy: undefined,
    collectedAtMs: undefined,
    spawnedAtMs: timestampMs,
  });
}

function spillPlayerRings(
  ctx: GoombaTickContext,
  identity: string,
  x: number,
  z: number,
  timestampMs: number,
) {
  const inventory = ctx.db.playerInventory.identity.find(identity);
  if (!inventory) {
    return;
  }
  const ringCount = normalizeRingCount(inventory.ringCount);
  if (ringCount <= 0) {
    return;
  }

  const spillCount = Math.min(MAX_SPILL_RING_COUNT, ringCount);
  for (let index = 0; index < spillCount; index += 1) {
    const angle = (index / Math.max(1, spillCount)) * Math.PI * 2;
    const radius = 1.35 + (index % 4) * 0.65;
    insertDropRing(
      ctx,
      timestampMs,
      RING_DROP_SOURCE_SPILL,
      x + Math.cos(angle) * radius,
      z + Math.sin(angle) * radius,
    );
  }

  ctx.db.playerInventory.identity.update({
    ...inventory,
    ringCount: 0,
    updatedAtMs: timestampMs,
  });
}

function tryPickChargeTarget(
  ctx: GoombaTickContext,
  goomba: GoombaStateRow,
) {
  let nearest: PlayerStateRow | null = null;
  let nearestDistance = GOOMBA_DETECT_RADIUS;

  for (const player of ctx.db.playerState.iter()) {
    const dx = player.x - goomba.x;
    const dz = player.z - goomba.z;
    const distance = Math.hypot(dx, dz);
    if (distance > nearestDistance) {
      continue;
    }
    nearest = player;
    nearestDistance = distance;
  }

  return nearest;
}

function tickGoombas(ctx: GoombaTickContext, timestampMs: number) {
  for (const goomba of ctx.db.goombaState.iter()) {
    const next: GoombaStateRow = {
      ...goomba,
      state: sanitizeGoombaState(goomba.state),
      updatedAtMs: timestampMs,
    };

    if (next.state === GOOMBA_STATE_DEFEATED) {
      if (next.respawnAtMs !== undefined && timestampMs >= next.respawnAtMs) {
        next.x = next.spawnX;
        next.y = next.spawnY;
        next.z = next.spawnZ;
        next.state = GOOMBA_STATE_IDLE;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
        next.respawnAtMs = undefined;
      }
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (next.state === GOOMBA_STATE_CHARGE) {
      const targetIdentity = next.targetIdentity;
      const target = targetIdentity
        ? ctx.db.playerState.identity.find(targetIdentity)
        : undefined;
      if (!target) {
        next.state = GOOMBA_STATE_COOLDOWN;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
        ctx.db.goombaState.goombaId.update(next);
        continue;
      }

      const dtSeconds = Math.max(
        0,
        Math.min((timestampMs - goomba.updatedAtMs) / 1000, 0.2),
      );
      const dx = target.x - next.x;
      const dz = target.z - next.z;
      const planarDistance = Math.hypot(dx, dz);

      if (planarDistance > 1e-6 && dtSeconds > 0) {
        const step = Math.min(planarDistance, GOOMBA_CHARGE_SPEED * dtSeconds);
        const invDistance = 1 / planarDistance;
        next.x += dx * invDistance * step;
        next.z += dz * invDistance * step;
        next.y = sampleTerrainHeight(next.x, next.z);
        next.yaw = Math.atan2(dx, -dz);
      }

      if (planarDistance <= GOOMBA_PLAYER_HIT_RADIUS) {
        spillPlayerRings(ctx, target.identity, target.x, target.z, timestampMs);
        next.state = GOOMBA_STATE_COOLDOWN;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
      } else if (timestampMs >= next.stateEndsAtMs) {
        next.state = GOOMBA_STATE_COOLDOWN;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
      }

      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (
      next.state === GOOMBA_STATE_COOLDOWN &&
      timestampMs < next.nextChargeAllowedAtMs
    ) {
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    const target = tryPickChargeTarget(ctx, next);
    if (!target) {
      next.state = GOOMBA_STATE_IDLE;
      next.targetIdentity = undefined;
      next.stateEndsAtMs = 0;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    next.state = GOOMBA_STATE_CHARGE;
    next.targetIdentity = target.identity;
    next.stateEndsAtMs = timestampMs + GOOMBA_CHARGE_DURATION_MS;
    ctx.db.goombaState.goombaId.update(next);
  }
}

spacetimedb.init((ctx) => {
  const timestampMs = nowMs(ctx);

  if (Number(ctx.db.ringState.count()) <= 0) {
    for (const ring of ringSeedData) {
      ctx.db.ringState.insert({
        ringId: ring.ringId,
        collected: false,
        collectedBy: undefined,
        collectedAtMs: undefined,
      });
    }
  }

  ensureGoombaRows(ctx, timestampMs);
  ensureWorldStateRow(ctx);
});

spacetimedb.clientConnected((ctx) => {
  const timestampMs = nowMs(ctx);
  ensureWorldStateRow(ctx);
  ensureGoombaRows(ctx, timestampMs);
  ensurePlayerInventory(ctx, ctx.sender.toHexString(), timestampMs);

  const connectionId = getConnectionIdHex(ctx.connectionId);
  if (!connectionId) {
    return;
  }

  const existing = ctx.db.session.connectionId.find(connectionId);
  if (existing) {
    ctx.db.session.delete(existing);
  }

  ctx.db.session.insert({
    connectionId,
    identity: ctx.sender.toHexString(),
    connectedAtMs: timestampMs,
  });
});

spacetimedb.clientDisconnected((ctx) => {
  const connectionId = getConnectionIdHex(ctx.connectionId);
  if (!connectionId) {
    return;
  }

  const identity = ctx.sender.toHexString();

  const existingSession = ctx.db.session.connectionId.find(connectionId);
  if (existingSession) {
    ctx.db.session.delete(existingSession);
  }

  const hasAnySession = Array.from(ctx.db.session.iter()).some(
    (candidate) => candidate.identity === identity,
  );

  if (!hasAnySession) {
    const player = ctx.db.playerState.identity.find(identity);
    if (player) {
      ctx.db.playerState.delete(player);
    }
  }
});

spacetimedb.reducer(
  'upsert_player_state',
  {
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
  },
  (ctx, payload) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);

    const numericValues = [
      payload.x,
      payload.y,
      payload.z,
      payload.yaw,
      payload.pitch,
      payload.vx,
      payload.vy,
      payload.vz,
      payload.planarSpeed,
      payload.lastInputSeq,
    ];

    if (numericValues.some((value) => !isFiniteNumber(value))) {
      return { tag: 'err', value: 'invalid_numeric_payload' };
    }

    const previous = ctx.db.playerState.identity.find(identity);

    let nextX = payload.x;
    let nextY = payload.y;
    let nextZ = payload.z;

    if (previous) {
      const dtMs = Math.max(1, timestampMs - previous.updatedAtMs);
      const maxPlanarStep =
        (MAX_SNAPSHOT_SPEED * dtMs) / 1000 + SNAPSHOT_POSITION_LEEWAY;

      const deltaX = nextX - previous.x;
      const deltaZ = nextZ - previous.z;
      const planarStep = Math.hypot(deltaX, deltaZ);

      if (planarStep > maxPlanarStep && planarStep > 1e-6) {
        const scale = maxPlanarStep / planarStep;
        nextX = previous.x + deltaX * scale;
        nextZ = previous.z + deltaZ * scale;
      }

      const deltaY = nextY - previous.y;
      if (Math.abs(deltaY) > MAX_VERTICAL_DELTA) {
        nextY = previous.y + Math.sign(deltaY) * MAX_VERTICAL_DELTA;
      }
    }

    nextX = Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, nextX));
    nextY = Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, nextY));
    nextZ = Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, nextZ));

    const nextRow: PlayerStateRow = {
      identity,
      displayName: sanitizeDisplayName(payload.displayName, identity),
      x: nextX,
      y: nextY,
      z: nextZ,
      yaw: payload.yaw,
      pitch: payload.pitch,
      vx: payload.vx,
      vy: payload.vy,
      vz: payload.vz,
      planarSpeed: Math.max(0, payload.planarSpeed),
      motionState: sanitizeMotionState(payload.motionState),
      lastInputSeq: Math.max(0, payload.lastInputSeq),
      updatedAtMs: timestampMs,
      lastCastAtMs: previous?.lastCastAtMs ?? -1,
    };

    if (previous) {
      ctx.db.playerState.delete(previous);
    }
    ctx.db.playerState.insert(nextRow);

    ensurePlayerInventory(ctx, identity, timestampMs);
    tickGoombas(ctx, timestampMs);
    pruneExpiredRows(ctx, timestampMs);

    return { tag: 'ok' };
  },
);

spacetimedb.reducer(
  'cast_fireball',
  {
    originX: t.f64(),
    originY: t.f64(),
    originZ: t.f64(),
    directionX: t.f64(),
    directionY: t.f64(),
    directionZ: t.f64(),
  },
  (ctx, payload) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);

    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
    const ringCount = normalizeRingCount(inventory.ringCount);

    const numericValues = [
      payload.originX,
      payload.originY,
      payload.originZ,
      payload.directionX,
      payload.directionY,
      payload.directionZ,
    ];
    if (numericValues.some((value) => !isFiniteNumber(value))) {
      return { tag: 'err', value: 'invalid_numeric_payload' };
    }

    if (
      player.lastCastAtMs >= 0 &&
      timestampMs - player.lastCastAtMs < PLAYER_CAST_COOLDOWN_MS
    ) {
      return { tag: 'err', value: 'cast_cooldown' };
    }

    pruneExpiredRows(ctx, timestampMs);

    if (ringCount <= 0) {
      return { tag: 'err', value: 'fireball_limit_reached' };
    }

    let activeOwnedFireballCount = 0;
    for (const event of ctx.db.fireballEvent.iter()) {
      if (event.ownerIdentity === identity) {
        activeOwnedFireballCount += 1;
      }
    }
    if (activeOwnedFireballCount >= ringCount) {
      return { tag: 'err', value: 'fireball_limit_reached' };
    }

    const directionLength = Math.hypot(
      payload.directionX,
      payload.directionY,
      payload.directionZ,
    );
    if (
      directionLength < FIREBALL_MIN_DIR_LENGTH ||
      directionLength > FIREBALL_MAX_DIR_LENGTH
    ) {
      return { tag: 'err', value: 'invalid_direction' };
    }

    const spawnDistance = Math.hypot(
      payload.originX - player.x,
      payload.originY - player.y,
      payload.originZ - player.z,
    );
    if (
      spawnDistance < FIREBALL_MIN_SPAWN_DISTANCE ||
      spawnDistance > FIREBALL_MAX_SPAWN_DISTANCE
    ) {
      return { tag: 'err', value: 'invalid_spawn_distance' };
    }

    const normalizedDirectionX = payload.directionX / directionLength;
    const normalizedDirectionY = payload.directionY / directionLength;
    const normalizedDirectionZ = payload.directionZ / directionLength;

    ctx.db.playerState.delete(player);
    ctx.db.playerState.insert({
      ...player,
      lastCastAtMs: timestampMs,
      updatedAtMs: timestampMs,
    });

    const eventId = `${identity}-${Math.floor(timestampMs)}-${ctx.newUuidV4().toString()}`;
    ctx.db.fireballEvent.insert({
      eventId,
      ownerIdentity: identity,
      originX: payload.originX,
      originY: payload.originY,
      originZ: payload.originZ,
      directionX: normalizedDirectionX,
      directionY: normalizedDirectionY,
      directionZ: normalizedDirectionZ,
      createdAtMs: timestampMs,
      expiresAtMs: timestampMs + FIREBALL_EVENT_TTL_MS,
    });

    return { tag: 'ok' };
  },
);

spacetimedb.reducer(
  'collect_ring',
  {
    ringId: t.string(),
  },
  (ctx, { ringId }) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);

    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const starterRing = ctx.db.ringState.ringId.find(ringId);
    if (starterRing) {
      if (!starterRing.collected) {
        const ringPosition = ringPositionById.get(ringId);
        if (!ringPosition) {
          return { tag: 'err', value: 'ring_position_missing' };
        }

        const distanceToRing = Math.hypot(
          player.x - ringPosition.x,
          player.y - ringPosition.y,
          player.z - ringPosition.z,
        );

        if (distanceToRing > RING_SERVER_COLLECT_RADIUS) {
          return { tag: 'err', value: 'ring_out_of_range' };
        }

        ctx.db.ringState.ringId.update({
          ...starterRing,
          collected: true,
          collectedBy: identity,
          collectedAtMs: timestampMs,
        });

        const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
        ctx.db.playerInventory.identity.update({
          ...inventory,
          ringCount: normalizeRingCount(inventory.ringCount + 1),
          updatedAtMs: timestampMs,
        });
      }

      return { tag: 'ok' };
    }

    const dropRing = ctx.db.ringDropState.ringId.find(ringId);
    if (!dropRing) {
      return { tag: 'err', value: 'ring_missing' };
    }

    if (timestampMs - dropRing.spawnedAtMs >= RING_DROP_LIFETIME_MS) {
      ctx.db.ringDropState.delete(dropRing);
      return { tag: 'err', value: 'ring_expired' };
    }

    if (dropRing.collected) {
      return { tag: 'ok' };
    }

    const distanceToRing = Math.hypot(
      player.x - dropRing.x,
      player.y - dropRing.y,
      player.z - dropRing.z,
    );

    if (distanceToRing > RING_SERVER_COLLECT_RADIUS) {
      return { tag: 'err', value: 'ring_out_of_range' };
    }

    ctx.db.ringDropState.ringId.update({
      ...dropRing,
      collected: true,
      collectedBy: identity,
      collectedAtMs: timestampMs,
    });

    const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
    ctx.db.playerInventory.identity.update({
      ...inventory,
      ringCount: normalizeRingCount(inventory.ringCount + 1),
      updatedAtMs: timestampMs,
    });

    return { tag: 'ok' };
  },
);

spacetimedb.reducer(
  'hit_goomba',
  {
    goombaId: t.string(),
  },
  (ctx, { goombaId }) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);
    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const goomba = ctx.db.goombaState.goombaId.find(goombaId);
    if (!goomba) {
      return { tag: 'err', value: 'goomba_missing' };
    }

    if (sanitizeGoombaState(goomba.state) === GOOMBA_STATE_DEFEATED) {
      return { tag: 'ok' };
    }

    const distanceToGoomba = Math.hypot(
      player.x - goomba.x,
      player.y - goomba.y,
      player.z - goomba.z,
    );

    if (distanceToGoomba > GOOMBA_INTERACT_RADIUS) {
      return { tag: 'err', value: 'goomba_out_of_range' };
    }

    ctx.db.goombaState.goombaId.update({
      ...goomba,
      state: GOOMBA_STATE_DEFEATED,
      targetIdentity: undefined,
      stateEndsAtMs: 0,
      nextChargeAllowedAtMs: timestampMs + GOOMBA_CHARGE_COOLDOWN_MS,
      respawnAtMs: timestampMs + GOOMBA_RESPAWN_MS,
      updatedAtMs: timestampMs,
    });

    insertDropRing(
      ctx,
      timestampMs,
      RING_DROP_SOURCE_GOOMBA,
      goomba.x,
      goomba.z,
    );

    pruneExpiredRows(ctx, timestampMs);

    return { tag: 'ok' };
  },
);

spacetimedb.reducer(
  'send_chat_message',
  {
    messageText: t.string(),
  },
  (ctx, payload) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);
    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const messageText = payload.messageText.replace(/\s+/g, ' ').trim();
    if (messageText.length <= 0) {
      return { tag: 'err', value: 'message_empty' };
    }
    if (messageText.length > CHAT_MESSAGE_MAX_LENGTH) {
      return { tag: 'err', value: 'message_too_long' };
    }

    pruneExpiredRows(ctx, timestampMs);

    const messageId = `${identity}-${Math.floor(timestampMs)}-${ctx.newUuidV4().toString()}`;
    ctx.db.chatMessageEvent.insert({
      messageId,
      ownerIdentity: identity,
      ownerDisplayName: player.displayName,
      messageText,
      createdAtMs: timestampMs,
      expiresAtMs: timestampMs + CHAT_MESSAGE_EVENT_TTL_MS,
    });

    return { tag: 'ok' };
  },
);
