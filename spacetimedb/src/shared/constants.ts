export const MAX_WORLD_ABS = 1000;
export const MAX_SNAPSHOT_SPEED = 40;
export const MAX_VERTICAL_DELTA = 18;
export const SNAPSHOT_POSITION_LEEWAY = 1.5;
export const PLAYER_CAST_COOLDOWN_MS = 200;
export const FIREBALL_EVENT_TTL_MS = 2400;
export const CHAT_MESSAGE_EVENT_TTL_MS = 10000;
export const CHAT_MESSAGE_MAX_LENGTH = 120;
export const FIREBALL_MIN_DIR_LENGTH = 0.5;
export const FIREBALL_MAX_DIR_LENGTH = 1.5;
export const FIREBALL_MIN_SPAWN_DISTANCE = 0.2;
export const FIREBALL_MAX_SPAWN_DISTANCE = 2.8;

// Keep in sync with app/utils/constants.ts (RING_COLLECT_RADIUS).
export const RING_COLLECT_RADIUS = 1.35;
export const RING_HOVER_HEIGHT = 1.2;
export const RING_DROP_HOVER_HEIGHT = 0.9;
// Keep in sync with app/utils/constants.ts (RING_DROP_LIFETIME_MS).
export const RING_DROP_LIFETIME_MS = 12_000;
export const RING_DROP_PRUNE_AFTER_COLLECT_MS = 20_000;
export const MAX_SPILL_RING_COUNT = 5;
export const MAX_RING_COUNT = 999;
export const PRUNE_MIN_INTERVAL_MS = 125;

export const GOOMBA_ENRAGE_RADIUS = 16;
export const GOOMBA_RUN_SPEED = 5.5;
export const GOOMBA_RUN_DURATION_MS = 2500;
export const GOOMBA_CHARGE_DURATION_MS = 1500;
export const GOOMBA_COOLDOWN_DURATION_MS = 3000;
export const GOOMBA_IDLE_WALK_SPEED = 1.7;
export const GOOMBA_IDLE_WANDER_MIN_DURATION_MS = 900;
export const GOOMBA_IDLE_WANDER_MAX_DURATION_MS = 2400;
export const GOOMBA_IDLE_LEASH_RADIUS = 9;
export const GOOMBA_PLAYER_HIT_RADIUS = 1.1;
export const GOOMBA_DEFEATED_DESPAWN_MS = 900;
// Supports ranged fireball hits (spawn distance + travel distance + hit radius buffer).
export const GOOMBA_HIT_VALIDATION_RADIUS = 28;
export const GOOMBA_CHUNK_ACTIVE_RADIUS = 1;
export const GOOMBA_CHUNK_SPAWN_THRESHOLD = 0.0;
export const GOOMBA_CHUNK_SPAWN_COOLDOWN_MS = 12_000;
export const GOOMBA_CHUNK_SPAWN_MARGIN = 6;
export const GOOMBA_CHUNK_HASH_SEED = 191.37;
export const GOOMBA_DISABLE_ORIGIN_CHUNK_SPAWN = false;

export const MYSTERY_BOX_HALF_EXTENT = 0.45;
export const MYSTERY_BOX_HOVER_HEIGHT = 2.4;
export const MYSTERY_BOX_PLAYER_HEAD_OFFSET = 0.8;
export const MYSTERY_BOX_MIN_UPWARD_VELOCITY = 1.8;
export const MYSTERY_BOX_HIT_VALIDATION_RADIUS = 1.35;
export const MYSTERY_BOX_HIT_VERTICAL_TOLERANCE = 0.55;
export const MYSTERY_BOX_DEPLETED_DESPAWN_MS = 900;
export const MYSTERY_BOX_RING_BURST_COUNT = 5;
export const MYSTERY_BOX_CHUNK_ACTIVE_RADIUS = 1;
export const MYSTERY_BOX_CHUNK_SPAWN_THRESHOLD = 0.0;
export const MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS = 12_000;
export const MYSTERY_BOX_CHUNK_SPAWN_MARGIN = 10;
export const MYSTERY_BOX_CHUNK_HASH_SEED = 313.73;
export const MYSTERY_BOX_DISABLE_ORIGIN_CHUNK_SPAWN = false;

export const WORLD_STATE_ROW_ID = "global";
export const WORLD_DAY_CYCLE_DURATION_SECONDS = 300;

export const GOOMBA_STATE_IDLE = "idle";
export const GOOMBA_STATE_ENRAGED = "enraged";
export const GOOMBA_STATE_DEFEATED = "defeated";
export const GOOMBA_STATE_CHARGE = "charge";
export const GOOMBA_STATE_COOLDOWN = "cooldown";
export const MYSTERY_BOX_STATE_READY = "ready";
export const MYSTERY_BOX_STATE_DEPLETED = "depleted";

export const RING_DROP_SOURCE_GOOMBA = "goomba_reward";
export const RING_DROP_SOURCE_SPILL = "spill";
export const RING_DROP_SOURCE_MYSTERY_BOX = "mystery_box";

export type GoombaStateTag =
  | typeof GOOMBA_STATE_IDLE
  | typeof GOOMBA_STATE_CHARGE
  | typeof GOOMBA_STATE_ENRAGED
  | typeof GOOMBA_STATE_COOLDOWN
  | typeof GOOMBA_STATE_DEFEATED;

export type MysteryBoxStateTag =
  | typeof MYSTERY_BOX_STATE_READY
  | typeof MYSTERY_BOX_STATE_DEPLETED;

export type RingDropSource =
  | typeof RING_DROP_SOURCE_GOOMBA
  | typeof RING_DROP_SOURCE_SPILL
  | typeof RING_DROP_SOURCE_MYSTERY_BOX;

export const MOTION_STATES = new Set([
  "idle",
  "walk",
  "running",
  "jump",
  "jump_running",
  "happy",
  "sad",
] as const);

export type MotionState =
  | "idle"
  | "walk"
  | "running"
  | "jump"
  | "jump_running"
  | "happy"
  | "sad";

export const RING_PLACEMENTS: ReadonlyArray<readonly [number, number]> = [
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

export const GOOMBA_SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [2.4, 2.8],
];

// Keep this terrain sampler in sync with app/utils/terrain.ts so ring height checks match gameplay.
export const TERRAIN_CHUNK_HALF_EXTENT = 50;
export const TERRAIN_CHUNK_SIZE = TERRAIN_CHUNK_HALF_EXTENT * 2;
export const TERRAIN_HEIGHT_AMPLITUDE = 2.5;
export const TERRAIN_BASE_NOISE_SCALE = 0.045;
export const TERRAIN_DETAIL_NOISE_SCALE = 0.12;
export const TERRAIN_MICRO_NOISE_SCALE = 0.26;
export const TERRAIN_RIDGE_STRENGTH = 0.38;
export const TERRAIN_FLAT_RADIUS = 9;
