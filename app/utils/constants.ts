import * as THREE from "three";
import type { CharacterInputState } from "../controller/controllerTypes";

export const CHARACTER_PATH = "/models/character/character_new.gltf";

export const DEFAULT_CHARACTER_TARGET_HEIGHT = 1.85;
export const MIN_DELTA_SECONDS = 1e-6;
export const STATE_BLEND_DURATION_SECONDS = 0.18;
export const DEFAULT_FADE_IN_SECONDS = 0.01;
export const WALK_TIME_SCALE = 1;
export const RUNNING_TIME_SCALE = 1;
export const JUMP_TIME_SCALE = 1;
export const JUMP_RUNNING_TIME_SCALE = 1;
export const HAPPY_TIME_SCALE = 1;
export const SAD_TIME_SCALE = 1;
export const ROOT_MOTION_TRACK_NODE_ALIASES = [
  "mixamorighips",
  "hipsfreehelper",
  "ctrlhipsfree",
  "ctrlhips",
] as const;

export const DEFAULT_INPUT_STATE: CharacterInputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  jump: false,
};

export const CAMERA_MODE_TOGGLE_KEY = "KeyV";
export const FPS_TOGGLE_KEY = "KeyF";
export const HAPPY_EMOTE_KEY = "KeyH";
export const SAD_EMOTE_KEY = "KeyJ";

export const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const CAMERA_LOOK_SENSITIVITY = 0.0022;
export const MOUSE_YAW_SIGN = 1;
export const MOUSE_PITCH_SIGN = 1;
export const MIN_PITCH = -1.1;
export const MAX_PITCH = 1.1;
export const LOOK_TARGET_DISTANCE = 20;
export const FIRST_PERSON_CAMERA_FOV = 55;
export const THIRD_PERSON_CAMERA_FOV = 47;

export const PLAYER_START_POSITION = new THREE.Vector3(0, 3, -2);
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.45;
export const PLAYER_CAPSULE_RADIUS = 0.35;
export const PLAYER_VISUAL_Y_OFFSET = -(
  PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS
);
export const PLAYER_EYE_HEIGHT_OFFSET = 0.8;

export const PLAYER_SPEED_SCALAR = 1.28;
export const PLAYER_WALK_SPEED = 1.5 * PLAYER_SPEED_SCALAR;
export const PLAYER_RUN_SPEED = 5.0 * PLAYER_SPEED_SCALAR;
export const WALK_ANIM_REFERENCE_SPEED = 1.28;
export const RUN_ANIM_REFERENCE_SPEED = 2.56;
export const PLAYER_JUMP_VELOCITY = 12;
export const WORLD_GRAVITY_Y = -18;
export const JUMP_AIR_TIME_SECONDS =
  (2 * PLAYER_JUMP_VELOCITY) / Math.max(Math.abs(WORLD_GRAVITY_Y), 1e-6);
export const JUMP_INPUT_BUFFER_SECONDS = 0.15;
export const PLAYER_ACCELERATION = 40;
export const PLAYER_LINEAR_DAMPING = 4;
export const PLAYER_GROUND_CAST_DISTANCE =
  PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS + 0.2;
export const GROUNDED_GRACE_SECONDS = 0.12;
export const VERTICAL_STILL_GROUNDED_RECOVERY_SECONDS = 0.11;
export const VERTICAL_STILL_ENTER_SPEED_EPS = 0.2;
export const VERTICAL_STILL_EXIT_SPEED_EPS = 0.35;

export const WALK_SPEED_THRESHOLD = 0.2;
export const PLANAR_SPEED_SMOOTHING = 30;

export const CHARACTER_CAMERA_YAW_SIGN = -1;
export const CHARACTER_MODEL_YAW_OFFSET = Math.PI;
export const MAX_FRAME_DELTA_SECONDS = 0.05;

export const THIRD_PERSON_CAMERA_DISTANCE = 3.5;
export const THIRD_PERSON_ORBIT_ORIGIN_HEIGHT_OFFSET = -0.35;
export const THIRD_PERSON_PIVOT_HEIGHT_OFFSET = 0.55;
export const THIRD_PERSON_CAMERA_SMOOTHNESS = 16;
export const THIRD_PERSON_CAMERA_COLLISION_RADIUS = 0.2;
export const THIRD_PERSON_CAMERA_COLLISION_SKIN = 0.08;
export const THIRD_PERSON_CAMERA_MIN_DISTANCE = 0.5;

