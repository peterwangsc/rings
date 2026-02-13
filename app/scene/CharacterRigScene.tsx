"use client";

import { Physics } from "@react-three/rapier";
import { Canvas } from "@react-three/fiber";
import { SpacetimeDBProvider } from "spacetimedb/react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PCFShadowMap } from "three";
import type { CameraMode } from "../camera/cameraTypes";
import { CharacterRigController } from "../controller/CharacterRigController";
import type { MobileMoveInput } from "../controller/controllerTypes";
import { RingField } from "../gameplay/collectibles/RingField";
import { RemotePlayersLayer } from "../gameplay/multiplayer/RemotePlayersLayer";
import { GameHUD } from "../hud/GameHUD";
import {
  createMultiplayerStore,
  setLocalDisplayName,
  useMultiplayerStoreSnapshot,
  type MultiplayerStore,
} from "../multiplayer/state/multiplayerStore";
import type { FireballSpawnEvent } from "../multiplayer/state/multiplayerTypes";
import { useMultiplayerSync } from "../multiplayer/state/useMultiplayerSync";
import {
  createSpacetimeConnectionBuilder,
  getOrCreateGuestDisplayName,
  setStoredGuestDisplayName,
} from "../multiplayer/spacetime/client";
import {
  FPS_TOGGLE_KEY,
  HORIZON_COLOR,
  SKY_FOG_FAR,
  SKY_FOG_NEAR,
  THIRD_PERSON_CAMERA_FOV,
  WORLD_GRAVITY_Y,
} from "../utils/constants";
import { AnimatedSun } from "./AnimatedSun";
import { FrameRateProbe } from "./FrameRateProbe";
import { MobileControlsOverlay } from "./MobileControlsOverlay";
import { DesktopSplashOverlay, MobileOrientationOverlay } from "./SceneOverlays";
import { WorldGeometry } from "./WorldGeometry";
import {
  ACTIVE_TERRAIN_CHUNK_RADIUS,
  TERRAIN_CHUNK_SIZE,
} from "./world/terrainChunks";
import {
  createWorldEntityManager,
  disposeWorldEntityManager,
  updateWorldPlayerPosition,
} from "./world/worldEntityManager";

const CAMERA_MODE_CYCLE: readonly CameraMode[] = [
  "third_person",
  "first_person",
];
const ACTIVE_CHUNK_GRID_SIZE = ACTIVE_TERRAIN_CHUNK_RADIUS * 2 + 1;
const ACTIVE_CHUNK_GRID_WORLD_SPAN = ACTIVE_CHUNK_GRID_SIZE * TERRAIN_CHUNK_SIZE;
const CAMERA_FAR_DISTANCE = ACTIVE_CHUNK_GRID_WORLD_SPAN * 1.5;

