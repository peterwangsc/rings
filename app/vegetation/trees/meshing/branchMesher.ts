import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TreeSkeleton } from "../types";

export type BranchMesherOptions = {
  radialSegments: number;
  minRadius: number;
  depthLimit?: number;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

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

      const bottomRadius = Math.max(node.radius, options.minRadius);
      const topRadius = Math.max(child.radius, options.minRadius * 0.75);

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
