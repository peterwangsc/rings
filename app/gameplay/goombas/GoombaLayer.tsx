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
const WALK_BLEND_SMOOTHNESS = 8;
const WALK_CYCLE_IDLE_SPEED = 1.8;
const WALK_CYCLE_MOVE_SPEED = 9.2;
const LEG_SWING_ANGLE_RADIANS = 0.42;
const ARM_SWING_ANGLE_RADIANS = 0.24;
const HEAD_SWAY_ANGLE_RADIANS = 0.06;
const WALK_CLIP_PATTERN = /(walk|run|move)/i;
const IDLE_CLIP_PATTERN = /(idle|stand|breathe)/i;

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
  const targetPositionRef = useRef(
    new THREE.Vector3(goomba.x, goomba.y, goomba.z),
  );
  const targetYawRef = useRef(goomba.yaw);
  const animationBundleRef = useRef<AnimationBundle | null>(null);
  const walkCycleTimeRef = useRef(0);
  const walkBlendRef = useRef(0);

  const baseModel = useLoader(ColladaLoader, GOOMBA_MODEL_PATH);
  const animationBundle = useMemo<AnimationBundle>(() => {
    const cloned = cloneSkeleton(baseModel.scene) as THREE.Object3D;
    cloned.traverse((object) => {
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
      rig: buildProceduralRig(cloned),
    };
  }, [baseModel]);

  useEffect(() => {
    targetPositionRef.current.set(goomba.x, goomba.y, goomba.z);
    targetYawRef.current = goomba.yaw;
  }, [goomba.x, goomba.y, goomba.yaw, goomba.z]);

  useEffect(() => {
    animationBundleRef.current = animationBundle;
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

  useFrame((_, deltaSeconds) => {
    const root = rootRef.current;
    const bundle = animationBundleRef.current;
    if (!root || !bundle) {
      return;
    }

    const positionBlend = 1 - Math.exp(-POSITION_SMOOTHNESS * deltaSeconds);
    root.position.lerp(targetPositionRef.current, positionBlend);

    const yawBlend = 1 - Math.exp(-YAW_SMOOTHNESS * deltaSeconds);
    root.rotation.y = THREE.MathUtils.lerp(
      root.rotation.y,
      targetYawRef.current,
      yawBlend,
    );

    const targetWalkBlend = goomba.state === "charge" ? 1 : 0;
    const walkBlend = THREE.MathUtils.lerp(
      walkBlendRef.current,
      targetWalkBlend,
      1 - Math.exp(-WALK_BLEND_SMOOTHNESS * deltaSeconds),
    );
    walkBlendRef.current = walkBlend;

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

    walkCycleTimeRef.current += deltaSeconds * THREE.MathUtils.lerp(
      WALK_CYCLE_IDLE_SPEED,
      WALK_CYCLE_MOVE_SPEED,
      walkBlend,
    );
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
      visible={goomba.state !== GOOMBA_INTERACT_DISABLED_STATE}
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
