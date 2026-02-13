import { schema, table, t } from 'spacetimedb/server';

const MAX_WORLD_ABS = 1000;
const MAX_SNAPSHOT_SPEED = 40;
const MAX_VERTICAL_DELTA = 18;
const SNAPSHOT_POSITION_LEEWAY = 1.5;
const PLAYER_CAST_COOLDOWN_MS = 200;
const FIREBALL_EVENT_TTL_MS = 2400;
const FIREBALL_MIN_DIR_LENGTH = 0.5;
const FIREBALL_MAX_DIR_LENGTH = 1.5;
const FIREBALL_MIN_SPAWN_DISTANCE = 0.2;
const FIREBALL_MAX_SPAWN_DISTANCE = 2.8;
const RING_SERVER_COLLECT_RADIUS = 1.35;
const RING_HOVER_HEIGHT = 1.2;

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
  const t = Math.max(0, Math.min(1, (x - edge0) / (Math.abs(range) < 1e-6 ? 1e-6 : range)));
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
  const base = valueNoise2D(x * TERRAIN_BASE_NOISE_SCALE, z * TERRAIN_BASE_NOISE_SCALE) * 2 - 1;
  const detail =
    valueNoise2D((x + 39.2) * TERRAIN_DETAIL_NOISE_SCALE, (z - 12.7) * TERRAIN_DETAIL_NOISE_SCALE) *
      2 -
    1;
  const micro =
    valueNoise2D((x - 14.4) * TERRAIN_MICRO_NOISE_SCALE, (z + 24.3) * TERRAIN_MICRO_NOISE_SCALE) *
      2 -
    1;

  const ridgeNoise = valueNoise2D((x + 71.1) * 0.08, (z - 8.9) * 0.08) * 2 - 1;
  const ridgeShape = 1 - Math.abs(ridgeNoise);
  const ridge = Math.pow(Math.max(ridgeShape, 0), 2.1) * TERRAIN_RIDGE_STRENGTH;

  const radius = Math.hypot(x, z);
  const spawnMask = smoothstep(TERRAIN_FLAT_RADIUS * 0.45, TERRAIN_FLAT_RADIUS, radius);

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

const ringState = table(
  { name: 'ring_state', public: true },
  {
    ringId: t.string().primaryKey(),
    collected: t.bool(),
    collectedBy: t.option(t.string()),
    collectedAtMs: t.option(t.f64()),
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

const session = table(
  { name: 'session' },
  {
    connectionId: t.string().primaryKey(),
    identity: t.string(),
    connectedAtMs: t.f64(),
  },
);

export const spacetimedb = schema(playerState, ringState, fireballEvent, session);

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

type FireballEventRow = {
  expiresAtMs: number;
};

type FireballPruneContext = {
  db: {
    fireballEvent: {
      iter(): IteratorObject<FireballEventRow, undefined>;
      delete(row: FireballEventRow): boolean;
    };
  };
};

function pruneExpiredFireballEvents(
  ctx: FireballPruneContext,
  timestampMs: number,
) {
  for (const event of ctx.db.fireballEvent.iter()) {
    if (event.expiresAtMs <= timestampMs) {
      ctx.db.fireballEvent.delete(event);
    }
  }
}

spacetimedb.init((ctx) => {
  if (Number(ctx.db.ringState.count()) > 0) {
    return;
  }

  for (const ring of ringSeedData) {
    ctx.db.ringState.insert({
      ringId: ring.ringId,
      collected: false,
      collectedBy: undefined,
      collectedAtMs: undefined,
    });
  }
});

spacetimedb.clientConnected((ctx) => {
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
    connectedAtMs: nowMs(ctx),
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

    const nextRow = {
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

    pruneExpiredFireballEvents(ctx, timestampMs);

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

    pruneExpiredFireballEvents(ctx, timestampMs);

    let collectedRingCount = 0;
    for (const ring of ctx.db.ringState.iter()) {
      if (ring.collected && ring.collectedBy === identity) {
        collectedRingCount += 1;
      }
    }
    if (collectedRingCount <= 0) {
      return { tag: 'err', value: 'fireball_limit_reached' };
    }

    let activeOwnedFireballCount = 0;
    for (const event of ctx.db.fireballEvent.iter()) {
      if (event.ownerIdentity === identity) {
        activeOwnedFireballCount += 1;
      }
    }
    if (activeOwnedFireballCount >= collectedRingCount) {
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

    const ring = ctx.db.ringState.ringId.find(ringId);
    if (!ring) {
      return { tag: 'err', value: 'ring_missing' };
    }

    if (ring.collected) {
      return { tag: 'ok' };
    }

    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

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
      ...ring,
      collected: true,
      collectedBy: identity,
      collectedAtMs: timestampMs,
    });

    return { tag: 'ok' };
  },
);
