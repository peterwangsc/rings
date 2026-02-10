import type { AnimationAction } from "three";

export type EmoteState = "happy" | "sad";

export type MotionState =
  | "idle"
  | "walk"
  | "running"
  | "jump"
  | "jump_running"
  | EmoteState;

export type MotionActionMap = Record<MotionState, AnimationAction | null>;

export interface CharacterActorProps {
  readonly motionState: MotionState;
  readonly targetHeight?: number;
  readonly hidden?: boolean;
  readonly onEmoteFinished?: (emoteState: EmoteState) => void;
}
