import type { MotionState } from "../../lib/CharacterActor";
import type {
  CastFireballCommand,
  CollectRingCommand,
  HitGoombaCommand,
  LocalPlayerSnapshot,
  SendChatMessageCommand,
  UpsertPlayerStateCommand,
} from "./commands";

const MOTION_STATES = new Set<MotionState>([
  "idle",
  "walk",
  "running",
  "jump",
  "jump_running",
  "happy",
  "sad",
]);

// Keep in sync with spacetimedb/src/shared/constants.ts
const FIREBALL_MIN_DIR_LENGTH = 0.5;
const FIREBALL_MAX_DIR_LENGTH = 1.5;
const CHAT_MESSAGE_MAX_LENGTH = 120;

function isFiniteNumber(value: number) {
  return Number.isFinite(value) && !Number.isNaN(value);
}

function isNonEmptyString(value: string) {
  return value.trim().length > 0;
}

export function toUpsertPlayerStateCommand(
  snapshot: LocalPlayerSnapshot,
  displayName: string,
): UpsertPlayerStateCommand | null {
  const numericValues = [
    snapshot.x,
    snapshot.y,
    snapshot.z,
    snapshot.yaw,
    snapshot.pitch,
    snapshot.vx,
    snapshot.vy,
    snapshot.vz,
    snapshot.planarSpeed,
    snapshot.lastInputSeq,
  ];

  if (numericValues.some((value) => !isFiniteNumber(value))) {
    return null;
  }

  if (!MOTION_STATES.has(snapshot.motionState)) {
    return null;
  }

  return {
    ...snapshot,
    displayName,
  };
}

export function toCastFireballCommand(
  request: CastFireballCommand,
): CastFireballCommand | null {
  const numericValues = [
    request.originX,
    request.originY,
    request.originZ,
    request.directionX,
    request.directionY,
    request.directionZ,
  ];

  if (numericValues.some((value) => !isFiniteNumber(value))) {
    return null;
  }

  const directionLength = Math.hypot(
    request.directionX,
    request.directionY,
    request.directionZ,
  );
  if (
    directionLength < FIREBALL_MIN_DIR_LENGTH ||
    directionLength > FIREBALL_MAX_DIR_LENGTH
  ) {
    return null;
  }

  return request;
}

export function toCollectRingCommand(
  ringId: string,
): CollectRingCommand | null {
  const normalizedRingId = ringId.trim();
  if (!isNonEmptyString(normalizedRingId)) {
    return null;
  }
  return { ringId: normalizedRingId };
}

export function toHitGoombaCommand(
  goombaId: string,
): HitGoombaCommand | null {
  const normalizedGoombaId = goombaId.trim();
  if (!isNonEmptyString(normalizedGoombaId)) {
    return null;
  }
  return { goombaId: normalizedGoombaId };
}

export function toSendChatMessageCommand(
  messageText: string,
): SendChatMessageCommand | null {
  const normalizedMessageText = messageText.replace(/\s+/g, " ").trim();
  if (
    normalizedMessageText.length <= 0 ||
    normalizedMessageText.length > CHAT_MESSAGE_MAX_LENGTH
  ) {
    return null;
  }
  return { messageText: normalizedMessageText };
}
