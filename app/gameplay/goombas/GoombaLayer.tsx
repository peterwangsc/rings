"use client";

import { Cloud } from "@react-three/drei";
import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GoombaState } from "../../multiplayer/state/multiplayerTypes";
import {
  GOOMBA_INTERACT_DISABLED_STATE,
  GOOMBA_MODEL_PATH,
  GOOMBA_MODEL_SCALE,
} from "../../utils/constants";

const POSITION_SMOOTHNESS = 14;
const YAW_SMOOTHNESS = 16;
const MODEL_FORWARD_YAW_OFFSET = Math.PI;

const BLINK_INTERVAL_MIN_SECONDS = 2.2;
const BLINK_INTERVAL_MAX_SECONDS = 4.8;
const BLINK_DURATION_MIN_SECONDS = 0.06;
const BLINK_DURATION_MAX_SECONDS = 0.14;
const CHARGE_BLINK_HZ = 5.5;

const DEATH_SQUISH_DURATION_SECONDS = 0.18;
const DEATH_SQUASH_XZ_SCALE = 1.24;
const DEATH_SQUASH_Y_SCALE = 0.28;
const DEATH_POOF_DURATION_SECONDS = 0.48;
const DEATH_POOF_START_SCALE = 0.16;
const DEATH_POOF_END_SCALE = 0.9;
const DEATH_POOF_BASE_OPACITY = 0.58;
const DEATH_POOF_RISE_DISTANCE = 0.22;
const DEATH_POOF_Y_OFFSET = 0.38;

const DAMAGE_EYE_NAME_PATTERN = /damageeye/i;
const WALK_CYCLE_MIN_HZ = 1.55;
const WALK_CYCLE_MAX_HZ = 3.1;
const WALK_SPEED_FOR_MAX_CYCLE = 6;
const WALK_SPEED_SMOOTHNESS = 15;
const WALK_PHASE_OFFSET = Math.PI;
const FOOT_SWING_RADIANS = 0.72;
const TOE_SWING_RADIANS = 0.42;
const PELVIS_SWAY_RADIANS = 0.2;
const HEAD_COUNTER_RADIANS = 0.11;
const FOOT_LIFT_Y = 0.08;
const FOOT_STRIDE_Z = 0.08;
const PELVIS_BOB_Y = 0.04;
const PELVIS_SHIFT_Z = 0.035;
const BODY_LEAN_RADIANS = 0.12;

const UNIT_X = new THREE.Vector3(1, 0, 0);
const UNIT_Z = new THREE.Vector3(0, 0, 1);

type JointPose = {
  readonly node: THREE.Object3D;
  readonly rest: THREE.Quaternion;
  readonly restPosition: THREE.Vector3;
};

type GoombaRig = {
  readonly damageEyes: readonly THREE.Object3D[];
  readonly pelvis: JointPose | null;
  readonly leftFoot: JointPose | null;
  readonly rightFoot: JointPose | null;
  readonly leftToeBase: JointPose | null;
  readonly rightToeBase: JointPose | null;
  readonly head: JointPose | null;
};

type BoneLookup = {
  readonly nameMap: Map<string, THREE.Object3D>;
  readonly skeletonBones: readonly THREE.Bone[];
};

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toBoneLookup(root: THREE.Object3D): BoneLookup {
  const nameMap = new Map<string, THREE.Object3D>();
  const skeletonBones: THREE.Bone[] = [];

  root.traverse((object) => {
    if (typeof object.name === "string" && object.name) {
      nameMap.set(object.name.toLowerCase(), object);
    }

    const skinned = object as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh || !skinned.skeleton) {
      return;
    }
    for (const bone of skinned.skeleton.bones) {
      if (bone && !skeletonBones.includes(bone)) {
        skeletonBones.push(bone);
        if (bone.name) {
          nameMap.set(bone.name.toLowerCase(), bone);
        }
      }
    }
  });

  return { nameMap, skeletonBones };
}

