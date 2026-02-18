"use client";

import { Cloud } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MysteryBoxState } from "../../multiplayer/state/multiplayerTypes";
import {
  MYSTERY_BOX_HALF_EXTENT,
  MYSTERY_BOX_INTERACT_DISABLED_STATE,
} from "../../utils/constants";

const BOX_SIZE = MYSTERY_BOX_HALF_EXTENT * 2;
const POSITION_SMOOTHNESS = 18;
const FLOAT_AMPLITUDE = 0.08;
const FLOAT_SPEED = 2.25;
const SPIN_SPEED = 1.5;
const DEPLETION_BUMP_DURATION_SECONDS = 0.15;
const DEPLETION_BUMP_HEIGHT = 0.16;
const DEPLETION_POOF_DURATION_SECONDS = 0.46;
const DEPLETION_POOF_START_SCALE = 0.16;
const DEPLETION_POOF_END_SCALE = 0.95;
const DEPLETION_POOF_BASE_OPACITY = 0.62;
const DEPLETION_POOF_RISE_DISTANCE = 0.24;
const DEPLETION_POOF_Y_OFFSET = 0.1;

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function setObjectOpacity(root: THREE.Object3D, opacity: number) {
  const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);

  root.traverse((object) => {
    const materialCandidate = (object as THREE.Mesh).material;
    if (!materialCandidate) {
      return;
    }

    const applyOpacity = (material: THREE.Material) => {
      material.transparent = true;
      material.opacity = clampedOpacity;
    };

    if (Array.isArray(materialCandidate)) {
      for (const material of materialCandidate) {
        applyOpacity(material);
      }
      return;
    }

    applyOpacity(materialCandidate);
  });
}

