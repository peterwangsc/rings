"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import {
  RING_BOB_AMPLITUDE,
  RING_BOB_SPEED,
  RING_COLOR,
  RING_DROP_DESPAWN_FLASH_HZ,
  RING_DROP_DESPAWN_FLASH_WINDOW_MS,
  RING_DROP_DESPAWN_MIN_ALPHA,
  RING_DROP_FALL_DURATION_MS,
  RING_DROP_FALL_START_HEIGHT,
  RING_DROP_LIFETIME_MS,
  RING_DROP_SENSOR_RADIUS,
  RING_EMISSIVE_COLOR,
  RING_EMISSIVE_INTENSITY,
  RING_MAJOR_RADIUS,
  RING_METALNESS,
  RING_ROTATION_SPEED,
  RING_ROUGHNESS,
  RING_SENSOR_RADIUS,
  RING_TORUS_SEGMENTS,
  RING_TUBE_RADIUS,
  RING_TUBE_SEGMENTS,
} from "../../utils/constants";

interface RingProps {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly onCollect: (id: string) => void;
  readonly spawnedAtMs?: number;
}

export function Ring({ id, position, onCollect, spawnedAtMs }: RingProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const isExpiredRef = useRef(false);
  const canCollectRef = useRef(true);
  const isDropRing = spawnedAtMs !== undefined;
  const sensorRadius = isDropRing ? RING_DROP_SENSOR_RADIUS : RING_SENSOR_RADIUS;
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

    const dropAgeMs = spawnedAtMs === undefined ? 0 : Date.now() - spawnedAtMs;
    const fallProgress = THREE.MathUtils.clamp(
      dropAgeMs / RING_DROP_FALL_DURATION_MS,
      0,
      1,
    );
    const fallOffset =
      spawnedAtMs === undefined
        ? 0
        : (1 - fallProgress * fallProgress) * RING_DROP_FALL_START_HEIGHT;
    mesh.position.y =
      fallOffset + Math.sin(time * RING_BOB_SPEED) * RING_BOB_AMPLITUDE;

    let opacity = 1;
    let emissiveScale = 1;
    let isExpired = false;

    if (despawnAtMs !== null) {
      const remainingMs = despawnAtMs - Date.now();
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

    isExpiredRef.current = isExpired;
    canCollectRef.current = !isExpired && (!isDropRing || fallProgress >= 0.97);
    mesh.visible = !isExpired;
    material.transparent = despawnAtMs !== null || opacity < 0.999;
    material.opacity = isExpired ? 0 : opacity;
    material.emissiveIntensity = isExpired
      ? 0
      : RING_EMISSIVE_INTENSITY * emissiveScale;
  });

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[position[0], position[1], position[2]]}
      onIntersectionEnter={({ other }) => {
        if (isExpiredRef.current || !canCollectRef.current) {
          return;
        }
        if (
          (other.rigidBody?.userData as { kind?: string } | undefined)
            ?.kind === "player"
        ) {
          onCollect(id);
        }
      }}
    >
      <BallCollider args={[sensorRadius]} sensor />
      <mesh ref={meshRef} castShadow receiveShadow>
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
    </RigidBody>
  );
}
