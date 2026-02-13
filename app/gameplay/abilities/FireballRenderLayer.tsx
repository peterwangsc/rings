"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import {
  AdditiveBlending,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
} from "three";
import {
  FIREBALL_EMISSIVE_INTENSITY,
  FIREBALL_LIGHT_INTENSITY,
  FIREBALL_MAX_ACTIVE_COUNT,
  FIREBALL_RADIUS,
} from "../../utils/constants";
import type { FireballRenderFrame } from "./fireballTypes";

export function FireballRenderLayer({
  renderFrame,
}: {
  renderFrame: FireballRenderFrame;
}) {
  const groupRefs = useRef<(Group | null)[]>([]);
  const coreMaterialRefs = useRef<(MeshStandardMaterial | null)[]>([]);
  const glowMaterialRefs = useRef<(MeshBasicMaterial | null)[]>([]);
  const lightRefs = useRef<(PointLight | null)[]>([]);

  useFrame(() => {
    for (let index = 0; index < FIREBALL_MAX_ACTIVE_COUNT; index += 1) {
      const group = groupRefs.current[index];
      if (!group) {
        continue;
      }

      const slot = renderFrame.slots[index];
      if (!slot || !slot.active) {
        group.visible = false;
        continue;
      }

      group.visible = true;
      group.position.set(slot.x, slot.y, slot.z);
      group.rotation.y = slot.rotationY;
      group.scale.setScalar(slot.scale);

      const coreMaterial = coreMaterialRefs.current[index];
      if (coreMaterial) {
        coreMaterial.emissiveIntensity =
          FIREBALL_EMISSIVE_INTENSITY * slot.intensityFactor;
      }

      const glowMaterial = glowMaterialRefs.current[index];
      if (glowMaterial) {
        glowMaterial.opacity = 0.45 * slot.intensityFactor;
      }

      const light = lightRefs.current[index];
      if (light) {
        light.intensity = FIREBALL_LIGHT_INTENSITY * slot.intensityFactor;
      }
    }
  });

  return (
    <>
      {Array.from({ length: FIREBALL_MAX_ACTIVE_COUNT }, (_, index) => (
        <group
          // Slot index is stable for the renderer pool.
          key={`fireball-slot-${index}`}
          ref={(instance) => {
            groupRefs.current[index] = instance;
          }}
          visible={false}
        >
          <mesh castShadow={false} receiveShadow={false}>
            <sphereGeometry args={[FIREBALL_RADIUS, 24, 24]} />
            <meshStandardMaterial
              ref={(instance) => {
                coreMaterialRefs.current[index] = instance;
              }}
              color="#FF9A2E"
              emissive="#FF4A12"
              emissiveIntensity={FIREBALL_EMISSIVE_INTENSITY}
              roughness={0.18}
              metalness={0.06}
            />
          </mesh>
          <mesh castShadow={false} receiveShadow={false}>
            <sphereGeometry args={[FIREBALL_RADIUS * 1.45, 16, 16]} />
            <meshBasicMaterial
              ref={(instance) => {
                glowMaterialRefs.current[index] = instance;
              }}
              color="#FFCF83"
              transparent
              opacity={0.45}
              blending={AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <pointLight
            ref={(instance) => {
              lightRefs.current[index] = instance;
            }}
            color="#FF7A1A"
            intensity={FIREBALL_LIGHT_INTENSITY}
            distance={6}
            decay={2}
          />
        </group>
      ))}
    </>
  );
}