function createQuestionMarkTexture() {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = "#F6A41F";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#8E4A00";
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  context.fillStyle = "#FFF2A6";
  context.font = "bold 92px 'Trebuchet MS', 'Arial Black', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = "#7A3A00";
  context.lineWidth = 10;
  context.strokeText("?", 64, 55);
  context.fillText("?", 64, 55);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function MysteryBoxActor({
  mysteryBox,
  geometry,
  material,
}: {
  mysteryBox: MysteryBoxState;
  geometry: THREE.BoxGeometry;
  material: THREE.MeshStandardMaterial;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const boxRef = useRef<THREE.Mesh>(null);
  const poofRef = useRef<THREE.Group>(null);
  const targetPositionRef = useRef(
    new THREE.Vector3(mysteryBox.x, mysteryBox.y, mysteryBox.z),
  );
  const wasDepletedRef = useRef(
    mysteryBox.state === MYSTERY_BOX_INTERACT_DISABLED_STATE,
  );
  const depletedAtSecondsRef = useRef<number | null>(null);
  const phaseRef = useRef(
    ((hashStringToUint32(mysteryBox.mysteryBoxId) % 360) * Math.PI) / 180,
  );

  useEffect(() => {
    targetPositionRef.current.set(mysteryBox.x, mysteryBox.y, mysteryBox.z);
  }, [mysteryBox.x, mysteryBox.y, mysteryBox.z]);

  useEffect(() => {
    const poof = poofRef.current;
    if (!poof) {
      return;
    }
    poof.visible = false;
    poof.scale.setScalar(DEPLETION_POOF_START_SCALE);
    setObjectOpacity(poof, DEPLETION_POOF_BASE_OPACITY);
  }, []);

  useFrame((state, deltaSeconds) => {
    const root = rootRef.current;
    const box = boxRef.current;
    if (!root || !box) {
      return;
    }
    const poof = poofRef.current;

    const nowSeconds = state.clock.getElapsedTime();
    const isDepleted = mysteryBox.state === MYSTERY_BOX_INTERACT_DISABLED_STATE;
    const positionBlend = 1 - Math.exp(-POSITION_SMOOTHNESS * deltaSeconds);
    root.position.lerp(targetPositionRef.current, positionBlend);

    if (!isDepleted) {
      if (wasDepletedRef.current) {
        wasDepletedRef.current = false;
        depletedAtSecondsRef.current = null;
      }

      box.visible = true;
      box.scale.set(1, 1, 1);
      box.position.set(
        0,
        Math.sin(nowSeconds * FLOAT_SPEED + phaseRef.current) * FLOAT_AMPLITUDE,
        0,
      );
      box.rotation.set(0, nowSeconds * SPIN_SPEED + phaseRef.current, 0);
      if (poof) {
        poof.visible = false;
      }
      return;
    }

    if (!wasDepletedRef.current || depletedAtSecondsRef.current === null) {
      wasDepletedRef.current = true;
      depletedAtSecondsRef.current = nowSeconds;
    }

    const depletedAt = depletedAtSecondsRef.current;
    const elapsed = Math.max(0, nowSeconds - depletedAt);
    const bumpProgress = THREE.MathUtils.clamp(
      elapsed / DEPLETION_BUMP_DURATION_SECONDS,
      0,
      1,
    );
    const easedBump = 1 - (1 - bumpProgress) * (1 - bumpProgress);
    const poofProgress = THREE.MathUtils.clamp(
      elapsed / DEPLETION_POOF_DURATION_SECONDS,
      0,
      1,
    );

    box.visible = elapsed < DEPLETION_BUMP_DURATION_SECONDS;
    if (box.visible) {
      box.position.set(0, easedBump * DEPLETION_BUMP_HEIGHT, 0);
      box.rotation.set(0, phaseRef.current, 0);
      box.scale.set(
        THREE.MathUtils.lerp(1, 1.08, easedBump),
        THREE.MathUtils.lerp(1, 0.64, easedBump),
        THREE.MathUtils.lerp(1, 1.08, easedBump),
      );
    }

    if (!poof) {
      return;
    }
    if (elapsed >= DEPLETION_POOF_DURATION_SECONDS) {
      poof.visible = false;
      return;
    }

    const easedPoof = 1 - Math.pow(1 - poofProgress, 2);
    poof.visible = true;
    poof.position.set(
      0,
      DEPLETION_POOF_Y_OFFSET + DEPLETION_POOF_RISE_DISTANCE * poofProgress,
      0,
    );
    poof.scale.setScalar(
      THREE.MathUtils.lerp(
        DEPLETION_POOF_START_SCALE,
        DEPLETION_POOF_END_SCALE,
        easedPoof,
      ),
    );
    setObjectOpacity(poof, DEPLETION_POOF_BASE_OPACITY * (1 - poofProgress));
  });

  return (
    <group ref={rootRef} position={[mysteryBox.x, mysteryBox.y, mysteryBox.z]}>
      <mesh
        ref={boxRef}
        castShadow
        receiveShadow
        geometry={geometry}
        material={material}
      />
      <group
        ref={poofRef}
        visible={false}
        position={[0, DEPLETION_POOF_Y_OFFSET, 0]}
        scale={DEPLETION_POOF_START_SCALE}
      >
        <Cloud
          position={[0, 0, 0]}
          speed={0}
          opacity={1}
          bounds={[0.75, 0.42, 0.2]}
          segments={14}
        />
      </group>
    </group>
  );
}

export function MysteryBoxLayer({
  mysteryBoxes,
}: {
  mysteryBoxes: readonly MysteryBoxState[];
}) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE),
    [],
  );
  const questionMarkTexture = useMemo(() => createQuestionMarkTexture(), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#F6A41F",
        emissive: "#B26000",
        emissiveIntensity: 0.58,
        metalness: 0.2,
        roughness: 0.42,
        map: questionMarkTexture ?? undefined,
      }),
    [questionMarkTexture],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      questionMarkTexture?.dispose();
    };
  }, [geometry, material, questionMarkTexture]);

  return (
    <group>
      {mysteryBoxes.map((mysteryBox) => (
        <MysteryBoxActor
          key={mysteryBox.mysteryBoxId}
          mysteryBox={mysteryBox}
          geometry={geometry}
          material={material}
        />
      ))}
    </group>
  );
}