export const GROUND_HALF_EXTENT = 50;
export const GROUND_MESH_SEGMENTS = 128;
export const TERRAIN_HEIGHT_AMPLITUDE = 2.5;
export const TERRAIN_BASE_NOISE_SCALE = 0.045;
export const TERRAIN_DETAIL_NOISE_SCALE = 0.12;
export const TERRAIN_MICRO_NOISE_SCALE = 0.26;
export const TERRAIN_RIDGE_STRENGTH = 0.38;
export const TERRAIN_FLAT_RADIUS = 9;

// --- Per-chunk content density ---
export const CHUNK_ROCK_COUNT = 4;
export const CHUNK_ROCK_MIN_SPACING = 8;
export const CHUNK_ROCK_SCALE_MIN = 0.6;
export const CHUNK_ROCK_SCALE_MAX = 1.4;
export const CHUNK_TREE_COUNT = 7;
export const CHUNK_TREE_MIN_SPACING = 7.2;
export const CHUNK_TREE_ROCK_CLEARANCE = 4;
export const CHUNK_TREE_HEIGHT_SCALE_MIN = 0.78;
export const CHUNK_TREE_HEIGHT_SCALE_MAX = 1.42;
export const CHUNK_GRASS_BLADE_COUNT = 1600;
export const CHUNK_SPAWN_CLEARING_RADIUS = 6;
export const CHUNK_CLOUD_COUNT = 3;
export const CHUNK_CLOUD_MIN_HEIGHT = 26;
export const CHUNK_CLOUD_MAX_HEIGHT = 38;
export const CHUNK_CLOUD_MIN_SEGMENTS = 8;
export const CHUNK_CLOUD_MAX_SEGMENTS = 13;
export const CHUNK_CLOUD_MIN_OPACITY = 0.38;
export const CHUNK_CLOUD_MAX_OPACITY = 0.58;
export const CHUNK_CLOUD_MIN_SPEED = 0.1;
export const CHUNK_CLOUD_MAX_SPEED = 0.22;
export const CHUNK_CLOUD_FADE = 90;
export const TERRAIN_COLOR_VALLEY = "#4F9249";
export const TERRAIN_COLOR_MEADOW = "#69B35C";
export const TERRAIN_COLOR_HIGHLAND = "#7FBC73";
export const TERRAIN_COLOR_RIDGE = "#94A468";
export const TERRAIN_COLOR_DRY = "#9D9B61";
export const TERRAIN_COLOR_WILDFLOWER = "#A17DA8";
export const GRASS_FIELD_COLOR = "#6FBF5F";
export const GRASS_PATCH_COLOR = "#5FA84F";
export const GRASS_BLADE_COUNT = 14000;
export const GRASS_BLADE_BASE_WIDTH = 0.1;
export const GRASS_BLADE_BASE_HEIGHT = 0.62;
export const GRASS_BLADE_WIDTH_VARIANCE = 0.45;
export const GRASS_BLADE_HEIGHT_VARIANCE = 0.5;
export const GRASS_FIELD_RADIUS = GROUND_HALF_EXTENT - 0.8;
export const GRASS_DENSITY_NOISE_SCALE = 0.13;
export const GRASS_DENSITY_MIN = 0.4;
export const GRASS_ROCK_CLEARANCE = 0.45;
export const GRASS_WIND_STRENGTH = 0.17;
export const GRASS_WIND_SPEED = 1.2;
export const GRASS_WIND_SPATIAL_FREQUENCY = 0.34;
export const GRASS_DISTANCE_FADE_START = 25;
export const GRASS_DISTANCE_FADE_END = 58;
export const GRASS_ROOT_DARKEN = 0.68;
export const GRASS_TIP_LIGHTEN = 1.2;
export const GRASS_TINT_VARIATION = 0.16;
export const CAMPFIRE_POSITION = [2.8, 0, 2.4] as const;
export const ROCK_MATERIAL_COLOR = "#8D9188";
export const SKY_BACKGROUND_COLOR = "#0088ff";
export const HORIZON_COLOR = "#CFE9FF";
export const MOON_COLOR = "#808080";
export const SKY_FOG_NEAR = 35;
export const SKY_FOG_FAR = 135;

export const ROCK_FORMATIONS = [
  {
    position: [3.2, 0.5, -4.2] as const,
    collider: [0.7, 0.5, 0.65] as const,
    scale: [1.2, 0.8, 1] as const,
  },
  {
    position: [1.7, 0.33, -1.6] as const,
    collider: [0.45, 0.33, 0.42] as const,
    scale: [0.85, 0.62, 0.76] as const,
  },
  {
    position: [-2.8, 0.62, -2.4] as const,
    collider: [0.82, 0.62, 0.72] as const,
    scale: [1.35, 0.95, 1.1] as const,
  },
  {
    position: [-1.4, 0.28, 1.2] as const,
    collider: [0.38, 0.28, 0.32] as const,
    scale: [0.74, 0.54, 0.64] as const,
  },
  {
    position: [4.4, 0.43, 1.7] as const,
    collider: [0.6, 0.43, 0.55] as const,
    scale: [1.04, 0.74, 0.93] as const,
  },
] as const;

