import type { GoombaState } from "../../multiplayer/state/multiplayerTypes";
import { GOOMBA_IDLE_WALK_SPEED } from "../../utils/constants";
import { sampleTerrainHeight } from "../../utils/terrain";

const MAX_WORLD_ABS = 1000;
const MAX_STEP_SECONDS = 0.2;
const MAX_SIM_DURATION_SECONDS = 30;

export type GoombaPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

function clampWorldAxis(value: number) {
  return Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, value));
}

export function resolveEstimatedServerNowMs(
  serverTimeOffsetMs: number | null,
  localNowMs: number = Date.now(),
) {
  return localNowMs + (serverTimeOffsetMs ?? 0);
}

export function writePredictedGoombaPose(
  goomba: GoombaState,
  estimatedServerNowMs: number,
  out: GoombaPose,
) {
  out.x = goomba.x;
  out.y = goomba.y;
  out.z = goomba.z;
  out.yaw = goomba.yaw;

  if (goomba.state !== "idle") {
    return out;
  }

  const segmentEndMs = goomba.stateEndsAtMs;
  if (segmentEndMs <= goomba.updatedAtMs) {
    return out;
  }

  const simulatedToMs = Math.min(estimatedServerNowMs, segmentEndMs);
  let remainingSeconds = Math.max(
    0,
    Math.min((simulatedToMs - goomba.updatedAtMs) / 1000, MAX_SIM_DURATION_SECONDS),
  );

  while (remainingSeconds > 1e-6) {
    const stepSeconds = Math.min(remainingSeconds, MAX_STEP_SECONDS);
    out.x = clampWorldAxis(
      out.x + Math.sin(out.yaw) * GOOMBA_IDLE_WALK_SPEED * stepSeconds,
    );
    out.z = clampWorldAxis(
      out.z - Math.cos(out.yaw) * GOOMBA_IDLE_WALK_SPEED * stepSeconds,
    );
    remainingSeconds -= stepSeconds;
  }

  out.y = sampleTerrainHeight(out.x, out.z);
  return out;
}
