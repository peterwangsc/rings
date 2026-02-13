"use client";

import { Sky, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
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
import type { Sky as SkyImpl } from "three-stdlib";
import { HORIZON_COLOR, SKY_FOG_FAR, SKY_FOG_NEAR } from "../utils/constants";

/** Full cycle in seconds - sun rises, crosses the sky, and sets. */
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

export function AnimatedSun({
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
  const angleRef = useRef(Math.PI * 0.25);
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
      skyRef.current.renderOrder = -10;
      skyRef.current.frustumCulled = false;
      const skyMaterial = skyRef.current.material;
      if (!Array.isArray(skyMaterial)) {
        skyMaterial.depthWrite = false;
      }
    }
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
  }, []);

  useFrame((state, delta) => {
    angleRef.current += (delta / SUN_CYCLE_DURATION) * Math.PI * 2;
    const angle = angleRef.current;
    const followPosition = followPositionRef.current;

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