// --- Rings (collectibles) ---
export const RING_HOVER_HEIGHT = 1.2;
export const RING_MAJOR_RADIUS = 0.32;
export const RING_TUBE_RADIUS = 0.055;
export const RING_COLOR = "#FFE289";
export const RING_EMISSIVE_COLOR = "#FFD16A";
export const RING_EMISSIVE_INTENSITY = 0.5;
export const RING_ROUGHNESS = 0.0;
export const RING_METALNESS = 1.0;
export const RING_ENV_MAP_INTENSITY = 6.8;
export const RING_LIGHT_INTENSITY = 3.4;
export const RING_LIGHT_DISTANCE = 5.5;
export const RING_LIGHT_DECAY = 2;
export const RING_DROP_POINT_LIGHT_ENABLED = true;
export const RING_DROP_MAX_ACTIVE_POINT_LIGHTS = 8;
export const RING_ROTATION_SPEED = 2.2;
export const RING_BOB_AMPLITUDE = 0.18;
export const RING_BOB_SPEED = 2.0;
export const RING_SENSOR_RADIUS = 0.9;
export const RING_TORUS_SEGMENTS = 36;
export const RING_TUBE_SEGMENTS = 18;
export const RING_DROP_SENSOR_RADIUS = 1.2;
// Keep in sync with spacetimedb/src/index.ts (RING_COLLECT_RADIUS).
export const RING_COLLECT_RADIUS = 1.35;
export const RING_DROP_FALL_START_HEIGHT = 2.2;
export const RING_DROP_FALL_DURATION_MS = 650;
export const RING_DROP_LIFETIME_MS = 12_000;
export const RING_DROP_DESPAWN_FLASH_WINDOW_MS = 2_200;
export const RING_DROP_DESPAWN_FLASH_HZ = 9.5;
export const RING_DROP_DESPAWN_MIN_ALPHA = 0.12;

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

// --- Fireball ability ---
export const FIREBALL_COOLDOWN_SECONDS = 0.2;
export const FIREBALL_MAX_ACTIVE_COUNT = 32;
export const FIREBALL_RADIUS = 0.2;
export const FIREBALL_SPEED = 11.5;
export const FIREBALL_LAUNCH_VERTICAL_VELOCITY = 4.1;
export const FIREBALL_GRAVITY_Y = -24;
export const FIREBALL_BOUNCE_RESTITUTION = 0.88;
export const FIREBALL_BOUNCE_HORIZONTAL_RETAIN = 0.97;
export const FIREBALL_MIN_BOUNCE_Y_SPEED = 3.7;
export const FIREBALL_MAX_TRAVEL_DISTANCE = 24;
export const FIREBALL_DISTANCE_FADE_DECAY = 5.2;
export const FIREBALL_DISTANCE_FADE_MAX_SECONDS = 0.8;
export const FIREBALL_DISTANCE_FADE_VELOCITY_DAMP = 4.5;
export const FIREBALL_HIT_FADE_DECAY = 13;
export const FIREBALL_HIT_FADE_MAX_SECONDS = 0.25;
export const FIREBALL_EMISSIVE_INTENSITY = 2.8;
export const FIREBALL_LIGHT_INTENSITY = 2.1;
export const FIREBALL_MAX_ACTIVE_POINT_LIGHTS = 4;

// --- Goomba enemy ---
export const GOOMBA_MODEL_PATH =
  "/models/character/goomba_rar_extract/Goomba/Goomba_OpenCollada.DAE";
export const GOOMBA_MODEL_SCALE = 0.15;
export const GOOMBA_INTERACT_DISABLED_STATE = "defeated";
export const GOOMBA_STOMP_RADIUS = 0.95;
export const GOOMBA_STOMP_MIN_FALL_SPEED = 1.2;
export const GOOMBA_FIREBALL_HIT_RADIUS = 0.85;
export const GOOMBA_FIREBALL_HITBOX_RADIUS = 1.05;
export const GOOMBA_FIREBALL_HITBOX_HEIGHT = 2.4;
export const GOOMBA_FIREBALL_HITBOX_BASE_OFFSET = -0.1;
export const GOOMBA_HIT_RETRY_COOLDOWN_MS = 500;

// --- Mystery box gameplay ---
// Keep in sync with spacetimedb/src/shared/constants.ts.
export const MYSTERY_BOX_INTERACT_DISABLED_STATE = "depleted";
export const MYSTERY_BOX_HALF_EXTENT = 0.45;
