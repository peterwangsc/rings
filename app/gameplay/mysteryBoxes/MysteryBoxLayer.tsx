"use client";

import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
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

function createQuestionMarkTextures() {
  if (typeof document === "undefined") {
    return null;
  }

  const W = 128;
  const H = 128;

  // Color texture: orange box with white border and white ?
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = W;
  colorCanvas.height = H;
  const colorCtx = colorCanvas.getContext("2d");
  if (!colorCtx) return null;
  colorCtx.fillStyle = "#F6A41F";
  colorCtx.fillRect(0, 0, W, H);
  colorCtx.strokeStyle = "#8E4A00";
  colorCtx.lineWidth = 8;
  colorCtx.strokeRect(4, 4, W - 8, H - 8);
  // Draw the white ? on top of the orange background (no background fill)
  colorCtx.fillStyle = "#FFFFFF";
  colorCtx.strokeStyle = "#FFFFFF";
  colorCtx.font = "bold 82px 'Trebuchet MS', 'Arial Black', sans-serif";
  colorCtx.textAlign = "center";
  colorCtx.textBaseline = "middle";
  colorCtx.lineWidth = 4;
  {
    const questionMark = "?";
    const metrics = colorCtx.measureText(questionMark);
    const centeredY =
      metrics.actualBoundingBoxAscent > 0 || metrics.actualBoundingBoxDescent > 0
        ? H / 2 +
          (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
        : H / 2;
    colorCtx.strokeText(questionMark, W / 2, centeredY);
    colorCtx.fillText(questionMark, W / 2, centeredY);
  }

  // Emissive map: golden-orange background (matching box glow), white ? for glow boost
  // Three.js multiplies emissive color * emissiveMap, so we set emissive=#FFFFFF
  // and encode all color in the map: orange for the body, white for the ?
  const emissiveCanvas = document.createElement("canvas");
  emissiveCanvas.width = W;
  emissiveCanvas.height = H;
  const emissiveCtx = emissiveCanvas.getContext("2d");
  if (!emissiveCtx) return null;
  // Fill with the golden-orange glow color of the box body
  emissiveCtx.fillStyle = "#B26000";
  emissiveCtx.fillRect(0, 0, W, H);
  // Draw white ? on top so it glows bright white
  emissiveCtx.fillStyle = "#FFFFFF";
  emissiveCtx.strokeStyle = "#FFFFFF";
  emissiveCtx.font = "bold 82px 'Trebuchet MS', 'Arial Black', sans-serif";
  emissiveCtx.textAlign = "center";
  emissiveCtx.textBaseline = "middle";
  emissiveCtx.lineWidth = 4;
  {
    const questionMark = "?";
    const metrics = emissiveCtx.measureText(questionMark);
    const centeredY =
      metrics.actualBoundingBoxAscent > 0 || metrics.actualBoundingBoxDescent > 0
        ? H / 2 +
          (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
        : H / 2;
    emissiveCtx.strokeText(questionMark, W / 2, centeredY);
    emissiveCtx.fillText(questionMark, W / 2, centeredY);
  }

  function makeTexture(canvas: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  return { color: makeTexture(colorCanvas), emissive: makeTexture(emissiveCanvas) };
}

// Reusable translation vector to avoid per-frame allocation
const _kinematicTranslation = new THREE.Vector3();

function MysteryBoxActor({
  mysteryBox,
  geometry,
  material,
}: {
  mysteryBox: MysteryBoxState;
  geometry: THREE.BoxGeometry;
  material: THREE.MeshStandardMaterial;
}) {
  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);
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
    const rigidBody = rigidBodyRef.current;
    const mesh = meshRef.current;
    if (!rigidBody || !mesh) {
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

      // Drive kinematic body to match float animation — physics and visual stay in sync
      const floatY =
        Math.sin(nowSeconds * FLOAT_SPEED + phaseRef.current) * FLOAT_AMPLITUDE;
      _kinematicTranslation.set(mysteryBox.x, mysteryBox.y + floatY, mysteryBox.z);
      rigidBody.setNextKinematicTranslation(_kinematicTranslation);

      mesh.visible = true;
      mesh.scale.set(1, 1, 1);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, nowSeconds * SPIN_SPEED + phaseRef.current, 0);

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

    // Move kinematic body to depleted spawn Y (no float) so collider is still accurate
    _kinematicTranslation.set(mysteryBox.x, mysteryBox.y, mysteryBox.z);
    rigidBody.setNextKinematicTranslation(_kinematicTranslation);

    mesh.visible = elapsed < DEPLETION_BUMP_DURATION_SECONDS;
    if (mesh.visible) {
      mesh.position.set(0, easedBump * DEPLETION_BUMP_HEIGHT, 0);
      mesh.rotation.set(0, phaseRef.current, 0);
      mesh.scale.set(
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

  return (
    <RigidBody
      ref={rigidBodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[mysteryBox.x, mysteryBox.y, mysteryBox.z]}
      userData={{ kind: "mystery_box" }}
    >
      {hasSolidCollider ? (
        <CuboidCollider
          args={[
            MYSTERY_BOX_HALF_EXTENT,
            MYSTERY_BOX_HALF_EXTENT,
            MYSTERY_BOX_HALF_EXTENT,
          ]}
        />
      ) : null}
      <group>
        <mesh
          ref={meshRef}
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
}: {
  mysteryBoxes: readonly MysteryBoxState[];
}) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE),
    [],
  );
  const questionMarkTextures = useMemo(() => createQuestionMarkTextures(), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#F6A41F",
        emissive: "#FFFFFF",
        emissiveIntensity: 0.58,
        emissiveMap: questionMarkTextures?.emissive ?? undefined,
        metalness: 0.2,
        roughness: 0.42,
        map: questionMarkTextures?.color ?? undefined,
      }),
    [questionMarkTextures],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      questionMarkTextures?.color.dispose();
      questionMarkTextures?.emissive.dispose();
    };
  }, [geometry, material, questionMarkTextures]);

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
