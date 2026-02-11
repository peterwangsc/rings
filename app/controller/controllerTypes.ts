import type { CameraMode } from "../camera/cameraTypes";

export interface CharacterInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
}

export interface CharacterRigControllerProps {
  readonly cameraMode: CameraMode;
  readonly onToggleCameraMode: () => void;
  readonly isWalkDefault: boolean;
  readonly onToggleDefaultGait: () => void;
  readonly onPointerLockChange?: (isLocked: boolean) => void;
  readonly onPlayerPositionUpdate?: (x: number, y: number, z: number) => void;
}
