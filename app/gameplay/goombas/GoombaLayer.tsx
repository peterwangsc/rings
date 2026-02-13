"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import type { GoombaState } from "../../multiplayer/state/multiplayerTypes";
import {
  GOOMBA_INTERACT_DISABLED_STATE,
  GOOMBA_MODEL_PATH,
  GOOMBA_MODEL_SCALE,
} from "../../utils/constants";

const POSITION_SMOOTHNESS = 14;
const YAW_SMOOTHNESS = 14;
const CHARGE_YAW_SMOOTHNESS = 24;
const WALK_BLEND_SMOOTHNESS = 8;
const WALK_CYCLE_IDLE_SPEED = 1.8;
const WALK_CYCLE_MOVE_SPEED = 9.2;
const LEG_SWING_ANGLE_RADIANS = 0.42;
const ARM_SWING_ANGLE_RADIANS = 0.24;
const HEAD_SWAY_ANGLE_RADIANS = 0.06;
const IDLE_BOB_AMPLITUDE = 0.04;
const CHARGE_BOB_AMPLITUDE = 0.12;
const MOVEMENT_EPSILON_SQUARED = 1e-6;
const DEATH_ANIM_DURATION_SECONDS = 1.05;
const DEATH_HIDE_DELAY_SECONDS = 1.6;
const DEATH_SINK_DISTANCE = 0.45;
const DEATH_MAX_TILT_RADIANS = 1.35;
const DEATH_SQUASH_XZ_SCALE = 1.22;
const DEATH_SQUASH_Y_SCALE = 0.42;
const DEATH_EYE_BLINK_HZ = 9.5;
const DEATH_EYE_FINAL_CLOSE_PROGRESS = 0.72;
const ALIVE_BLINK_INTERVAL_MIN_SECONDS = 2.2;
const ALIVE_BLINK_INTERVAL_MAX_SECONDS = 5.1;
const ALIVE_BLINK_DURATION_MIN_SECONDS = 0.06;
const ALIVE_BLINK_DURATION_MAX_SECONDS = 0.14;
const WALK_CLIP_PATTERN = /(walk|run|move)/i;
const IDLE_CLIP_PATTERN = /(idle|stand|breathe)/i;
const DAMAGE_EYE_NAME_PATTERN = /damageeye/i;

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type RigNode = {
  readonly node: THREE.Object3D;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
};

type ProceduralRig = {
  readonly leftLeg: readonly RigNode[];
  readonly rightLeg: readonly RigNode[];
  readonly leftArm: readonly RigNode[];
  readonly rightArm: readonly RigNode[];
  readonly head: readonly RigNode[];
};

type AnimationBundle = {
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer | null;
  readonly walkAction: THREE.AnimationAction | null;
  readonly idleAction: THREE.AnimationAction | null;
  readonly damageEyeNodes: readonly THREE.Object3D[];
  readonly rig: ProceduralRig;
};

function createRigNode(node: THREE.Object3D): RigNode {
  return {
    node,
    baseX: node.rotation.x,
    baseY: node.rotation.y,
    baseZ: node.rotation.z,
  };
}

function buildProceduralRig(root: THREE.Object3D): ProceduralRig {
  const leftLeg: RigNode[] = [];
  const rightLeg: RigNode[] = [];
  const leftArm: RigNode[] = [];
  const rightArm: RigNode[] = [];
  const head: RigNode[] = [];

  root.traverse((object) => {
    if (!object.name) {
      return;
    }
    const name = object.name.toLowerCase();
    if (
      name.includes("left_leg") ||
      name.includes("leftfoot") ||
      name.includes("lefttoe")
    ) {
      leftLeg.push(createRigNode(object));
      return;
    }
    if (
      name.includes("right_leg") ||
      name.includes("rightfoot") ||
      name.includes("righttoe")
    ) {
      rightLeg.push(createRigNode(object));
      return;
    }
    if (name.includes("left_arm")) {
      leftArm.push(createRigNode(object));
      return;
    }
    if (name.includes("right_arm")) {
      rightArm.push(createRigNode(object));
      return;
    }
    if (
      name.includes("head") ||
      name.includes("spine") ||
      name.includes("mayu") ||
      name.includes("mouthb")
    ) {
      head.push(createRigNode(object));
    }
  });

  return {
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    head,
  };
}

