"use client";

import {
  CuboidCollider,
  RigidBody,
  type IntersectionEnterPayload,
} from "@react-three/rapier";
import { Cloud } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MysteryBoxState } from "../../multiplayer/state/multiplayerTypes";
import {
  MYSTERY_BOX_HALF_EXTENT,
  MYSTERY_BOX_INTERACT_DISABLED_STATE,
} from "../../utils/constants";

const BOX_SIZE = MYSTERY_BOX_HALF_EXTENT * 2;
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
const BOX_GLOW_COLOR = "#FFBE6B";
const BOX_GLOW_INTENSITY = 4.58;
const BOX_GLOW_DISTANCE = 4.2;
const BOX_GLOW_DECAY = 2;
const UNDERSIDE_SENSOR_HALF_HEIGHT = 0.07;
const UNDERSIDE_SENSOR_INSET = 0.03;
const UNDERSIDE_SENSOR_HALF_EXTENT =
  MYSTERY_BOX_HALF_EXTENT - UNDERSIDE_SENSOR_INSET;
const LOCAL_HIT_RETRY_COOLDOWN_MS = 120;
const LOCAL_SENSOR_MIN_UPWARD_VELOCITY = 0.1;

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function collectMaterials(root: THREE.Object3D) {
  const materials: THREE.Material[] = [];
  root.traverse((object) => {
    const materialCandidate = (object as THREE.Mesh).material;
    if (!materialCandidate) {
      return;
    }
    if (Array.isArray(materialCandidate)) {
      materials.push(...materialCandidate);
      return;
    }
    materials.push(materialCandidate);
  });
  return materials;
}

function setMaterialsOpacity(materials: readonly THREE.Material[], opacity: number) {
  const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);

  for (let index = 0; index < materials.length; index += 1) {
    const material = materials[index];
    material.transparent = true;
    material.opacity = clampedOpacity;
  }
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
  context.font = "bold 82px 'Trebuchet MS', 'Arial Black', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = "#7A3A00";
  context.lineWidth = 9;
  const questionMark = "?";
  const metrics = context.measureText(questionMark);
  const centeredY =
    metrics.actualBoundingBoxAscent > 0 || metrics.actualBoundingBoxDescent > 0
      ? canvas.height / 2 +
        (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
      : canvas.height / 2;
  context.strokeText(questionMark, canvas.width / 2, centeredY);
  context.fillText(questionMark, canvas.width / 2, centeredY);

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
  onLocalMysteryBoxHit,
}: {
  mysteryBox: MysteryBoxState;
  geometry: THREE.BoxGeometry;
  material: THREE.MeshStandardMaterial;
  onLocalMysteryBoxHit?: (mysteryBoxId: string) => void;
}) {
  const boxRef = useRef<THREE.Mesh>(null);
  const poofRef = useRef<THREE.Group>(null);
  const poofMaterialsRef = useRef<THREE.Material[]>([]);
  const poofOpacityRef = useRef(DEPLETION_POOF_BASE_OPACITY);
  const wasDepletedRef = useRef(
    mysteryBox.state === MYSTERY_BOX_INTERACT_DISABLED_STATE,
  );
  const depletedAtSecondsRef = useRef<number | null>(null);
  const phaseRef = useRef(
    ((hashStringToUint32(mysteryBox.mysteryBoxId) % 360) * Math.PI) / 180,
  );
  const lastLocalHitAtMsRef = useRef(-Infinity);

  useEffect(() => {
    const poof = poofRef.current;
    if (!poof) {
      return;
    }
    poof.visible = false;
    poof.scale.setScalar(DEPLETION_POOF_START_SCALE);
    const poofMaterials = collectMaterials(poof);
    poofMaterialsRef.current = poofMaterials;
    poofOpacityRef.current = DEPLETION_POOF_BASE_OPACITY;
    setMaterialsOpacity(poofMaterials, DEPLETION_POOF_BASE_OPACITY);
    return () => {
      poofMaterialsRef.current = [];
    };
  }, []);

  useFrame((state) => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const poof = poofRef.current;

    const nowSeconds = state.clock.getElapsedTime();
    const isDepleted = mysteryBox.state === MYSTERY_BOX_INTERACT_DISABLED_STATE;

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
    const nextPoofOpacity = DEPLETION_POOF_BASE_OPACITY * (1 - poofProgress);
    if (Math.abs(nextPoofOpacity - poofOpacityRef.current) < 0.001) {
      return;
    }
    poofOpacityRef.current = nextPoofOpacity;
    setMaterialsOpacity(poofMaterialsRef.current, nextPoofOpacity);
  });

  const hasSolidCollider =
    mysteryBox.state !== MYSTERY_BOX_INTERACT_DISABLED_STATE;

  const handleUndersideIntersection = useCallback(
    (payload: IntersectionEnterPayload) => {
      if (!hasSolidCollider || !onLocalMysteryBoxHit) {
        return;
      }
      const nowMs = performance.now();
      if (nowMs - lastLocalHitAtMsRef.current < LOCAL_HIT_RETRY_COOLDOWN_MS) {
        return;
      }

      const otherUserData = payload.other.rigidBodyObject?.userData as
        | { kind?: string }
        | undefined;
      if (otherUserData?.kind !== "player") {
        return;
      }

      const upwardVelocity = payload.other.rigidBody?.linvel().y ?? 0;
      if (upwardVelocity < LOCAL_SENSOR_MIN_UPWARD_VELOCITY) {
        return;
      }

      lastLocalHitAtMsRef.current = nowMs;
      onLocalMysteryBoxHit(mysteryBox.mysteryBoxId);
    },
    [hasSolidCollider, mysteryBox.mysteryBoxId, onLocalMysteryBoxHit],
  );

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[mysteryBox.x, mysteryBox.y, mysteryBox.z]}
      userData={{ kind: "mystery_box" }}
    >
      {hasSolidCollider ? (
        <>
          <CuboidCollider
            args={[
              MYSTERY_BOX_HALF_EXTENT,
              MYSTERY_BOX_HALF_EXTENT,
              MYSTERY_BOX_HALF_EXTENT,
            ]}
          />
          <CuboidCollider
            sensor
            position={[
              0,
              -(MYSTERY_BOX_HALF_EXTENT + UNDERSIDE_SENSOR_HALF_HEIGHT),
              0,
            ]}
            args={[
              UNDERSIDE_SENSOR_HALF_EXTENT,
              UNDERSIDE_SENSOR_HALF_HEIGHT,
              UNDERSIDE_SENSOR_HALF_EXTENT,
            ]}
            onIntersectionEnter={handleUndersideIntersection}
          />
        </>
      ) : null}
      <group>
        <mesh
          ref={boxRef}
          castShadow
          receiveShadow
          geometry={geometry}
          material={material}
        />
        {hasSolidCollider ? (
          <pointLight
            color={BOX_GLOW_COLOR}
            intensity={BOX_GLOW_INTENSITY}
            distance={BOX_GLOW_DISTANCE}
            decay={BOX_GLOW_DECAY}
            position={[0, 0, 0]}
          />
        ) : null}
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
    </RigidBody>
  );
}

export function MysteryBoxLayer({
  mysteryBoxes,
  onLocalMysteryBoxHit,
}: {
  mysteryBoxes: readonly MysteryBoxState[];
  onLocalMysteryBoxHit?: (mysteryBoxId: string) => void;
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
          onLocalMysteryBoxHit={onLocalMysteryBoxHit}
        />
      ))}
    </group>
  );
}
