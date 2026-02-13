"use client";

import { Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog as ThreeFog,
  HemisphereLight,
  LinearFilter,
  MathUtils,
  Mesh,
  Object3D,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { HORIZON_COLOR, SKY_FOG_FAR, SKY_FOG_NEAR } from "../utils/constants";
import { InfiniteSky } from "./sky/InfiniteSky";
import type { ThreeSkyObject } from "./sky/ThreeSkyObject";
import {
  ACTIVE_TERRAIN_CHUNK_RADIUS,
  TERRAIN_CHUNK_SIZE,
} from "./world/terrainChunks";
import type { WorldEntityManager } from "./world/worldEntityManager";

const DEFAULT_SUN_CYCLE_DURATION_SECONDS = 300;
const SUN_CYCLE_PHASE_OFFSET_RADIANS = Math.PI * 0.25;
/** Radius of the sun's circular arc. */
const SUN_ORBIT_RADIUS = 18;
const SUN_ORBIT_Z_OFFSET = 6;
const SUN_VISUAL_ORBIT_RADIUS = 74;
const ACTIVE_CHUNK_GRID_SIZE = ACTIVE_TERRAIN_CHUNK_RADIUS * 2 + 1;
const ACTIVE_CHUNK_GRID_WORLD_SPAN =
  ACTIVE_CHUNK_GRID_SIZE * TERRAIN_CHUNK_SIZE;
const SKY_DOME_DISTANCE = ACTIVE_CHUNK_GRID_WORLD_SPAN;
/** Moon orbits at the same radius, opposite the sun. */
const MOON_ORBIT_RADIUS = 80;
const MOON_ORBIT_Z_OFFSET = -10;
const MOON_VISUAL_ORBIT_RADIUS = SKY_DOME_DISTANCE * 0.92;
const MOON_VISUAL_RADIUS = 5.8;
const MOON_HALO_BASE_SIZE = 11;
const MOON_HALO_PULSE_SIZE = 13.5;
const MOON_HALO_MAX_OPACITY = 0.52;
const MOON_LIGHT_MAX_INTENSITY = 0.55;
const SUN_LIGHT_DAY_INTENSITY = 1.35;
const SUN_SHADOW_ENABLE_THRESHOLD = 0.12;
const SUN_SET_FALLOFF_POWER = 1.5;
const SKY_CAMERA_Y_OFFSET = -14;
const NIGHT_SKY_COLOR = "#071634";
const HEMISPHERE_LIGHT_DAY_INTENSITY = 0.75;
const HEMISPHERE_LIGHT_NIGHT_INTENSITY = 0.0;
const AMBIENT_LIGHT_DAY_INTENSITY = 0.75;
const AMBIENT_LIGHT_NIGHT_INTENSITY = 0.2;
const NIGHT_FOG_NEAR = 30;
const NIGHT_FOG_FAR = 100;
const NIGHT_FACTOR_DAY_END_HEIGHT = 0.12;
const NIGHT_FACTOR_NIGHT_START_HEIGHT = -0.08;

type SkyMaterialWithSunPosition = ShaderMaterial & {
  uniforms: {
    turbidity: { value: number };
    rayleigh: { value: number };
    mieCoefficient: { value: number };
    mieDirectionalG: { value: number };
    sunsetFalloffPower: { value: number };
    sunPosition: {
      value: {
        set: (x: number, y: number, z: number) => void;
      };
    };
  };
};

function getCycleAngleRadians({
  dayCycleAnchorMs,
  dayCycleDurationSeconds,
  estimatedServerTimeOffsetMs,
}: {
  dayCycleAnchorMs: number;
  dayCycleDurationSeconds: number;
  estimatedServerTimeOffsetMs: number;
}) {
  const durationMs = Math.max(1, dayCycleDurationSeconds * 1000);
  const estimatedServerNowMs = Date.now() + estimatedServerTimeOffsetMs;
  const elapsedMs = estimatedServerNowMs - dayCycleAnchorMs;
  const wrappedElapsedMs =
    ((elapsedMs % durationMs) + durationMs) % durationMs;
  const cycleProgress = wrappedElapsedMs / durationMs;
  return cycleProgress * Math.PI * 2 + SUN_CYCLE_PHASE_OFFSET_RADIANS;
}

export function AnimatedSun({
  worldEntityManager,
  dayCycleAnchorMs,
  dayCycleDurationSeconds = DEFAULT_SUN_CYCLE_DURATION_SECONDS,
  estimatedServerTimeOffsetMs = 0,
}: {
  worldEntityManager: WorldEntityManager;
  dayCycleAnchorMs?: number | null;
  dayCycleDurationSeconds?: number;
  estimatedServerTimeOffsetMs?: number | null;
}) {
  const skyRef = useRef<ThreeSkyObject>(null);
  const lightRef = useRef<DirectionalLight>(null);
  const sunTargetRef = useRef<Object3D>(null);
  const moonRef = useRef<Mesh>(null);
  const moonHaloRef = useRef<Sprite>(null);
  const moonLightRef = useRef<DirectionalLight>(null);
  const moonTargetRef = useRef<Object3D>(null);
  const starsRef = useRef<Points>(null);
  const hemisphereRef = useRef<HemisphereLight>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const fallbackDayCycleAnchorMsRef = useRef<number | null>(null);
  const lightAnchorRef = useRef(new Vector3());
  const sunOffsetRef = useRef(new Vector3());
  const sunVisualOffsetRef = useRef(new Vector3());
  const moonOffsetRef = useRef(new Vector3());
  const moonVisualOffsetRef = useRef(new Vector3());
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
    if (starsRef.current) {
      starsRef.current.frustumCulled = false;
      starsRef.current.renderOrder = 1;
      const starsMaterial = starsRef.current.material;
      if (!Array.isArray(starsMaterial)) {
        starsMaterial.depthTest = true;
        starsMaterial.depthWrite = false;
        starsMaterial.toneMapped = false;
      }
    }
    if (skyRef.current) {
      skyRef.current.renderOrder = -10;
      skyRef.current.frustumCulled = false;
      const skyMaterial = skyRef.current.material;
      if (!Array.isArray(skyMaterial)) {
        skyMaterial.depthWrite = false;
        skyMaterial.depthTest = false;
      }
    }
  }, []);

  useFrame((state) => {
    if (fallbackDayCycleAnchorMsRef.current === null) {
      fallbackDayCycleAnchorMsRef.current = Date.now();
    }
    const cycleAnchorMs =
      dayCycleAnchorMs ?? fallbackDayCycleAnchorMsRef.current;
    const angle = getCycleAngleRadians({
      dayCycleAnchorMs: cycleAnchorMs,
      dayCycleDurationSeconds,
      estimatedServerTimeOffsetMs: estimatedServerTimeOffsetMs ?? 0,
    });
    const playerPosition = worldEntityManager.playerPosition;
    const cameraPosition = state.camera.position;
    const lightAnchor = lightAnchorRef.current.copy(playerPosition);

    const sunOffset = sunOffsetRef.current.set(
      SUN_ORBIT_RADIUS * Math.cos(angle),
      SUN_ORBIT_RADIUS * Math.sin(angle),
      SUN_ORBIT_Z_OFFSET,
    );
    const sunHeight = sunOffset.y / SUN_ORBIT_RADIUS;
    const sunLightFactor = MathUtils.smoothstep(sunHeight, -0.04, 0.08);
    const sunLightIntensityFactor = Math.pow(
      Math.max(0, sunLightFactor),
      SUN_SET_FALLOFF_POWER,
    );
    const nightFactor =
      1 -
      MathUtils.smoothstep(
        sunHeight,
        NIGHT_FACTOR_NIGHT_START_HEIGHT,
        NIGHT_FACTOR_DAY_END_HEIGHT,
      );
    const sunVisualOffset = sunVisualOffsetRef.current
      .copy(sunOffset)
      .normalize()
      .multiplyScalar(SUN_VISUAL_ORBIT_RADIUS);

    if (skyRef.current) {
      skyRef.current.position.copy(lightAnchor);
      const skyMaterial = skyRef.current.material;
      if (!Array.isArray(skyMaterial)) {
        const typedSkyMaterial = skyMaterial as SkyMaterialWithSunPosition;
        typedSkyMaterial.uniforms.sunPosition.value.set(
          sunVisualOffset.x,
          sunVisualOffset.y,
          sunVisualOffset.z,
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
        typedSkyMaterial.uniforms.sunsetFalloffPower.value =
          SUN_SET_FALLOFF_POWER;
        typedSkyMaterial.transparent = false;
        typedSkyMaterial.opacity = 1;
      }
    }

    const moonAngle = angle + Math.PI;
    const moonOffset = moonOffsetRef.current.set(
      MOON_ORBIT_RADIUS * Math.cos(moonAngle),
      MOON_ORBIT_RADIUS * Math.sin(moonAngle),
      MOON_ORBIT_Z_OFFSET,
    );
    const moonVisualOffset = moonVisualOffsetRef.current
      .copy(moonOffset)
      .normalize()
      .multiplyScalar(MOON_VISUAL_ORBIT_RADIUS);
    const sceneFog = state.scene.fog;
    blendedSkyColor.lerpColors(daySkyColor, nightSkyColor, nightFactor);
    state.scene.background = blendedSkyColor;

    if (lightRef.current) {
      lightRef.current.position.copy(lightAnchor).add(sunOffset);
      lightRef.current.target.position.copy(lightAnchor);
      lightRef.current.target.updateMatrixWorld();
      lightRef.current.intensity =
        SUN_LIGHT_DAY_INTENSITY * sunLightIntensityFactor;
      lightRef.current.castShadow =
        sunLightIntensityFactor > SUN_SHADOW_ENABLE_THRESHOLD;
    }

    if (sceneFog instanceof ThreeFog) {
      sceneFog.near = MathUtils.lerp(SKY_FOG_NEAR, NIGHT_FOG_NEAR, nightFactor);
      sceneFog.far = MathUtils.lerp(SKY_FOG_FAR, NIGHT_FOG_FAR, nightFactor);
      sceneFog.color.copy(blendedSkyColor);
    }

    if (moonRef.current) {
      moonRef.current.position.copy(cameraPosition).add(moonVisualOffset);
    }
    if (moonLightRef.current) {
      moonLightRef.current.position.copy(lightAnchor).add(moonOffset);
      moonLightRef.current.target.position.copy(lightAnchor);
      moonLightRef.current.target.updateMatrixWorld();
      const moonElevation = Math.max(0, moonOffset.y / MOON_ORBIT_RADIUS);
      moonLightRef.current.intensity =
        moonElevation * MOON_LIGHT_MAX_INTENSITY * nightFactor;
      if (moonHaloRef.current) {
        const moonGlowFactor = moonElevation * nightFactor;
        moonHaloRef.current.position.copy(cameraPosition).add(moonVisualOffset);
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
      starsRef.current.position.copy(lightAnchor);
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
      <InfiniteSky
        ref={skyRef}
        sunPosition={[8, 14, 6]}
        turbidity={0.8}
        rayleigh={0.2}
        mieCoefficient={0.0002}
        mieDirectionalG={0.999}
        distance={SKY_DOME_DISTANCE}
        inclination={0.3}
        azimuth={0.5}
        sunsetFalloffPower={SUN_SET_FALLOFF_POWER}
        cameraOffsetY={SKY_CAMERA_Y_OFFSET}
        follow="none"
      />
      <mesh ref={moonRef} position={[-80, 0, -10]}>
        <sphereGeometry args={[MOON_VISUAL_RADIUS, 32, 32]} />
        <meshBasicMaterial color="#F1F6FF" toneMapped={false} fog={false} />
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
            fog={false}
          />
        </sprite>
      ) : null}
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
