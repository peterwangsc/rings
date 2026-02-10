"use client";

import { Physics } from "@react-three/rapier";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sky, Clouds, Cloud, Stars } from "@react-three/drei";
import {
  Suspense,
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
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
} from "three";
import type { Sky as SkyImpl } from "three-stdlib";
import type { CameraMode } from "../camera/cameraTypes";
import { CharacterRigController } from "../controller/CharacterRigController";
import {
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
/** Moon orbits at the same radius, opposite the sun. */
const MOON_ORBIT_RADIUS = 80;
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

function AnimatedSun() {
  const skyRef = useRef<SkyImpl>(null);
  const lightRef = useRef<DirectionalLight>(null);
  const moonRef = useRef<Mesh>(null);
  const moonHaloRef = useRef<Sprite>(null);
  const moonLightRef = useRef<DirectionalLight>(null);
  const starsRef = useRef<Points>(null);
  const hemisphereRef = useRef<HemisphereLight>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const angleRef = useRef(Math.PI * 0.25); // start mid-morning
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

    // Sun position
    const sx = SUN_ORBIT_RADIUS * Math.cos(angle);
    const sy = SUN_ORBIT_RADIUS * Math.sin(angle);
    const sz = 6;
    const sunHeight = sy / SUN_ORBIT_RADIUS;
    const sunLightFactor = MathUtils.smoothstep(sunHeight, -0.04, 0.08);
    const nightFactor = MathUtils.clamp((-sunHeight - 0.08) / 0.42, 0, 1);

    if (skyRef.current) {
      const skyMaterial = skyRef.current.material;
      if (!Array.isArray(skyMaterial)) {
        const typedSkyMaterial = skyMaterial as SkyMaterialWithSunPosition;
        typedSkyMaterial.uniforms.sunPosition.value.set(sx, sy, sz);
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
    const mx = MOON_ORBIT_RADIUS * Math.cos(moonAngle);
    const my = MOON_ORBIT_RADIUS * Math.sin(moonAngle);
    const mz = -10;
    const sceneFog = state.scene.fog;
    blendedSkyColor.lerpColors(daySkyColor, nightSkyColor, nightFactor);
    state.scene.background = blendedSkyColor;

    if (lightRef.current) {
      lightRef.current.position.set(sx, sy, sz);
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
      moonRef.current.position.set(mx, my, mz);
    }
    if (moonLightRef.current) {
      moonLightRef.current.position.set(mx, my, mz);
      // Fade moonlight in when moon is above horizon, out when below
      const moonElevation = Math.max(0, my / MOON_ORBIT_RADIUS);
      moonLightRef.current.intensity = moonElevation * 0.3 * nightFactor;
      if (moonHaloRef.current) {
        const moonGlowFactor = moonElevation * nightFactor;
        moonHaloRef.current.position.set(mx, my, mz);
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

const CAMERA_MODE_CYCLE: readonly CameraMode[] = [
  "third_person",
  "first_person",
  "third_person_free_look",
];

export function CharacterRigScene() {
  const [cameraMode, setCameraMode] = useState<CameraMode>("third_person");
  const [isWalkDefault, setIsWalkDefault] = useState(false);

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
        className="h-full w-full"
      >
        <AnimatedSun />
        <fog attach="fog" args={[HORIZON_COLOR, SKY_FOG_NEAR, SKY_FOG_FAR]} />
        <Clouds
          material={MeshBasicMaterial}
          frustumCulled={false}
          renderOrder={0}
        >
          <Cloud
            position={[-10, 25, -20]}
            speed={0.2}
            opacity={0.6}
            width={12}
            depth={3}
            segments={8}
          />
          <Cloud
            position={[15, 30, -30]}
            speed={0.15}
            opacity={0.5}
            width={16}
            depth={4}
            segments={10}
          />
          <Cloud
            position={[0, 28, -40]}
            speed={0.1}
            opacity={0.4}
            width={20}
            depth={5}
            segments={12}
          />
          <Cloud
            position={[-20, 32, -10]}
            speed={0.25}
            opacity={0.5}
            width={10}
            depth={3}
            segments={6}
          />
          <Cloud
            position={[25, 27, -15]}
            speed={0.18}
            opacity={0.45}
            width={14}
            depth={4}
            segments={9}
          />
        </Clouds>
        <Physics gravity={[0, WORLD_GRAVITY_Y, 0]}>
          <WorldGeometry />
          <Suspense fallback={null}>
            <CharacterRigController
              cameraMode={cameraMode}
              onToggleCameraMode={handleToggleCameraMode}
              isWalkDefault={isWalkDefault}
              onToggleDefaultGait={handleToggleDefaultGait}
            />
          </Suspense>
        </Physics>
      </Canvas>
    </div>
  );
}
