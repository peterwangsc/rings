"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  RING_BOB_AMPLITUDE,
  RING_BOB_SPEED,
  RING_COLOR,
  RING_ENV_MAP_INTENSITY,
  RING_LIGHT_DECAY,
  RING_LIGHT_DISTANCE,
  RING_LIGHT_INTENSITY,
  RING_DROP_DESPAWN_FLASH_HZ,
  RING_DROP_DESPAWN_FLASH_WINDOW_MS,
  RING_DROP_DESPAWN_MIN_ALPHA,
  RING_DROP_LIFETIME_MS,
  RING_EMISSIVE_COLOR,
  RING_EMISSIVE_INTENSITY,
  RING_MAJOR_RADIUS,
  RING_METALNESS,
  RING_ROTATION_SPEED,
  RING_ROUGHNESS,
  RING_TORUS_SEGMENTS,
  RING_TUBE_RADIUS,
  RING_TUBE_SEGMENTS,
} from "../../utils/constants";
import { getDropRingFallOffset } from "./ringTiming";

interface RingProps {
  readonly position: readonly [number, number, number];
  readonly spawnedAtMs?: number;
}

const RING_SHADER_CACHE_KEY = "ring-polished-reflective-v1";

export function Ring({ position, spawnedAtMs }: RingProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const baseY = position[1];
  const despawnAtMs =
    spawnedAtMs === undefined ? null : spawnedAtMs + RING_DROP_LIFETIME_MS;

  useEffect(() => {
    const material = materialRef.current;
    if (!material) {
      return;
    }

    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vRingWorldPosition;
varying vec3 vRingWorldNormal;
`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vec4 ringWorldPosition = modelMatrix * vec4(position, 1.0);
vRingWorldPosition = ringWorldPosition.xyz;
vRingWorldNormal = normalize(mat3(modelMatrix) * normal);
`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vRingWorldPosition;
varying vec3 vRingWorldNormal;

float ringSaturate(float value) {
  return clamp(value, 0.0, 1.0);
}
`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  vec3 ringNormal = normalize(vRingWorldNormal);
  vec3 ringViewDir = normalize(cameraPosition - vRingWorldPosition);
  vec3 ringReflectDir = reflect(-ringViewDir, ringNormal);

  float ringSkyMix = smoothstep(-0.2, 0.78, ringReflectDir.y);
  vec3 ringSkyColor = vec3(1.0, 0.98, 0.9);
  vec3 ringGroundColor = vec3(0.42, 0.34, 0.2);
  vec3 ringEnvColor = mix(ringGroundColor, ringSkyColor, ringSkyMix);

  float ringFresnel = pow(1.0 - ringSaturate(dot(ringNormal, ringViewDir)), 4.0);
  float ringMirrorStrength = ringSaturate(0.72 + ringFresnel * 0.48);
  diffuseColor.rgb = mix(diffuseColor.rgb, ringEnvColor * 1.45, ringMirrorStrength * 0.96);

  float ringSpecSweep = pow(
    max(dot(ringReflectDir, normalize(vec3(0.34, 1.0, 0.18))), 0.0),
    72.0
  );
  diffuseColor.rgb += vec3(1.0, 0.98, 0.92) * ringSpecSweep * 0.75;

  float ringRimBoost = pow(1.0 - ringSaturate(dot(ringNormal, ringViewDir)), 6.0);
  diffuseColor.rgb += vec3(1.0, 0.95, 0.82) * ringRimBoost * 0.28;
}
`,
        );
    };

    material.customProgramCacheKey = () => RING_SHADER_CACHE_KEY;
    material.needsUpdate = true;
  }, []);

  useFrame((state) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    const light = lightRef.current;
    if (!mesh || !material) {
      return;
    }

    const time = state.clock.getElapsedTime();
    mesh.rotation.y = time * RING_ROTATION_SPEED;

    const nowMs = Date.now();
    const fallOffset =
      spawnedAtMs === undefined ? 0 : getDropRingFallOffset(spawnedAtMs, nowMs);
    mesh.position.y =
      baseY + fallOffset + Math.sin(time * RING_BOB_SPEED) * RING_BOB_AMPLITUDE;

    let opacity = 1;
    let emissiveScale = 1;
    let isExpired = false;

    if (despawnAtMs !== null) {
      const remainingMs = despawnAtMs - nowMs;
      if (remainingMs <= 0) {
        isExpired = true;
      } else if (remainingMs <= RING_DROP_DESPAWN_FLASH_WINDOW_MS) {
        const normalizedRemaining = THREE.MathUtils.clamp(
          remainingMs / RING_DROP_DESPAWN_FLASH_WINDOW_MS,
          0,
          1,
        );
        const fadeAlpha = THREE.MathUtils.lerp(
          RING_DROP_DESPAWN_MIN_ALPHA,
          1,
          normalizedRemaining,
        );
        const flashPulse =
          Math.sin(time * Math.PI * 2 * RING_DROP_DESPAWN_FLASH_HZ) > 0
            ? 1
            : RING_DROP_DESPAWN_MIN_ALPHA;
        opacity = THREE.MathUtils.clamp(fadeAlpha * flashPulse, 0, 1);
        emissiveScale = THREE.MathUtils.lerp(0.4, 1.3, flashPulse);
      }
    }

    mesh.visible = !isExpired;
    const glowScale = isExpired ? 0 : emissiveScale * opacity;
    if (light) {
      light.visible = !isExpired;
      light.intensity = RING_LIGHT_INTENSITY * glowScale;
    }
    material.transparent = despawnAtMs !== null || opacity < 0.999;
    material.opacity = isExpired ? 0 : opacity;
    material.emissiveIntensity = RING_EMISSIVE_INTENSITY * glowScale;
  });

  return (
    <mesh
      ref={meshRef}
      position={[position[0], position[1], position[2]]}
      castShadow
      receiveShadow
    >
      <torusGeometry
        args={[
          RING_MAJOR_RADIUS,
          RING_TUBE_RADIUS,
          RING_TUBE_SEGMENTS,
          RING_TORUS_SEGMENTS,
        ]}
      />
      <meshPhysicalMaterial
        ref={materialRef}
        color={RING_COLOR}
        emissive={RING_EMISSIVE_COLOR}
        emissiveIntensity={RING_EMISSIVE_INTENSITY}
        roughness={RING_ROUGHNESS}
        metalness={RING_METALNESS}
        envMapIntensity={RING_ENV_MAP_INTENSITY}
      />
      <pointLight
        ref={lightRef}
        color={RING_EMISSIVE_COLOR}
        intensity={RING_LIGHT_INTENSITY}
        distance={RING_LIGHT_DISTANCE}
        decay={RING_LIGHT_DECAY}
      />
    </mesh>
  );
}