function resolveJointPose(
  lookup: BoneLookup,
  names: readonly string[],
  skeletonIndex: number,
): JointPose | null {
  for (const name of names) {
    const found = lookup.nameMap.get(name.toLowerCase());
    if (found) {
      return {
        node: found,
        rest: found.quaternion.clone(),
        restPosition: found.position.clone(),
      };
    }
  }

  const fallbackBone = lookup.skeletonBones[skeletonIndex];
  if (fallbackBone) {
    return {
      node: fallbackBone,
      rest: fallbackBone.quaternion.clone(),
      restPosition: fallbackBone.position.clone(),
    };
  }

  return null;
}

function buildGoombaRig(root: THREE.Object3D): GoombaRig {
  const damageEyes: THREE.Object3D[] = [];
  const lookup = toBoneLookup(root);

  root.traverse((object) => {
    const rawName = typeof object.name === "string" ? object.name : "";
    if (!rawName) {
      return;
    }

    if (DAMAGE_EYE_NAME_PATTERN.test(rawName)) {
      damageEyes.push(object);
    }
  });

  const pelvis = resolveJointPose(lookup, ["Pelvis", "joint0"], 0);
  const leftFoot = resolveJointPose(lookup, ["LeftFoot", "joint1"], 1);
  const leftToeBase = resolveJointPose(lookup, ["LeftToeBase", "joint2"], 2);
  const rightFoot = resolveJointPose(lookup, ["RightFoot", "joint3"], 3);
  const rightToeBase = resolveJointPose(lookup, ["RightToeBase", "joint4"], 4);
  const head = resolveJointPose(lookup, ["Head", "joint6"], 6);

  return {
    damageEyes,
    pelvis,
    leftFoot,
    rightFoot,
    leftToeBase,
    rightToeBase,
    head,
  };
}