function applyRotationOffsets(
  nodes: readonly RigNode[],
  xOffset: number,
  yOffset = 0,
  zOffset = 0,
) {
  for (const node of nodes) {
    node.node.rotation.x = node.baseX + xOffset;
    node.node.rotation.y = node.baseY + yOffset;
    node.node.rotation.z = node.baseZ + zOffset;
  }
}

function GoombaActor({ goomba }: { goomba: GoombaState }) {
  const rootRef = useRef<THREE.Group>(null);
  const previousPositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const deathAnchorPositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const targetPositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const targetYawRef = useRef(goomba.yaw);
  const animationBundleRef = useRef<AnimationBundle | null>(null);
  const damageEyeNodesRef = useRef<readonly THREE.Object3D[]>([]);
  const isDamageEyeVisibleRef = useRef(false);
  const blinkRandomStateRef = useRef(
    hashStringToUint32(goomba.goombaId) || 1,
  );
  const blinkEndsAtSecondsRef = useRef(0);
  const nextBlinkAtSecondsRef = useRef<number | null>(null);
  const wasDefeatedRef = useRef(
    goomba.state === GOOMBA_INTERACT_DISABLED_STATE,
  );
  const deathStartedAtSecondsRef = useRef<number | null>(
    goomba.state === GOOMBA_INTERACT_DISABLED_STATE ? 0 : null,
  );
  const walkCycleTimeRef = useRef(0);
  const walkBlendRef = useRef(0);

  const baseModel = useLoader(ColladaLoader, GOOMBA_MODEL_PATH);
  const animationBundle = useMemo<AnimationBundle>(() => {
    const cloned = cloneSkeleton(baseModel.scene) as THREE.Object3D;
    const damageEyeNodes: THREE.Object3D[] = [];
    cloned.traverse((object) => {
      if (DAMAGE_EYE_NAME_PATTERN.test(object.name)) {
        damageEyeNodes.push(object);
        object.visible = false;
      }
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    if (baseModel.animations.length === 0) {
      return {
        model: cloned,
        mixer: null,
        walkAction: null,
        idleAction: null,
        damageEyeNodes,
        rig: buildProceduralRig(cloned),
      };
    }

    const mixer = new THREE.AnimationMixer(cloned);
    const walkClip =
      baseModel.animations.find((clip) => WALK_CLIP_PATTERN.test(clip.name)) ??
      baseModel.animations[0] ??
      null;
    const idleClip =
      baseModel.animations.find((clip) => IDLE_CLIP_PATTERN.test(clip.name)) ??
      baseModel.animations[0] ??
      null;
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;

    if (walkAction) {
      walkAction.enabled = true;
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.setEffectiveWeight(0);
      walkAction.play();
    }
    if (idleAction) {
      idleAction.enabled = true;
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.setEffectiveWeight(1);
      idleAction.play();
    }

    return {
      model: cloned,
      mixer,
      walkAction,
      idleAction,
      damageEyeNodes,
      rig: buildProceduralRig(cloned),
    };
  }, [baseModel]);

  useEffect(() => {
    targetPositionRef.current.set(goomba.x, goomba.y, goomba.z);
    targetYawRef.current = goomba.yaw;
  }, [goomba.x, goomba.y, goomba.yaw, goomba.z]);

  useEffect(() => {
    animationBundleRef.current = animationBundle;
    damageEyeNodesRef.current = animationBundle.damageEyeNodes;
    isDamageEyeVisibleRef.current = false;
  }, [animationBundle]);

  useEffect(() => {
    return () => {
      animationBundle.walkAction?.stop();
      if (
        animationBundle.idleAction &&
        animationBundle.idleAction !== animationBundle.walkAction
      ) {
        animationBundle.idleAction.stop();
      }
      animationBundle.mixer?.stopAllAction();
    };
  }, [animationBundle]);

  useFrame((state, deltaSeconds) => {
    const root = rootRef.current;
    const bundle = animationBundleRef.current;
    if (!root || !bundle) {
      return;
    }

    const setDamageEyeVisible = (visible: boolean) => {
      if (isDamageEyeVisibleRef.current === visible) {
        return;
      }
      for (const node of damageEyeNodesRef.current) {
        node.visible = visible;
      }
      isDamageEyeVisibleRef.current = visible;
    };
    const nextBlinkRandom = () => {
      const next =
        (Math.imul(blinkRandomStateRef.current, 1664525) + 1013904223) >>> 0;
      blinkRandomStateRef.current = next;
      return next / 4294967295;
    };
    const sampleAliveBlinkIntervalSeconds = () =>
      THREE.MathUtils.lerp(
        ALIVE_BLINK_INTERVAL_MIN_SECONDS,
        ALIVE_BLINK_INTERVAL_MAX_SECONDS,
        nextBlinkRandom(),
      );
    const sampleAliveBlinkDurationSeconds = () =>
      THREE.MathUtils.lerp(
        ALIVE_BLINK_DURATION_MIN_SECONDS,
        ALIVE_BLINK_DURATION_MAX_SECONDS,
        nextBlinkRandom(),
      );

    const isDefeated = goomba.state === GOOMBA_INTERACT_DISABLED_STATE;
    if (!isDefeated) {
      root.visible = true;
      root.scale.set(1, 1, 1);
      root.rotation.x = 0;
      root.rotation.z = 0;
      deathStartedAtSecondsRef.current = null;

      const nowSeconds = state.clock.getElapsedTime();
      if (wasDefeatedRef.current || nextBlinkAtSecondsRef.current === null) {
        blinkEndsAtSecondsRef.current = 0;
        nextBlinkAtSecondsRef.current =
          nowSeconds + sampleAliveBlinkIntervalSeconds();
      }

      const nextBlinkAtSeconds = nextBlinkAtSecondsRef.current;
      if (nowSeconds >= nextBlinkAtSeconds) {
        blinkEndsAtSecondsRef.current =
          nowSeconds + sampleAliveBlinkDurationSeconds();
        nextBlinkAtSecondsRef.current =
          blinkEndsAtSecondsRef.current + sampleAliveBlinkIntervalSeconds();
      }

      const isAliveBlinkActive = nowSeconds < blinkEndsAtSecondsRef.current;
      setDamageEyeVisible(isAliveBlinkActive);
    } else {
      if (!wasDefeatedRef.current) {
        deathStartedAtSecondsRef.current = state.clock.getElapsedTime();
        deathAnchorPositionRef.current.copy(root.position);
      }
      const deathStartedAt = deathStartedAtSecondsRef.current ?? state.clock.getElapsedTime();
      const deathElapsedSeconds = Math.max(
        0,
        state.clock.getElapsedTime() - deathStartedAt,
      );
      const deathProgress = THREE.MathUtils.clamp(
        deathElapsedSeconds / DEATH_ANIM_DURATION_SECONDS,
        0,
        1,
      );
      const deathEaseOut = 1 - Math.pow(1 - deathProgress, 3);
      const wobble =
        Math.sin(deathElapsedSeconds * Math.PI * 2 * 6.5) * (1 - deathProgress);

      root.rotation.x = -DEATH_MAX_TILT_RADIANS * deathEaseOut + wobble * 0.08;
      root.rotation.z = wobble * 0.18;
      root.scale.set(
        THREE.MathUtils.lerp(1, DEATH_SQUASH_XZ_SCALE, deathEaseOut),
        THREE.MathUtils.lerp(1, DEATH_SQUASH_Y_SCALE, deathEaseOut),
        THREE.MathUtils.lerp(1, DEATH_SQUASH_XZ_SCALE, deathEaseOut),
      );
      root.position.x = deathAnchorPositionRef.current.x;
      root.position.z = deathAnchorPositionRef.current.z;
      root.position.y =
        deathAnchorPositionRef.current.y -
        DEATH_SINK_DISTANCE * deathEaseOut +
        Math.sin(deathElapsedSeconds * Math.PI * 2 * 3.2) *
          (1 - deathProgress) *
          0.05;

      const damageEyeVisible =
        deathProgress >= DEATH_EYE_FINAL_CLOSE_PROGRESS ||
        Math.sin(deathElapsedSeconds * Math.PI * 2 * DEATH_EYE_BLINK_HZ) > 0;
      setDamageEyeVisible(damageEyeVisible);
      root.visible = deathElapsedSeconds < DEATH_HIDE_DELAY_SECONDS;

      if (bundle.walkAction) {
        bundle.walkAction.setEffectiveWeight(0);
      }
      if (bundle.idleAction) {
        bundle.idleAction.setEffectiveWeight(1);
      }
      bundle.mixer?.update(deltaSeconds * 0.4);
      wasDefeatedRef.current = true;
      return;
    }
    wasDefeatedRef.current = false;

    const previousPosition = previousPositionRef.current;
    previousPosition.copy(root.position);

    const positionBlend = 1 - Math.exp(-POSITION_SMOOTHNESS * deltaSeconds);
    root.position.lerp(targetPositionRef.current, positionBlend);

    const moveDeltaX = root.position.x - previousPosition.x;
    const moveDeltaZ = root.position.z - previousPosition.z;
    const moveDeltaSquared = moveDeltaX * moveDeltaX + moveDeltaZ * moveDeltaZ;
    const isCharging = goomba.state === "charge";

    let nextYaw = targetYawRef.current;
    if (isCharging) {
      const toTargetX = targetPositionRef.current.x - root.position.x;
      const toTargetZ = targetPositionRef.current.z - root.position.z;
      const toTargetSquared = toTargetX * toTargetX + toTargetZ * toTargetZ;
      if (toTargetSquared > MOVEMENT_EPSILON_SQUARED) {
        nextYaw = Math.atan2(toTargetX, -toTargetZ);
      } else if (moveDeltaSquared > MOVEMENT_EPSILON_SQUARED) {
        nextYaw = Math.atan2(moveDeltaX, -moveDeltaZ);
      }
    }

    const yawBlend = 1 - Math.exp(-(
      isCharging ? CHARGE_YAW_SMOOTHNESS : YAW_SMOOTHNESS
    ) * deltaSeconds);
    root.rotation.y = THREE.MathUtils.lerp(
      root.rotation.y,
      nextYaw,
      yawBlend,
    );

    const targetWalkBlend = isCharging ? 1 : 0;
    const walkBlend = THREE.MathUtils.lerp(
      walkBlendRef.current,
      targetWalkBlend,
      1 - Math.exp(-WALK_BLEND_SMOOTHNESS * deltaSeconds),
    );
    walkBlendRef.current = walkBlend;

    walkCycleTimeRef.current += deltaSeconds * THREE.MathUtils.lerp(
      WALK_CYCLE_IDLE_SPEED,
      WALK_CYCLE_MOVE_SPEED,
      walkBlend,
    );
    const bobOffset = THREE.MathUtils.lerp(
      IDLE_BOB_AMPLITUDE * Math.sin(walkCycleTimeRef.current * 0.8),
      CHARGE_BOB_AMPLITUDE * Math.sin(walkCycleTimeRef.current * 2),
      walkBlend,
    );
    root.position.y += bobOffset;

    if (bundle.mixer) {
      if (bundle.walkAction) {
        bundle.walkAction.setEffectiveWeight(walkBlend);
      }
      if (bundle.idleAction) {
        bundle.idleAction.setEffectiveWeight(1 - walkBlend);
      }
      bundle.mixer.update(deltaSeconds);
      return;
    }

    const cycleValue = Math.sin(walkCycleTimeRef.current);
    const legSwing = cycleValue * LEG_SWING_ANGLE_RADIANS * walkBlend;
    const armSwing = cycleValue * ARM_SWING_ANGLE_RADIANS * walkBlend;
    const headSway = Math.sin(walkCycleTimeRef.current * 0.5) * HEAD_SWAY_ANGLE_RADIANS;

    applyRotationOffsets(bundle.rig.leftLeg, legSwing);
    applyRotationOffsets(bundle.rig.rightLeg, -legSwing);
    applyRotationOffsets(bundle.rig.leftArm, -armSwing);
    applyRotationOffsets(bundle.rig.rightArm, armSwing);
    applyRotationOffsets(bundle.rig.head, 0, headSway * (1 - walkBlend * 0.25));
  });

  return (
    <group
      ref={rootRef}
      position={[goomba.x, goomba.y, goomba.z]}
      rotation={[0, goomba.yaw, 0]}
    >
      <primitive object={animationBundle.model} scale={GOOMBA_MODEL_SCALE} />
    </group>
  );
}

export function GoombaLayer({ goombas }: { goombas: readonly GoombaState[] }) {
  return (
    <group>
      {goombas.map((goomba) => (
        <GoombaActor key={goomba.goombaId} goomba={goomba} />
      ))}
    </group>
  );
}

useLoader.preload(ColladaLoader, GOOMBA_MODEL_PATH);
