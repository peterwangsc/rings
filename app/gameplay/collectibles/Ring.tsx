"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  RING_BOB_AMPLITUDE,
  RING_BOB_SPEED,
  RING_COLOR,
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

export function Ring({ position, spawnedAtMs }: RingProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const baseY = position[1];
  const despawnAtMs =
    spawnedAtMs === undefined ? null : spawnedAtMs + RING_DROP_LIFETIME_MS;

  useFrame((state) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
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
    material.transparent = despawnAtMs !== null || opacity < 0.999;
    material.opacity = isExpired ? 0 : opacity;
    material.emissiveIntensity = isExpired
      ? 0
      : RING_EMISSIVE_INTENSITY * emissiveScale;
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
      <meshStandardMaterial
        ref={materialRef}
        color={RING_COLOR}
        emissive={RING_EMISSIVE_COLOR}
        emissiveIntensity={RING_EMISSIVE_INTENSITY}
        roughness={RING_ROUGHNESS}
        metalness={RING_METALNESS}
      />
    </mesh>
  );
}