function CharacterRigSceneContent({
  multiplayerStore,
}: {
  multiplayerStore: MultiplayerStore;
}) {
  const [cameraMode, setCameraMode] = useState<CameraMode>("third_person");
  const [isWalkDefault, setIsWalkDefault] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isFpsVisible, setIsFpsVisible] = useState(false);
  const [isSplashDismissedByTouch, setIsSplashDismissedByTouch] =
    useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const worldEntityManager = useMemo(() => createWorldEntityManager(), []);
  const mobileMoveInputRef = useRef<MobileMoveInput>({ x: 0, y: 0 });
  const mobileJumpPressedRef = useRef(false);
  const mobileFireballTriggerRef = useRef(0);
  const networkFireballSpawnQueueRef = useRef<FireballSpawnEvent[]>([]);

  const multiplayerVersion = useMultiplayerStoreSnapshot(multiplayerStore);
  void multiplayerVersion;

  const {
    sendLocalPlayerSnapshot,
    sendLocalFireballCast,
    sendRingCollect,
  } = useMultiplayerSync({
    store: multiplayerStore,
    worldEntityManager,
    networkFireballSpawnQueueRef,
  });

  const multiplayerState = multiplayerStore.state;
  const hasAuthoritativeMultiplayer =
    multiplayerState.connectionStatus === "connected";
  const remotePlayers = useMemo(
    () => Array.from(multiplayerState.remotePlayers.values()),
    [multiplayerState.remotePlayers],
  );

  const handleToggleCameraMode = useCallback(() => {
    setCameraMode((currentMode) => {
      const currentModeIndex = CAMERA_MODE_CYCLE.indexOf(currentMode);
      const nextModeIndex = (currentModeIndex + 1) % CAMERA_MODE_CYCLE.length;
      return CAMERA_MODE_CYCLE[nextModeIndex];
    });
  }, []);

  const handleToggleDefaultGait = useCallback(() => {
    setIsWalkDefault((currentMode) => !currentMode);
  }, []);

  const handlePointerLockChange = useCallback((isLocked: boolean) => {
    setIsPointerLocked(isLocked);
  }, []);

  const handleFpsUpdate = useCallback((nextFps: number) => {
    const roundedFps = Math.round(nextFps);
    setFps((currentFps) =>
      currentFps === roundedFps ? currentFps : roundedFps,
    );
  }, []);

  const handleToggleFpsOverlay = useCallback(() => {
    setIsFpsVisible((isVisible) => !isVisible);
  }, []);

  const handleSetLocalDisplayName = useCallback(
    (nextDisplayName: string) => {
      const storedDisplayName = setStoredGuestDisplayName(nextDisplayName);
      if (!storedDisplayName) {
        return;
      }
      setLocalDisplayName(multiplayerStore, storedDisplayName);
    },
    [multiplayerStore],
  );

  const handlePlayerPositionUpdate = useCallback(
    (x: number, y: number, z: number) => {
      updateWorldPlayerPosition(worldEntityManager, x, y, z);
    },
    [worldEntityManager],
  );

  useEffect(() => {
    return () => {
      disposeWorldEntityManager(worldEntityManager);
    };
  }, [worldEntityManager]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === FPS_TOGGLE_KEY && !event.repeat) {
        handleToggleFpsOverlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleToggleFpsOverlay]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        setIsSplashDismissedByTouch(true);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{
          fov: THIRD_PERSON_CAMERA_FOV,
          near: 0.1,
          far: CAMERA_FAR_DISTANCE,
          position: [0, 2.2, 6],
        }}
        className="h-full w-full touch-none"
      >
        <AnimatedSun worldEntityManager={worldEntityManager} />
        {isFpsVisible ? <FrameRateProbe onUpdate={handleFpsUpdate} /> : null}
        <fog attach="fog" args={[HORIZON_COLOR, SKY_FOG_NEAR, SKY_FOG_FAR]} />
        <Physics gravity={[0, WORLD_GRAVITY_Y, 0]}>
          <Suspense fallback={null}>
            <WorldGeometry worldEntityManager={worldEntityManager} />
            <RingField
              worldEntityManager={worldEntityManager}
              onCollectRing={
                hasAuthoritativeMultiplayer ? sendRingCollect : undefined
              }
            />
            <RemotePlayersLayer players={remotePlayers} />
            <CharacterRigController
              cameraMode={cameraMode}
              onToggleCameraMode={handleToggleCameraMode}
              isWalkDefault={isWalkDefault}
              onToggleDefaultGait={handleToggleDefaultGait}
              onPointerLockChange={handlePointerLockChange}
              onPlayerPositionUpdate={handlePlayerPositionUpdate}
              mobileMoveInputRef={mobileMoveInputRef}
              mobileJumpPressedRef={mobileJumpPressedRef}
              mobileFireballTriggerRef={mobileFireballTriggerRef}
              fireballManager={worldEntityManager.fireballManager}
              onLocalPlayerSnapshot={sendLocalPlayerSnapshot}
              onLocalFireballCast={sendLocalFireballCast}
              authoritativeLocalPlayerState={
                multiplayerState.authoritativeLocalPlayerState
              }
              networkFireballSpawnQueueRef={networkFireballSpawnQueueRef}
            />
          </Suspense>
        </Physics>
      </Canvas>
      <GameHUD
        worldEntityManager={worldEntityManager}
        localDisplayName={multiplayerState.localDisplayName}
        connectionStatus={multiplayerState.connectionStatus}
        remotePlayerCount={remotePlayers.length}
      />
      {isFpsVisible ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-lg border border-white/35 bg-black/40 px-3 py-2 text-[11px] leading-4 text-white/95 backdrop-blur-sm">
          <p className="font-semibold tracking-wide text-white">FPS</p>
          <p>{fps ?? "--"}</p>
        </div>
      ) : null}
      <DesktopSplashOverlay
        isPointerLocked={isPointerLocked}
        isSplashDismissedByTouch={isSplashDismissedByTouch}
        localDisplayName={multiplayerState.localDisplayName}
        onSetLocalDisplayName={handleSetLocalDisplayName}
      />
      <MobileControlsOverlay
        moveInputRef={mobileMoveInputRef}
        jumpPressedRef={mobileJumpPressedRef}
        fireballTriggerRef={mobileFireballTriggerRef}
        onToggleCameraMode={handleToggleCameraMode}
      />
      <MobileOrientationOverlay
        localDisplayName={multiplayerState.localDisplayName}
        onSetLocalDisplayName={handleSetLocalDisplayName}
      />
    </div>
  );
}

export function CharacterRigScene() {
  const connectionBuilder = useMemo(() => createSpacetimeConnectionBuilder(), []);
  const multiplayerStore = useMemo(
    () => createMultiplayerStore(getOrCreateGuestDisplayName()),
    [],
  );

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <CharacterRigSceneContent multiplayerStore={multiplayerStore} />
    </SpacetimeDBProvider>
  );
}
