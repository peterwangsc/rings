import type { AnimationAction } from "three";
import type { MutableRefObject } from "react";

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
  readonly characterPath?: string;
  readonly motionState?: MotionState;
  readonly motionStateRef?: MutableRefObject<MotionState>;
  readonly planarSpeedRef?: MutableRefObject<number>;
  readonly fireballCastCountRef?: MutableRefObject<number>;
  readonly targetHeight?: number;
  readonly hidden?: boolean;
  readonly onEmoteFinished?: (emoteState: EmoteState) => void;
}
