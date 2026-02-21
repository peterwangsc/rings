import type { CameraMode } from "../camera/cameraTypes";
import type { FireballLoopController } from "../audio/useGameAudio";
import type { FireballManager } from "../gameplay/abilities/fireballManager";
import type { MutableRefObject } from "react";
import type { CastFireballCommand, HitGoombaCommand } from "../multiplayer/protocol";
import type {
  AuthoritativePlayerState,
  FireballSpawnEvent,
  GoombaState,
  MysteryBoxState,
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
  /** Alternative to isInputSuspended — read in event handlers via ref so callers avoid render-time .current access */
  readonly isInputSuspendedRef?: MutableRefObject<boolean>;
  readonly onPlayerPositionUpdate?: (x: number, y: number, z: number) => void;
  readonly mobileMoveInputRef?: MutableRefObject<MobileMoveInput>;
  readonly mobileJumpPressedRef?: MutableRefObject<boolean>;
  readonly mobileFireballTriggerRef?: MutableRefObject<number>;
  readonly fireballManager?: FireballManager;
  readonly onLocalPlayerSnapshot?: (snapshot: NetPlayerSnapshot) => void;
  readonly onLocalFireballCast?: (request: CastFireballCommand) => void;
  readonly onLocalShootSound?: () => void;
  readonly onLocalJump?: () => void;
  readonly onLocalFootstepsActiveChange?: (isActive: boolean) => void;
  readonly damageEventCounterRef?: MutableRefObject<number>;
  readonly goombas?: readonly GoombaState[];
  readonly onLocalGoombaHit?: (goombaId: HitGoombaCommand["goombaId"]) => void;
  readonly mysteryBoxes?: readonly MysteryBoxState[];
  readonly onLocalMysteryBoxHit?: (mysteryBoxId: string) => void;
  readonly authoritativeLocalPlayerState?: AuthoritativePlayerState | null;
  /** Alternative to authoritativeLocalPlayerState — read in useFrame via ref so callers avoid render-time .current access */
  readonly authoritativeLocalPlayerStateRef?: MutableRefObject<AuthoritativePlayerState | null>;
  readonly networkFireballSpawnQueueRef?: MutableRefObject<FireballSpawnEvent[]>;
  readonly fireballLoopController?: FireballLoopController;
}
