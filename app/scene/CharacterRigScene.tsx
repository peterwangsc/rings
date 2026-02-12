"use client";

import { Physics } from "@react-three/rapier";
import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PCFShadowMap, Vector3 } from "three";
import type { CameraMode } from "../camera/cameraTypes";
import { CharacterRigController } from "../controller/CharacterRigController";
import type {
  MobileEmoteRequest,
  MobileMoveInput,
} from "../controller/controllerTypes";
import { RingField } from "../gameplay/collectibles/RingField";
import { GameHUD } from "../hud/GameHUD";
import {
  FPS_TOGGLE_KEY,
  HORIZON_COLOR,
  RING_PLACEMENTS,
  SKY_FOG_FAR,
  SKY_FOG_NEAR,
  THIRD_PERSON_CAMERA_FOV,
  WORLD_GRAVITY_Y,
} from "../utils/constants";
import { AnimatedSun } from "./AnimatedSun";
import { FrameRateProbe } from "./FrameRateProbe";
import { MobileControlsOverlay } from "./MobileControlsOverlay";
import { SceneCloudLayer } from "./SceneCloudLayer";
import { DesktopSplashOverlay, MobileOrientationOverlay } from "./SceneOverlays";
import { WorldGeometry } from "./WorldGeometry";

const CAMERA_MODE_CYCLE: readonly CameraMode[] = [
  "third_person",
  "first_person",
];

export function CharacterRigScene() {
  const [cameraMode, setCameraMode] = useState<CameraMode>("third_person");
  const [isWalkDefault, setIsWalkDefault] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isFpsVisible, setIsFpsVisible] = useState(false);
  const [isSplashDismissedByTouch, setIsSplashDismissedByTouch] =
    useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [collectedRingIds, setCollectedRingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const playerWorldPositionRef = useRef(new Vector3());
  const mobileMoveInputRef = useRef<MobileMoveInput>({ x: 0, y: 0 });
  const mobileJumpPressedRef = useRef(false);
  const mobileEmoteRequestRef = useRef<MobileEmoteRequest>(null);

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

  const handleRingCollected = useCallback((ringId: string) => {
    setCollectedRingIds((prev) => {
      if (prev.has(ringId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(ringId);
      return next;
    });
  }, []);

  const handlePlayerPositionUpdate = useCallback(
    (x: number, y: number, z: number) => {
      playerWorldPositionRef.current.set(x, y, z);
    },
    [],
  );

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
          far: 200,
          position: [0, 2.2, 6],
        }}
        className="h-full w-full touch-none"
      >
        <AnimatedSun followPositionRef={playerWorldPositionRef} />
        {isFpsVisible ? <FrameRateProbe onUpdate={handleFpsUpdate} /> : null}
        <fog attach="fog" args={[HORIZON_COLOR, SKY_FOG_NEAR, SKY_FOG_FAR]} />
        <SceneCloudLayer />
        <Physics gravity={[0, WORLD_GRAVITY_Y, 0]}>
          <Suspense fallback={null}>
            <WorldGeometry playerPositionRef={playerWorldPositionRef} />
            <RingField
              collectedIds={collectedRingIds}
              onCollect={handleRingCollected}
            />
            <CharacterRigController
              cameraMode={cameraMode}
              onToggleCameraMode={handleToggleCameraMode}
              isWalkDefault={isWalkDefault}
              onToggleDefaultGait={handleToggleDefaultGait}
              onPointerLockChange={handlePointerLockChange}
              onPlayerPositionUpdate={handlePlayerPositionUpdate}
              mobileMoveInputRef={mobileMoveInputRef}
              mobileJumpPressedRef={mobileJumpPressedRef}
              mobileEmoteRequestRef={mobileEmoteRequestRef}
            />
          </Suspense>
        </Physics>
      </Canvas>
      <GameHUD
        ringCount={collectedRingIds.size}
        totalRings={RING_PLACEMENTS.length}
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
      />
      <MobileControlsOverlay
        moveInputRef={mobileMoveInputRef}
        jumpPressedRef={mobileJumpPressedRef}
        emoteRequestRef={mobileEmoteRequestRef}
        onToggleCameraMode={handleToggleCameraMode}
      />
      <MobileOrientationOverlay />
    </div>
  );
}
