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

export const PLAYER_START_POSITION = new THREE.Vector3(0, 1.5, -2);
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.45;
export const PLAYER_CAPSULE_RADIUS = 0.35;
export const PLAYER_VISUAL_Y_OFFSET = -(
  PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS
);
export const PLAYER_EYE_HEIGHT_OFFSET = 0.8;

export const PLAYER_SPEED_SCALAR = 1.28;
export const PLAYER_WALK_SPEED = 1.0 * PLAYER_SPEED_SCALAR;
export const PLAYER_RUN_SPEED = 2.0 * PLAYER_SPEED_SCALAR;
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
export const PLANAR_SPEED_SMOOTHING = 12;

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
export const TERRAIN_HEIGHT_AMPLITUDE = 3.4;
export const TERRAIN_BASE_NOISE_SCALE = 0.045;
export const TERRAIN_DETAIL_NOISE_SCALE = 0.12;
export const TERRAIN_MICRO_NOISE_SCALE = 0.26;
export const TERRAIN_RIDGE_STRENGTH = 0.38;
export const TERRAIN_FLAT_RADIUS = 9;
export const TERRAIN_EDGE_FALLOFF_START = GROUND_HALF_EXTENT - 8;
export const TERRAIN_EDGE_FALLOFF_END = GROUND_HALF_EXTENT - 1.5;
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
export const RING_COLOR = "#FFD700";
export const RING_EMISSIVE_COLOR = "#FFA000";
export const RING_EMISSIVE_INTENSITY = 0.45;
export const RING_ROUGHNESS = 0.3;
export const RING_METALNESS = 0.8;
export const RING_ROTATION_SPEED = 2.2;
export const RING_BOB_AMPLITUDE = 0.18;
export const RING_BOB_SPEED = 2.0;
export const RING_SENSOR_RADIUS = 0.9;
export const RING_TORUS_SEGMENTS = 24;
export const RING_TUBE_SEGMENTS = 12;

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
