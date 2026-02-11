"use client";

import { Physics } from "@react-three/rapier";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sky, Clouds, Cloud, Stars } from "@react-three/drei";
import { Camera, Frown, RotateCw, Smile } from "lucide-react";
import {
  Suspense,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  HemisphereLight,
  LinearFilter,
  PCFShadowMap,
  DirectionalLight,
  Fog as ThreeFog,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { Sky as SkyImpl } from "three-stdlib";
import type { CameraMode } from "../camera/cameraTypes";
import { CharacterRigController } from "../controller/CharacterRigController";
import type {
  MobileEmoteRequest,
  MobileMoveInput,
} from "../controller/controllerTypes";
import {
  FPS_TOGGLE_KEY,
  HORIZON_COLOR,
  SKY_FOG_FAR,
  SKY_FOG_NEAR,
  THIRD_PERSON_CAMERA_FOV,
  WORLD_GRAVITY_Y,
} from "../utils/constants";
import { WorldGeometry } from "./WorldGeometry";

/** Full cycle in seconds — sun rises, crosses the sky, and sets. */
const SUN_CYCLE_DURATION = 180;
/** Radius of the sun's circular arc. */
const SUN_ORBIT_RADIUS = 18;
const SUN_ORBIT_Z_OFFSET = 6;
/** Moon orbits at the same radius, opposite the sun. */
const MOON_ORBIT_RADIUS = 80;
const MOON_ORBIT_Z_OFFSET = -10;
const MOON_VISUAL_RADIUS = 1.8;
const MOON_HALO_BASE_SIZE = 11;
const MOON_HALO_PULSE_SIZE = 13.5;
const MOON_HALO_MAX_OPACITY = 0.36;
const SUN_LIGHT_DAY_INTENSITY = 1.35;
const SUN_SHADOW_ENABLE_THRESHOLD = 0.12;
const NIGHT_SKY_COLOR = "#071634";
const SKY_FADE_START = 0.15;
const SKY_FADE_END = 0.65;
const HEMISPHERE_LIGHT_DAY_INTENSITY = 0.75;
const HEMISPHERE_LIGHT_NIGHT_INTENSITY = 0.0;
const AMBIENT_LIGHT_DAY_INTENSITY = 0.75;
const AMBIENT_LIGHT_NIGHT_INTENSITY = 0.2;
const NIGHT_FOG_NEAR = 1000;
const NIGHT_FOG_FAR = 1100;
const FPS_UPDATE_INTERVAL_SECONDS = 0.35;
const FPS_SMOOTHING_FACTOR = 0.45;
const MOBILE_JOYSTICK_RADIUS_PX = 44;
const MOBILE_JOYSTICK_DEADZONE = 0.08;
const SPLASH_CONTROLS: ReadonlyArray<{
  keys: readonly string[];
  action: string;
}> = [
  { keys: ["W", "A", "S", "D"], action: "Move" },
  { keys: ["Space"], action: "Jump" },
  { keys: ["Shift"], action: "Hold for walk/run" },
  { keys: ["CapsLock"], action: "Toggle walk/run" },
  { keys: ["V"], action: "Toggle camera mode" },
  { keys: ["H", "J"], action: "Happy and sad emotes" },
  { keys: ["F"], action: "Toggle FPS overlay" },
  { keys: ["Esc"], action: "Unlock pointer" },
];

type SkyMaterialWithSunPosition = ShaderMaterial & {
  uniforms: {
    turbidity: { value: number };
    rayleigh: { value: number };
    mieCoefficient: { value: number };
    mieDirectionalG: { value: number };
    sunPosition: {
      value: {
        set: (x: number, y: number, z: number) => void;
      };
    };
  };
};

function MobileControlsOverlay({
  moveInputRef,
  jumpPressedRef,
  emoteRequestRef,
  onToggleCameraMode,
}: {
  moveInputRef: MutableRefObject<MobileMoveInput>;
  jumpPressedRef: MutableRefObject<boolean>;
  emoteRequestRef: MutableRefObject<MobileEmoteRequest>;
  onToggleCameraMode: () => void;
}) {
  const joystickPointerIdRef = useRef<number | null>(null);
  const jumpPointerIdRef = useRef<number | null>(null);
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const [isJumpActive, setIsJumpActive] = useState(false);

  const setMoveInput = useCallback(
    (x: number, y: number) => {
      moveInputRef.current.x = x;
      moveInputRef.current.y = y;
    },
    [moveInputRef],
  );

  const updateJoystickFromPointer = useCallback(
    (clientX: number, clientY: number, element: HTMLDivElement) => {
      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width * 0.5;
      const centerY = bounds.top + bounds.height * 0.5;
      const deltaX = clientX - centerX;
      const deltaY = clientY - centerY;
      const distance = Math.hypot(deltaX, deltaY);
      const clampedDistance = Math.min(distance, MOBILE_JOYSTICK_RADIUS_PX);
      const distanceScale = distance > 0 ? clampedDistance / distance : 0;
      const clampedX = deltaX * distanceScale;
      const clampedY = deltaY * distanceScale;
      const normalizedX = clampedX / MOBILE_JOYSTICK_RADIUS_PX;
      const normalizedY = clampedY / MOBILE_JOYSTICK_RADIUS_PX;
      const normalizedMagnitude = Math.hypot(normalizedX, normalizedY);

      setJoystickOffset({ x: clampedX, y: clampedY });

      if (normalizedMagnitude < MOBILE_JOYSTICK_DEADZONE) {
        setMoveInput(0, 0);
        return;
      }

      const deadzoneAdjustedMagnitude =
        (normalizedMagnitude - MOBILE_JOYSTICK_DEADZONE) /
        (1 - MOBILE_JOYSTICK_DEADZONE);
      const directionalScale =
        normalizedMagnitude > 0
          ? deadzoneAdjustedMagnitude / normalizedMagnitude
          : 0;
      setMoveInput(
        normalizedX * directionalScale,
        normalizedY * directionalScale,
      );
    },
    [setMoveInput],
  );

  const releaseJoystick = useCallback(
    (element: HTMLDivElement, pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
      joystickPointerIdRef.current = null;
      setMoveInput(0, 0);
      setJoystickOffset({ x: 0, y: 0 });
      setIsJoystickActive(false);
    },
    [setMoveInput],
  );

  const releaseJumpButton = useCallback(
    (element: HTMLButtonElement, pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
      jumpPointerIdRef.current = null;
      jumpPressedRef.current = false;
      setIsJumpActive(false);
    },
    [jumpPressedRef],
  );

  const handleJoystickPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== null) {
        return;
      }
      joystickPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsJoystickActive(true);
      updateJoystickFromPointer(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      event.preventDefault();
    },
    [updateJoystickFromPointer],
  );

  const handleJoystickPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== event.pointerId) {
        return;
      }
      updateJoystickFromPointer(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      event.preventDefault();
    },
    [updateJoystickFromPointer],
  );

  const handleJoystickPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== event.pointerId) {
        return;
      }
      releaseJoystick(event.currentTarget, event.pointerId);
      event.preventDefault();
    },
    [releaseJoystick],
  );

  const handleJoystickLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== event.pointerId) {
        return;
      }
      joystickPointerIdRef.current = null;
      setMoveInput(0, 0);
      setJoystickOffset({ x: 0, y: 0 });
      setIsJoystickActive(false);
    },
    [setMoveInput],
  );

  const handleJumpPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (jumpPointerIdRef.current !== null) {
        return;
      }
      jumpPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      jumpPressedRef.current = true;
      setIsJumpActive(true);
      event.preventDefault();
    },
    [jumpPressedRef],
  );

  const handleJumpPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (jumpPointerIdRef.current !== event.pointerId) {
        return;
      }
      releaseJumpButton(event.currentTarget, event.pointerId);
      event.preventDefault();
    },
    [releaseJumpButton],
  );

  const handleJumpLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (jumpPointerIdRef.current !== event.pointerId) {
        return;
      }
      jumpPointerIdRef.current = null;
      jumpPressedRef.current = false;
      setIsJumpActive(false);
    },
    [jumpPressedRef],
  );

  const handleEmotePointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      emoteState: "happy" | "sad",
    ) => {
      emoteRequestRef.current = emoteState;
      event.preventDefault();
    },
    [emoteRequestRef],
  );

  useEffect(() => {
    return () => {
      setMoveInput(0, 0);
      jumpPressedRef.current = false;
      emoteRequestRef.current = null;
      joystickPointerIdRef.current = null;
      jumpPointerIdRef.current = null;
    };
  }, [emoteRequestRef, jumpPressedRef, setMoveInput]);

  return (
    <div className="mobile-game-controls pointer-events-none absolute inset-x-0 bottom-0 z-40 items-end justify-between px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-6">
      <div
        role="presentation"
        className="mobile-joystick pointer-events-auto touch-none select-none"
        onPointerDown={handleJoystickPointerDown}
        onPointerMove={handleJoystickPointerMove}
        onPointerUp={handleJoystickPointerUp}
        onPointerCancel={handleJoystickPointerUp}
        onLostPointerCapture={handleJoystickLostPointerCapture}
      >
        <div className="mobile-joystick__ring" />
        <div
          className={`mobile-joystick__thumb ${isJoystickActive ? "mobile-joystick__thumb--active" : ""}`}
          style={{
            transform: `translate3d(${joystickOffset.x}px, ${joystickOffset.y}px, 0)`,
          }}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          aria-label="Toggle view mode"
          className="mobile-view-toggle-button pointer-events-auto touch-none select-none"
          onClick={onToggleCameraMode}
        >
          <Camera
            aria-hidden="true"
            className="mobile-control-icon mobile-control-icon--camera"
          />
        </button>
        <div className="mobile-jump-cluster">
          <button
            type="button"
            aria-label="Happy emote"
            className="mobile-emote-button mobile-emote-button--happy pointer-events-auto touch-none select-none"
            onPointerDown={(event) => handleEmotePointerDown(event, "happy")}
          >
            <Smile
              aria-hidden="true"
              className="mobile-control-icon mobile-control-icon--emote"
            />
          </button>
          <button
            type="button"
            aria-label="Sad emote"
            className="mobile-emote-button mobile-emote-button--sad pointer-events-auto touch-none select-none"
            onPointerDown={(event) => handleEmotePointerDown(event, "sad")}
          >
            <Frown
              aria-hidden="true"
              className="mobile-control-icon mobile-control-icon--emote"
            />
          </button>
          <button
            type="button"
            aria-label="Jump"
            className={`mobile-jump-button mobile-jump-cluster__jump pointer-events-auto touch-none select-none ${isJumpActive ? "mobile-jump-button--active" : ""}`}
            onPointerDown={handleJumpPointerDown}
            onPointerUp={handleJumpPointerUp}
            onPointerCancel={handleJumpPointerUp}
            onLostPointerCapture={handleJumpLostPointerCapture}
          >
            <span className="mobile-jump-button__label">Jump</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AnimatedSun({
  followPositionRef,
}: {
  followPositionRef: MutableRefObject<Vector3>;
}) {
  const skyRef = useRef<SkyImpl>(null);
  const lightRef = useRef<DirectionalLight>(null);
  const sunTargetRef = useRef<Object3D>(null);
  const moonRef = useRef<Mesh>(null);
  const moonHaloRef = useRef<Sprite>(null);
  const moonLightRef = useRef<DirectionalLight>(null);
  const moonTargetRef = useRef<Object3D>(null);
  const starsRef = useRef<Points>(null);
  const hemisphereRef = useRef<HemisphereLight>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const angleRef = useRef(Math.PI * 0.25); // start mid-morning
  const sunOffsetRef = useRef(new Vector3());
  const moonOffsetRef = useRef(new Vector3());
  const daySkyColor = useMemo(() => new Color(HORIZON_COLOR), []);
  const nightSkyColor = useMemo(() => new Color(NIGHT_SKY_COLOR), []);
  const blendedSkyColor = useMemo(() => new Color(HORIZON_COLOR), []);
  const moonGlowTexture = useMemo(() => {
    if (typeof document === "undefined") {
      return null;
    }

    const textureSize = 256;
    const canvas = document.createElement("canvas");
    canvas.width = textureSize;
    canvas.height = textureSize;

    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    const center = textureSize * 0.5;
    const gradient = context.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      center,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.74)");
    gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.3)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    context.fillStyle = gradient;
    context.fillRect(0, 0, textureSize, textureSize);

    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);

  useEffect(() => {
    return () => {
      moonGlowTexture?.dispose();
    };
  }, [moonGlowTexture]);

  useEffect(() => {
    if (lightRef.current && sunTargetRef.current) {
      lightRef.current.target = sunTargetRef.current;
    }
    if (moonLightRef.current && moonTargetRef.current) {
      moonLightRef.current.target = moonTargetRef.current;
    }
  }, []);

  useEffect(() => {
    if (skyRef.current) {
      // Sky and stars are both transparent; lock draw order so camera-facing
      // sorting cannot cause hemisphere-dependent popping.
      skyRef.current.renderOrder = -10;
      skyRef.current.frustumCulled = false;
      const skyMaterial = skyRef.current.material;
      if (!Array.isArray(skyMaterial)) {
        skyMaterial.depthWrite = false;
      }
    }
    if (starsRef.current) {
      // Drei Stars uses a custom vertex transform; disable frustum culling to
      // avoid view-direction popping from CPU-side bounds checks.
      starsRef.current.frustumCulled = false;
      starsRef.current.renderOrder = 1;
      const starsMaterial = starsRef.current.material;
      if (!Array.isArray(starsMaterial)) {
        // Keep stars stable across view directions and bright sky gradients.
        starsMaterial.depthTest = true;
        starsMaterial.depthWrite = false;
        starsMaterial.toneMapped = false;
      }
    }
  }, []);

  useFrame((state, delta) => {
    angleRef.current += (delta / SUN_CYCLE_DURATION) * Math.PI * 2;
    const angle = angleRef.current;
    const followPosition = followPositionRef.current;

    // Sun position offset around the player anchor.
    const sunOffset = sunOffsetRef.current.set(
      SUN_ORBIT_RADIUS * Math.cos(angle),
      SUN_ORBIT_RADIUS * Math.sin(angle),
      SUN_ORBIT_Z_OFFSET,
    );
    const sunHeight = sunOffset.y / SUN_ORBIT_RADIUS;
    const sunLightFactor = MathUtils.smoothstep(sunHeight, -0.04, 0.08);
    const nightFactor = MathUtils.clamp((-sunHeight - 0.08) / 0.42, 0, 1);

    if (skyRef.current) {
      skyRef.current.position.copy(followPosition);
      const skyMaterial = skyRef.current.material;
      if (!Array.isArray(skyMaterial)) {
        const typedSkyMaterial = skyMaterial as SkyMaterialWithSunPosition;
        typedSkyMaterial.uniforms.sunPosition.value.set(
          sunOffset.x,
          sunOffset.y,
          sunOffset.z,
        );
        typedSkyMaterial.uniforms.turbidity.value = MathUtils.lerp(
          0.8,
          10.0,
          nightFactor,
        );
        typedSkyMaterial.uniforms.rayleigh.value = MathUtils.lerp(
          0.2,
          6.0,
          nightFactor,
        );
        typedSkyMaterial.uniforms.mieCoefficient.value = MathUtils.lerp(
          0.0002,
          1.0,
          nightFactor,
        );
        typedSkyMaterial.uniforms.mieDirectionalG.value = MathUtils.lerp(
          0.999,
          0.0,
          nightFactor,
        );
        const skyFade = MathUtils.smoothstep(
          nightFactor,
          SKY_FADE_START,
          SKY_FADE_END,
        );
        typedSkyMaterial.transparent = true;
        typedSkyMaterial.opacity = 1 - skyFade;
      }
    }
    // Moon position — opposite side of the orbit
    const moonAngle = angle + Math.PI;
    const moonOffset = moonOffsetRef.current.set(
      MOON_ORBIT_RADIUS * Math.cos(moonAngle),
      MOON_ORBIT_RADIUS * Math.sin(moonAngle),
      MOON_ORBIT_Z_OFFSET,
    );
    const sceneFog = state.scene.fog;
    blendedSkyColor.lerpColors(daySkyColor, nightSkyColor, nightFactor);
    state.scene.background = blendedSkyColor;

    if (lightRef.current) {
      lightRef.current.position.copy(followPosition).add(sunOffset);
      lightRef.current.target.position.copy(followPosition);
      lightRef.current.target.updateMatrixWorld();
      lightRef.current.intensity = SUN_LIGHT_DAY_INTENSITY * sunLightFactor;
      lightRef.current.castShadow =
        sunLightFactor > SUN_SHADOW_ENABLE_THRESHOLD;
    }

    if (sceneFog instanceof ThreeFog) {
      sceneFog.near = MathUtils.lerp(SKY_FOG_NEAR, NIGHT_FOG_NEAR, nightFactor);
      sceneFog.far = MathUtils.lerp(SKY_FOG_FAR, NIGHT_FOG_FAR, nightFactor);
      sceneFog.color.copy(blendedSkyColor);
    }

    if (moonRef.current) {
      moonRef.current.position.copy(followPosition).add(moonOffset);
    }
    if (moonLightRef.current) {
      moonLightRef.current.position.copy(followPosition).add(moonOffset);
      moonLightRef.current.target.position.copy(followPosition);
      moonLightRef.current.target.updateMatrixWorld();
      // Fade moonlight in when moon is above horizon, out when below
      const moonElevation = Math.max(0, moonOffset.y / MOON_ORBIT_RADIUS);
      moonLightRef.current.intensity = moonElevation * 0.3 * nightFactor;
      if (moonHaloRef.current) {
        const moonGlowFactor = moonElevation * nightFactor;
        moonHaloRef.current.position.copy(followPosition).add(moonOffset);
        const haloSize = MathUtils.lerp(
          MOON_HALO_BASE_SIZE,
          MOON_HALO_PULSE_SIZE,
          moonGlowFactor,
        );
        moonHaloRef.current.scale.set(haloSize, haloSize, 1);
        const moonHaloMaterial = moonHaloRef.current.material;
        if (!Array.isArray(moonHaloMaterial)) {
          (moonHaloMaterial as SpriteMaterial).opacity =
            MOON_HALO_MAX_OPACITY * moonGlowFactor;
        }
      }
    }
    if (starsRef.current) {
      starsRef.current.position.copy(state.camera.position);
      starsRef.current.visible = nightFactor > 0.01;
      const starsMaterial = starsRef.current.material;
      if (!Array.isArray(starsMaterial)) {
        (starsMaterial as ShaderMaterial).opacity = nightFactor * 0.95;
      }
    }
    if (hemisphereRef.current) {
      hemisphereRef.current.intensity = MathUtils.lerp(
        HEMISPHERE_LIGHT_DAY_INTENSITY,
        HEMISPHERE_LIGHT_NIGHT_INTENSITY,
        nightFactor,
      );
    }
    if (ambientRef.current) {
      ambientRef.current.intensity = MathUtils.lerp(
        AMBIENT_LIGHT_DAY_INTENSITY,
        AMBIENT_LIGHT_NIGHT_INTENSITY,
        nightFactor,
      );
    }
  });

  return (
    <>
      <object3D ref={sunTargetRef} />
      <object3D ref={moonTargetRef} />
      <Stars
        ref={starsRef}
        radius={46}
        depth={8}
        count={850}
        factor={3}
        saturation={0}
        fade
        speed={0.08}
      />
      <Sky
        ref={skyRef}
        sunPosition={[8, 14, 6]}
        turbidity={0.8}
        rayleigh={0.2}
        mieCoefficient={0.0002}
        mieDirectionalG={0.999}
        distance={50}
        inclination={0.3}
        azimuth={0.5}
      />
      <directionalLight
        ref={lightRef}
        castShadow
        color="#FFF4D6"
        position={[8, 14, 6]}
        intensity={SUN_LIGHT_DAY_INTENSITY}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {/* Moon */}
      <mesh ref={moonRef} position={[-80, 0, -10]}>
        <sphereGeometry args={[MOON_VISUAL_RADIUS, 32, 32]} />
        <meshBasicMaterial color="#DCE4FF" />
      </mesh>
      {moonGlowTexture ? (
        <sprite
          ref={moonHaloRef}
          position={[-80, 0, -10]}
          scale={[MOON_HALO_BASE_SIZE, MOON_HALO_BASE_SIZE, 1]}
        >
          <spriteMaterial
            map={moonGlowTexture}
            color="#A7C3FF"
            transparent
            opacity={0}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ) : null}
      <directionalLight
        ref={moonLightRef}
        color="#B0C4DE"
        position={[-80, 0, -10]}
        intensity={0}
      />
      <hemisphereLight
        ref={hemisphereRef}
        args={["#EAF6FF", "#8AA36D", HEMISPHERE_LIGHT_DAY_INTENSITY]}
      />
      <ambientLight ref={ambientRef} intensity={AMBIENT_LIGHT_DAY_INTENSITY} />
    </>
  );
}