function setDamageEyesVisible(rig: GoombaRig, visible: boolean) {
  for (const eyeNode of rig.damageEyes) {
    eyeNode.visible = visible;
  }
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

function lerpAngle(current: number, target: number, alpha: number) {
  const delta = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  return current + delta * alpha;
}

function applyJointPitch(
  joint: JointPose | null,
  radians: number,
  scratch: THREE.Quaternion,
) {
  if (!joint) {
    return;
  }
  scratch.setFromAxisAngle(UNIT_X, radians);
  joint.node.quaternion.copy(joint.rest).multiply(scratch);
}

function applyJointRoll(
  joint: JointPose | null,
  radians: number,
  scratch: THREE.Quaternion,
) {
  if (!joint) {
    return;
  }
  scratch.setFromAxisAngle(UNIT_Z, radians);
  joint.node.quaternion.copy(joint.rest).multiply(scratch);
}

function applyJointLocalOffset(
  joint: JointPose | null,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
) {
  if (!joint) {
    return;
  }
  joint.node.position.set(
    joint.restPosition.x + offsetX,
    joint.restPosition.y + offsetY,
    joint.restPosition.z + offsetZ,
  );
}

function applyWalkPose(
  rig: GoombaRig,
  normalizedSpeed: number,
  phase: number,
  scratchA: THREE.Quaternion,
  scratchB: THREE.Quaternion,
) {
  const speed = THREE.MathUtils.clamp(normalizedSpeed, 0, 1);
  const swing = Math.sin(phase) * speed;
  const oppositeSwing = Math.sin(phase + WALK_PHASE_OFFSET) * speed;
  const leftLift = Math.max(0, Math.sin(phase)) * speed;
  const rightLift = Math.max(0, Math.sin(phase + WALK_PHASE_OFFSET)) * speed;
  const bobWave = Math.cos(phase * 2) * speed;

  applyJointPitch(rig.leftFoot, FOOT_SWING_RADIANS * swing, scratchA);
  applyJointPitch(rig.rightFoot, FOOT_SWING_RADIANS * oppositeSwing, scratchA);

  applyJointPitch(rig.leftToeBase, -TOE_SWING_RADIANS * swing, scratchA);
  applyJointPitch(
    rig.rightToeBase,
    -TOE_SWING_RADIANS * oppositeSwing,
    scratchA,
  );

  applyJointRoll(
    rig.pelvis,
    PELVIS_SWAY_RADIANS * Math.sin(phase + Math.PI * 0.5) * speed,
    scratchB,
  );
  applyJointPitch(
    rig.head,
    HEAD_COUNTER_RADIANS * Math.sin(phase + Math.PI * 0.5) * speed,
    scratchA,
  );
  applyJointLocalOffset(
    rig.leftFoot,
    0,
    FOOT_LIFT_Y * leftLift,
    FOOT_STRIDE_Z * swing,
  );
  applyJointLocalOffset(
    rig.rightFoot,
    0,
    FOOT_LIFT_Y * rightLift,
    FOOT_STRIDE_Z * oppositeSwing,
  );
  applyJointLocalOffset(
    rig.pelvis,
    0,
    PELVIS_BOB_Y * bobWave,
    PELVIS_SHIFT_Z * Math.sin(phase + Math.PI * 0.5) * speed,
  );
  applyJointPitch(rig.pelvis, -BODY_LEAN_RADIANS * speed, scratchA);
  applyJointLocalOffset(rig.leftToeBase, 0, 0, FOOT_STRIDE_Z * 0.35 * swing);
  applyJointLocalOffset(
    rig.rightToeBase,
    0,
    0,
    FOOT_STRIDE_Z * 0.35 * oppositeSwing,
  );
}

function GoombaActor({ goomba }: { goomba: GoombaState }) {
  const rootRef = useRef<THREE.Group>(null);
  const poofRef = useRef<THREE.Group>(null);

  const targetPositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const fallbackYawRef = useRef(goomba.yaw);

  const isDamageEyeVisibleRef = useRef(false);
  const blinkRandomStateRef = useRef(hashStringToUint32(goomba.goombaId) || 1);
  const blinkEndsAtSecondsRef = useRef(0);
  const nextBlinkAtSecondsRef = useRef<number | null>(null);

  const wasDefeatedRef = useRef(
    goomba.state === GOOMBA_INTERACT_DISABLED_STATE,
  );
  const deathStartedAtSecondsRef = useRef<number | null>(null);
  const deathAnchorPositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const deathYawRef = useRef(goomba.yaw + MODEL_FORWARD_YAW_OFFSET);
  const previousFramePositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const walkPhaseRef = useRef(0);
  const smoothedWalkSpeedRef = useRef(0);
  const walkScratchQuatARef = useRef(new THREE.Quaternion());
  const walkScratchQuatBRef = useRef(new THREE.Quaternion());

  const baseModel = useLoader(ColladaLoader, GOOMBA_MODEL_PATH);
  const model = useMemo(() => {
    const cloned = cloneSkeleton(baseModel.scene) as THREE.Object3D;
    cloned.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return cloned;
  }, [baseModel]);

  const rig = useMemo(() => buildGoombaRig(model), [model]);

  useEffect(() => {
    targetPositionRef.current.set(goomba.x, goomba.y, goomba.z);
  }, [goomba.x, goomba.y, goomba.z]);

  useEffect(() => {
    fallbackYawRef.current = goomba.yaw;
  }, [goomba.yaw]);

  useEffect(() => {
    setDamageEyesVisible(rig, false);
    isDamageEyeVisibleRef.current = false;

    const poof = poofRef.current;
    if (poof) {
      poof.visible = false;
      poof.scale.setScalar(DEATH_POOF_START_SCALE);
      setObjectOpacity(poof, DEATH_POOF_BASE_OPACITY);
    }

    return () => {
      setDamageEyesVisible(rig, false);
    };
  }, [rig]);

  useFrame((state, deltaSeconds) => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const poof = poofRef.current;

    const setBlinkVisible = (visible: boolean) => {
      if (isDamageEyeVisibleRef.current === visible) {
        return;
      }
      setDamageEyesVisible(rig, visible);
      isDamageEyeVisibleRef.current = visible;
    };

    const nextBlinkRandom = () => {
      const next =
        (Math.imul(blinkRandomStateRef.current, 1664525) + 1013904223) >>> 0;
      blinkRandomStateRef.current = next;
      return next / 4294967295;
    };

    const sampleBlinkIntervalSeconds = () =>
      THREE.MathUtils.lerp(
        BLINK_INTERVAL_MIN_SECONDS,
        BLINK_INTERVAL_MAX_SECONDS,
        nextBlinkRandom(),
      );

    const sampleBlinkDurationSeconds = () =>
      THREE.MathUtils.lerp(
        BLINK_DURATION_MIN_SECONDS,
        BLINK_DURATION_MAX_SECONDS,
        nextBlinkRandom(),
      );

    const nowSeconds = state.clock.getElapsedTime();
    const isDefeated = goomba.state === GOOMBA_INTERACT_DISABLED_STATE;

    if (isDefeated) {
      if (
        !wasDefeatedRef.current ||
        deathStartedAtSecondsRef.current === null
      ) {
        wasDefeatedRef.current = true;
        deathStartedAtSecondsRef.current = nowSeconds;
        deathAnchorPositionRef.current.copy(root.position);
        deathYawRef.current = root.rotation.y;
      }

      const deathStartedAt = deathStartedAtSecondsRef.current ?? nowSeconds;
      const deathElapsedSeconds = Math.max(0, nowSeconds - deathStartedAt);
      const squishProgress = THREE.MathUtils.clamp(
        deathElapsedSeconds / DEATH_SQUISH_DURATION_SECONDS,
        0,
        1,
      );

      root.position.copy(deathAnchorPositionRef.current);
      root.rotation.set(0, deathYawRef.current, 0);
      root.scale.set(
        THREE.MathUtils.lerp(1, DEATH_SQUASH_XZ_SCALE, squishProgress),
        THREE.MathUtils.lerp(1, DEATH_SQUASH_Y_SCALE, squishProgress),
        THREE.MathUtils.lerp(1, DEATH_SQUASH_XZ_SCALE, squishProgress),
      );

      const poofElapsedSeconds =
        deathElapsedSeconds - DEATH_SQUISH_DURATION_SECONDS;
      const isPoofActive =
        poofElapsedSeconds >= 0 &&
        poofElapsedSeconds < DEATH_POOF_DURATION_SECONDS;

      root.visible = poofElapsedSeconds < 0;

      if (poof) {
        if (isPoofActive) {
          const poofProgress = THREE.MathUtils.clamp(
            poofElapsedSeconds / DEATH_POOF_DURATION_SECONDS,
            0,
            1,
          );
          const easedPoof = 1 - Math.pow(1 - poofProgress, 2);

          poof.visible = true;
          poof.position.set(
            deathAnchorPositionRef.current.x,
            deathAnchorPositionRef.current.y +
              DEATH_POOF_Y_OFFSET +
              DEATH_POOF_RISE_DISTANCE * poofProgress,
            deathAnchorPositionRef.current.z,
          );
          poof.scale.setScalar(
            THREE.MathUtils.lerp(
              DEATH_POOF_START_SCALE,
              DEATH_POOF_END_SCALE,
              easedPoof,
            ),
          );
          setObjectOpacity(poof, DEATH_POOF_BASE_OPACITY * (1 - poofProgress));
        } else {
          poof.visible = false;
        }
      }

      setBlinkVisible(true);
      applyWalkPose(
        rig,
        0,
        walkPhaseRef.current,
        walkScratchQuatARef.current,
        walkScratchQuatBRef.current,
      );
      previousFramePositionRef.current.copy(root.position);
      return;
    }

    if (wasDefeatedRef.current) {
      wasDefeatedRef.current = false;
      deathStartedAtSecondsRef.current = null;
      root.visible = true;
      root.scale.set(1, 1, 1);
      root.rotation.x = 0;
      root.rotation.z = 0;

      if (poof) {
        poof.visible = false;
        poof.scale.setScalar(DEATH_POOF_START_SCALE);
        setObjectOpacity(poof, DEATH_POOF_BASE_OPACITY);
      }

      blinkEndsAtSecondsRef.current = 0;
      nextBlinkAtSecondsRef.current = nowSeconds + sampleBlinkIntervalSeconds();
    }

    root.visible = true;
    root.scale.set(1, 1, 1);
    root.rotation.x = 0;
    root.rotation.z = 0;

    if (poof) {
      poof.visible = false;
    }

    if (goomba.state === "charge") {
      const blinkWave = Math.sin(nowSeconds * Math.PI * 2 * CHARGE_BLINK_HZ);
      setBlinkVisible(blinkWave > 0);
    } else {
      if (nextBlinkAtSecondsRef.current === null) {
        nextBlinkAtSecondsRef.current =
          nowSeconds + sampleBlinkIntervalSeconds();
      }

      const nextBlinkAt = nextBlinkAtSecondsRef.current;
      if (nowSeconds >= nextBlinkAt) {
        blinkEndsAtSecondsRef.current =
          nowSeconds + sampleBlinkDurationSeconds();
        nextBlinkAtSecondsRef.current =
          blinkEndsAtSecondsRef.current + sampleBlinkIntervalSeconds();
      }

      const isBlinkActive = nowSeconds < blinkEndsAtSecondsRef.current;
      setBlinkVisible(isBlinkActive);
    }

    const positionBlend = 1 - Math.exp(-POSITION_SMOOTHNESS * deltaSeconds);
    root.position.lerp(targetPositionRef.current, positionBlend);

    const desiredYaw = -fallbackYawRef.current;

    const yawBlend = 1 - Math.exp(-YAW_SMOOTHNESS * deltaSeconds);
    root.rotation.y = lerpAngle(
      root.rotation.y,
      desiredYaw + MODEL_FORWARD_YAW_OFFSET,
      yawBlend,
    );

    const previousPosition = previousFramePositionRef.current;
    const planarDistance =
      Math.hypot(
        root.position.x - previousPosition.x,
        root.position.z - previousPosition.z,
      ) / Math.max(deltaSeconds, 1e-6);
    previousPosition.copy(root.position);

    const measuredNormalizedSpeed = THREE.MathUtils.clamp(
      planarDistance / WALK_SPEED_FOR_MAX_CYCLE,
      0,
      1,
    );
    const shouldWalk = goomba.state === "idle" || goomba.state === "enraged";
    const stateBaseSpeed =
      goomba.state === "enraged" ? 1 : shouldWalk ? 0.58 : 0;
    const targetWalkSpeed = shouldWalk
      ? Math.max(stateBaseSpeed, measuredNormalizedSpeed)
      : stateBaseSpeed;
    const walkBlend = 1 - Math.exp(-WALK_SPEED_SMOOTHNESS * deltaSeconds);
    smoothedWalkSpeedRef.current = THREE.MathUtils.lerp(
      smoothedWalkSpeedRef.current,
      targetWalkSpeed,
      walkBlend,
    );

    const gaitHz = THREE.MathUtils.lerp(
      WALK_CYCLE_MIN_HZ,
      WALK_CYCLE_MAX_HZ,
      smoothedWalkSpeedRef.current,
    );
    walkPhaseRef.current += deltaSeconds * gaitHz * Math.PI * 2;

    applyWalkPose(
      rig,
      smoothedWalkSpeedRef.current,
      walkPhaseRef.current,
      walkScratchQuatARef.current,
      walkScratchQuatBRef.current,
    );
  });

  return (
    <group>
      <group
        ref={rootRef}
        position={[goomba.x, goomba.y, goomba.z]}
        rotation={[0, goomba.yaw + MODEL_FORWARD_YAW_OFFSET, 0]}
      >
        <primitive object={model} scale={GOOMBA_MODEL_SCALE} />
      </group>

      <group
        ref={poofRef}
        visible={false}
        position={[goomba.x, goomba.y + DEATH_POOF_Y_OFFSET, goomba.z]}
        scale={DEATH_POOF_START_SCALE}
      >
        <Cloud
          position={[0, 0, 0]}
          speed={0}
          opacity={1}
          bounds={[0.8, 0.45, 0.2]}
          segments={16}
        />
      </group>
    </group>
  );
}

export function GoombaLayer({ goombas }: { goombas: readonly GoombaState[] }) {
  console.log("GoombaLayer", goombas);
  return (
    <group>
      {goombas.map((goomba) => (
        <GoombaActor key={goomba.goombaId} goomba={goomba} />
      ))}
    </group>
  );
}

useLoader.preload(ColladaLoader, GOOMBA_MODEL_PATH);
