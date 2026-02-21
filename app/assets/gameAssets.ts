import {
  CHARACTER_OLD_PATH,
  CHARACTER_PATH,
  GOOMBA_MODEL_PATH,
} from "../utils/constants";

export type GameSoundId =
  | "coin"
  | "footsteps"
  | "goomba"
  | "jump"
  | "shoot";
export type MusicTrackId = "day" | "night";

export const FIRE_TEXTURE_PATH = "/fire.png";
export const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
export const GRASS_LEAF_TEXTURE_PATH = "/grass-leaf.png";
export const GRASS_ACCENT_TEXTURE_PATH = "/grass-accent.png";

export const FIREBALL_LOOP_SOUND_PATHS = [
  "/sounds/fire/2.mp3",
  "/sounds/fire/5.mp3",
  "/sounds/fire/7.mp3",
  "/sounds/fire/8.mp3",
] as const;

export const SOUND_PATH_BY_ID: Record<GameSoundId, string> = {
  coin: "/sounds/coin.mp3",
  footsteps: "/sounds/footsteps.mp3",
  goomba: "/sounds/goomba.mp3",
  jump: "/sounds/jump.mp3",
  shoot: "/sounds/fireball.mp3",
};

export const MUSIC_PATH_BY_ID: Record<MusicTrackId, string> = {
  day: "/music/day.mp3",
  night: "/music/night.mp3",
};

export const PRELOAD_MODEL_PATHS = [
  CHARACTER_PATH,
  CHARACTER_OLD_PATH,
  GOOMBA_MODEL_PATH,
] as const;
export const PRELOAD_TEXTURE_PATHS = [
  FIRE_TEXTURE_PATH,
  SIMPLEX_NOISE_TEXTURE_PATH,
] as const;

export const PRELOAD_AUDIO_PATHS = [
  ...Object.values(SOUND_PATH_BY_ID),
  ...Object.values(MUSIC_PATH_BY_ID),
  ...FIREBALL_LOOP_SOUND_PATHS,
] as const;
