import type { CameraMode } from "../camera/cameraTypes";
import type { FireballManager } from "../gameplay/abilities/fireballManager";
import type { MutableRefObject } from "react";
import type {
  CastFireballCommand,
  HitGoombaCommand,
} from "../multiplayer/protocol";
import type {
  AuthoritativePlayerState,
  FireballSpawnEvent,
  GoombaState,
  NetPlayerSnapshot,
} from "../multiplayer/state/multiplayerTypes";

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
  readonly isInputSuspended?: boolean;
  readonly onPlayerPositionUpdate?: (x: number, y: number, z: number) => void;
  readonly mobileMoveInputRef?: MutableRefObject<MobileMoveInput>;
  readonly mobileJumpPressedRef?: MutableRefObject<boolean>;
  readonly mobileFireballTriggerRef?: MutableRefObject<number>;
  readonly fireballManager?: FireballManager;
  readonly onLocalPlayerSnapshot?: (snapshot: NetPlayerSnapshot) => void;
  readonly onLocalFireballCast?: (request: CastFireballCommand) => void;
  readonly onLocalFireballSound?: () => void;
  readonly onLocalJump?: () => void;
  readonly onLocalFootstepsActiveChange?: (isActive: boolean) => void;
  readonly goombas?: readonly GoombaState[];
  readonly onLocalGoombaHit?: (goombaId: HitGoombaCommand["goombaId"]) => void;
  readonly authoritativeLocalPlayerState?: AuthoritativePlayerState | null;
  readonly networkFireballSpawnQueueRef?: MutableRefObject<FireballSpawnEvent[]>;
}
