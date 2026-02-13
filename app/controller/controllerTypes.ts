import type { CameraMode } from "../camera/cameraTypes";
import type { FireballManager } from "../gameplay/abilities/fireballManager";
import type { MutableRefObject } from "react";

export interface CharacterInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
}

export interface MobileMoveInput {
  x: number;
  y: number;
}

export interface CharacterRigControllerProps {
  readonly cameraMode: CameraMode;
  readonly onToggleCameraMode: () => void;
  readonly isWalkDefault: boolean;
  readonly onToggleDefaultGait: () => void;
  readonly onPointerLockChange?: (isLocked: boolean) => void;
  readonly onPlayerPositionUpdate?: (x: number, y: number, z: number) => void;
  readonly mobileMoveInputRef?: MutableRefObject<MobileMoveInput>;
  readonly mobileJumpPressedRef?: MutableRefObject<boolean>;
  readonly mobileFireballTriggerRef?: MutableRefObject<number>;
  readonly fireballManager?: FireballManager;
}
