import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { MotionState } from "../lib/characterTypes";
import { GROUNDED_GRACE_SECONDS, WALK_SPEED_THRESHOLD } from "./constants";

export function setMotionStateIfChanged(
  next: MotionState,
  currentRef: MutableRefObject<MotionState>,
  setState: Dispatch<SetStateAction<MotionState>>,
): void {
  if (currentRef.current === next) {
    return;
  }

  currentRef.current = next;
  setState(next);
}

export function updateUngroundedTimer(
  isGrounded: boolean,
  ungroundedTimerSeconds: number,
  deltaSeconds: number,
): number {
  return isGrounded
    ? 0
    : ungroundedTimerSeconds + Math.max(deltaSeconds, 0);
}

export function isGroundedWithinGracePeriod(
  ungroundedTimerSeconds: number,
): boolean {
  return ungroundedTimerSeconds < GROUNDED_GRACE_SECONDS;
}

interface ResolveMotionStateOptions {
  readonly didJump: boolean;
  readonly isGroundedStable: boolean;
  readonly verticalSpeed: number;
  readonly hasMoveIntent: boolean;
  readonly planarSpeed: number;
  readonly isWalkGait: boolean;
  readonly previousState: MotionState;
}

const IDLE_HOLD_SPEED = WALK_SPEED_THRESHOLD * 0.5;
const AIRBORNE_VERTICAL_SPEED_EPS = 0.35;

function isLocomotionState(state: MotionState): boolean {
  return state === "walk" || state === "running";
}

function resolveGroundedLocomotionState({
  hasMoveIntent,
  planarSpeed,
  isWalkGait,
  previousState,
}: Pick<
  ResolveMotionStateOptions,
  "hasMoveIntent" | "planarSpeed" | "isWalkGait" | "previousState"
>): MotionState {
  if (hasMoveIntent) {
    return isWalkGait ? "walk" : "running";
  }

  // No active locomotion intent: hold previous locomotion briefly while body decelerates.
  if (isLocomotionState(previousState) && planarSpeed >= IDLE_HOLD_SPEED) {
    return previousState;
  }

  return "idle";
}

function resolveAirborneState({
  didJump,
  hasMoveIntent,
  isWalkGait,
  previousState,
}: Pick<
  ResolveMotionStateOptions,
  "didJump" | "hasMoveIntent" | "isWalkGait" | "previousState"
>): MotionState {
  if (previousState === "jump" || previousState === "jump_running") {
    return previousState;
  }

  const hasRunIntent = !isWalkGait && hasMoveIntent;
  const jumpedFromRun = didJump && hasRunIntent;
  const fellFromRun = !didJump && (previousState === "running" || hasRunIntent);
  return jumpedFromRun || fellFromRun ? "jump_running" : "jump";
}

export function resolveTargetMotionState({
  didJump,
  isGroundedStable,
  verticalSpeed,
  hasMoveIntent,
  planarSpeed,
  isWalkGait,
  previousState,
}: ResolveMotionStateOptions): MotionState {
  const isTakingOff = verticalSpeed > AIRBORNE_VERTICAL_SPEED_EPS;
  const isAirborne = didJump || isTakingOff || !isGroundedStable;
  if (isAirborne) {
    return resolveAirborneState({
      didJump,
      hasMoveIntent,
      isWalkGait,
      previousState,
    });
  }

  return resolveGroundedLocomotionState({
    hasMoveIntent,
    planarSpeed,
    isWalkGait,
    previousState,
  });
}