function FrameRateProbe({ onUpdate }: { onUpdate: (fps: number) => void }) {
  const elapsedRef = useRef(0);
  const frameCountRef = useRef(0);
  const smoothedFpsRef = useRef<number | null>(null);

  useFrame((_, delta) => {
    if (delta <= 0) {
      return;
    }

    elapsedRef.current += delta;
    frameCountRef.current += 1;

    if (elapsedRef.current < FPS_UPDATE_INTERVAL_SECONDS) {
      return;
    }

    const sampledFps = frameCountRef.current / elapsedRef.current;
    const previousSmoothedFps = smoothedFpsRef.current;
    const smoothedFps =
      previousSmoothedFps === null
        ? sampledFps
        : MathUtils.lerp(previousSmoothedFps, sampledFps, FPS_SMOOTHING_FACTOR);
    smoothedFpsRef.current = smoothedFps;
    onUpdate(smoothedFps);
    elapsedRef.current = 0;
    frameCountRef.current = 0;
  });

  return null;
}

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
        <Clouds
          material={MeshBasicMaterial}
          frustumCulled={false}
          renderOrder={0}
        >
          <Cloud
            position={[-34, 29, -30]}
            speed={0.14}
            opacity={0.52}
            bounds={[18, 4, 1]}
            segments={10}
          />
          <Cloud
            position={[-12, 26, 24]}
            speed={0.18}
            opacity={0.58}
            bounds={[14, 3, 1]}
            segments={9}
          />
          <Cloud
            position={[8, 33, -6]}
            speed={0.1}
            opacity={0.45}
            bounds={[20, 5, 1]}
            segments={12}
          />
          <Cloud
            position={[24, 30, 18]}
            speed={0.16}
            opacity={0.5}
            bounds={[16, 4, 1]}
            segments={10}
          />
          <Cloud
            position={[36, 35, -28]}
            speed={0.21}
            opacity={0.42}
            bounds={[15, 3, 1]}
            segments={8}
          />
          <Cloud
            position={[-28, 34, 16]}
            speed={0.2}
            opacity={0.48}
            bounds={[12, 3, 1]}
            segments={8}
          />
          <Cloud
            position={[2, 28, 36]}
            speed={0.12}
            opacity={0.47}
            bounds={[18, 4, 1]}
            segments={11}
          />
          <Cloud
            position={[30, 27, -2]}
            speed={0.17}
            opacity={0.55}
            bounds={[13, 3, 1]}
            segments={9}
          />
        </Clouds>
        <Physics gravity={[0, WORLD_GRAVITY_Y, 0]}>
          <Suspense fallback={null}>
            <WorldGeometry playerPositionRef={playerWorldPositionRef} />
          </Suspense>
          <Suspense fallback={null}>
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
      {isFpsVisible ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-lg border border-white/35 bg-black/40 px-3 py-2 text-[11px] leading-4 text-white/95 backdrop-blur-sm">
          <p className="font-semibold tracking-wide text-white">FPS</p>
          <p>{fps ?? "--"}</p>
        </div>
      ) : null}
      {!isPointerLocked && !isSplashDismissedByTouch ? (
        <div className="pointer-events-none absolute inset-0 z-30 hidden overflow-hidden jump-overlay-copy xl:block">
          <div className="jump-scrim absolute inset-0" />
          <div className="jump-splash absolute inset-0" />
          <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-8">
            <div className="jump-splash-panel w-full max-w-5xl rounded-3xl p-6 sm:p-8 lg:p-10">
              <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-xs font-medium uppercase tracking-[0.28em] text-cyan-100/90 sm:text-sm">
                    Character Rig Sandbox
                  </p>
                  <div className="relative mt-2">
                    <p className="jump-logo-glow absolute left-[0.03em] top-[0.06em] text-5xl uppercase tracking-[0.1em] sm:text-7xl lg:text-8xl">
                      Jump Man
                    </p>
                    <h1 className="jump-logo relative text-5xl uppercase tracking-[0.1em] sm:text-7xl lg:text-8xl">
                      Jump Man
                    </h1>
                  </div>
                  <p className="mt-5 max-w-xl text-sm leading-relaxed text-cyan-50 sm:text-base">
                    Click anywhere to lock in and drop into the scene.
                  </p>
                  <div className="mt-7 inline-flex items-center gap-3 rounded-full border border-cyan-100/65 bg-cyan-100/14 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-50">
                    <span className="jump-cta-pulse inline-block h-2.5 w-2.5 rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(149,242,255,0.9)]" />
                    Click to start
                  </div>
                </div>
                <div className="w-full max-w-xl">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/85 sm:text-sm">
                    Controls
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SPLASH_CONTROLS.map(({ keys, action }) => (
                      <div
                        key={action}
                        className="jump-control-card rounded-xl px-3 py-2.5"
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {keys.map((keyLabel) => (
                            <span
                              key={`${action}-${keyLabel}`}
                              className="jump-keycap inline-flex rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-50/95 sm:text-[11px]"
                            >
                              {keyLabel}
                            </span>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[11px] leading-snug text-cyan-50/92 sm:text-xs">
                          {action}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <MobileControlsOverlay
        moveInputRef={mobileMoveInputRef}
        jumpPressedRef={mobileJumpPressedRef}
        emoteRequestRef={mobileEmoteRequestRef}
        onToggleCameraMode={handleToggleCameraMode}
      />
      <div className="mobile-portrait-lock jump-overlay-copy absolute inset-0 z-50 items-center justify-center px-5 py-8 text-center">
        <div className="mobile-portrait-lock__scrim absolute inset-0" />
        <div className="mobile-portrait-lock__panel relative w-full max-w-sm rounded-2xl px-6 py-7">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/85">
            Orientation Required
          </p>
          <div className="mt-4 flex justify-center">
            <div className="mobile-portrait-lock__device-frame">
              <RotateCw
                aria-hidden="true"
                className="mobile-portrait-lock__rotation-icon"
              />
              <div className="mobile-portrait-lock__device-notch" />
            </div>
          </div>
          <h2 className="mt-5 text-2xl font-semibold uppercase tracking-[0.12em] text-cyan-50">
            Rotate To Landscape
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-cyan-50/92">
            This experience is optimized for a wide screen. Rotate your device
            to continue.
          </p>
        </div>
      </div>
    </div>
  );
}
