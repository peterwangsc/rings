import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TreeSkeleton } from "../types";

export type BranchMesherOptions = {
  radialSegments: number;
  minRadius: number;
  depthLimit?: number;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEPTH_TAPER_MIN_SCALE = 0.16;
const DEPTH_TAPER_EXPONENT = 2.25;
const DEPTH_TAPER_TIP_START = 0.8;
const DEPTH_TAPER_TIP_SCALE = 0.58;
const TERMINAL_TIP_SCALE = 0.34;
const MIN_TOP_RADIUS_FACTOR = 0.2;

export function createBranchGeometry(
  skeleton: TreeSkeleton,
  options: BranchMesherOptions,
) {
  const segmentGeometries: THREE.BufferGeometry[] = [];

  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const maxDepth = Math.max(
    skeleton.nodes.reduce((currentMax, node) => Math.max(currentMax, node.depth), 0),
    1,
  );

  const stack = [skeleton.rootId];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (nodeId === undefined) {
      continue;
    }

    const node = skeleton.nodes[nodeId];
    for (const childId of node.children) {
      const child = skeleton.nodes[childId];
      stack.push(childId);

      if (
        options.depthLimit !== undefined &&
        (node.depth > options.depthLimit || child.depth > options.depthLimit + 1)
      ) {
        continue;
      }

      direction.copy(child.position).sub(node.position);
      const length = direction.length();
      if (length < 1e-5) {
        continue;
      }

      direction.multiplyScalar(1 / length);
      quaternion.setFromUnitVectors(WORLD_UP, direction);
      midpoint.copy(node.position).add(child.position).multiplyScalar(0.5);
      scale.set(1, length, 1);

      const parentDepthT = node.depth / maxDepth;
      const childDepthT = child.depth / maxDepth;
      const parentDepthScale = THREE.MathUtils.lerp(
        1,
        DEPTH_TAPER_MIN_SCALE,
        Math.pow(parentDepthT, DEPTH_TAPER_EXPONENT),
      );
      const childDepthScale = THREE.MathUtils.lerp(
        1,
        DEPTH_TAPER_MIN_SCALE,
        Math.pow(childDepthT, DEPTH_TAPER_EXPONENT),
      );
      const parentTipT = THREE.MathUtils.smoothstep(parentDepthT, DEPTH_TAPER_TIP_START, 1);
      const childTipT = THREE.MathUtils.smoothstep(childDepthT, DEPTH_TAPER_TIP_START, 1);
      const parentTipScale = THREE.MathUtils.lerp(1, DEPTH_TAPER_TIP_SCALE, parentTipT);
      const childTipScale = THREE.MathUtils.lerp(1, DEPTH_TAPER_TIP_SCALE, childTipT);
      const isTerminalTip = child.children.length === 0;
      const bottomRadius = Math.max(
        node.radius * parentDepthScale * parentTipScale,
        options.minRadius,
      );
      const topRadius = Math.max(
        child.radius *
          childDepthScale *
          childTipScale *
          (isTerminalTip ? TERMINAL_TIP_SCALE : 1),
        options.minRadius * MIN_TOP_RADIUS_FACTOR,
      );

      const cylinder = new THREE.CylinderGeometry(
        topRadius,
        bottomRadius,
        1,
        options.radialSegments,
        1,
        false,
      );

      matrix.compose(midpoint, quaternion, scale);
      cylinder.applyMatrix4(matrix);
      segmentGeometries.push(cylinder);
    }
  }

  if (segmentGeometries.length === 0) {
    return new THREE.CylinderGeometry(0.02, 0.03, 0.1, Math.max(options.radialSegments, 3), 1);
  }

  const merged = mergeGeometries(segmentGeometries, false);
  for (const geometry of segmentGeometries) {
    geometry.dispose();
  }

  merged.computeVertexNormals();
  return merged;
}
