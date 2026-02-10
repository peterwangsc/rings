import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ROOT_MOTION_TRACK_NODE_ALIASES } from "../utils/constants";
import type { MotionActionMap, MotionState } from "./characterTypes";

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findClipByName(
  clips: readonly THREE.AnimationClip[],
  clipName: string,
): THREE.AnimationClip | null {
  const normalizedExpected = normalizeName(clipName);
  return (
    clips.find((clip) => normalizeName(clip.name) === normalizedExpected) ?? null
  );
}

export function stripRootMotionTracks(
  clip: THREE.AnimationClip,
): THREE.AnimationClip {
  const sanitizedClip = clip.clone();
  sanitizedClip.tracks = sanitizedClip.tracks.filter((track) => {
    if (!track.name.endsWith(".position")) {
      return true;
    }

    const normalizedTrackName = normalizeName(track.name);
    const targetsRootMotionNode = ROOT_MOTION_TRACK_NODE_ALIASES.some((alias) =>
      normalizedTrackName.includes(alias),
    );

    return !targetsRootMotionNode;
  });
  sanitizedClip.resetDuration();
  return sanitizedClip;
}

export function prepareCharacter(
  sourceScene: THREE.Object3D,
  animations: readonly THREE.AnimationClip[],
  targetHeight: number,
): THREE.Group {
  const root = cloneSkeleton(sourceScene) as THREE.Group;
  root.animations = [...animations];

  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = true;
    }
  });

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 1e-6);
  const scale = targetHeight / height;
  root.scale.setScalar(scale);

  const scaledBounds = new THREE.Box3().setFromObject(root);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  const minY = scaledBounds.min.y;

  root.position.x -= center.x;
  root.position.y -= minY;
  root.position.z -= center.z;

  return root;
}

export function resolveMotionAction(
  actions: MotionActionMap,
  motionState: MotionState,
): THREE.AnimationAction | null {
  switch (motionState) {
    case "happy":
      return actions.happy;
    case "sad":
      return actions.sad;
    case "running":
      return actions.running;
    case "jump_running":
      return actions.jump_running;
    case "jump":
      return actions.jump;
    case "walk":
      return actions.walk;
    case "idle":
    default:
      return actions.idle;
  }
}
