import { MAX_WORLD_ABS } from './constants';

export function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clampWorldAxis(value: number) {
  return Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, value));
}
