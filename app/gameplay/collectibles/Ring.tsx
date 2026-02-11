"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import {
  RING_BOB_AMPLITUDE,
  RING_BOB_SPEED,
  RING_COLOR,
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
}

export function Ring({ id, position, onCollect }: RingProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const time = state.clock.getElapsedTime();
    mesh.rotation.y = time * RING_ROTATION_SPEED;
    mesh.position.y = Math.sin(time * RING_BOB_SPEED) * RING_BOB_AMPLITUDE;
  });

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[position[0], position[1], position[2]]}
      onIntersectionEnter={({ other }) => {
        if (other.rigidBody?.isDynamic()) {
          onCollect(id);
        }
      }}
    >
      <BallCollider args={[RING_SENSOR_RADIUS]} sensor />
      <mesh ref={meshRef}>
        <torusGeometry
          args={[
            RING_MAJOR_RADIUS,
            RING_TUBE_RADIUS,
            RING_TUBE_SEGMENTS,
            RING_TORUS_SEGMENTS,
          ]}
        />
        <meshStandardMaterial
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
