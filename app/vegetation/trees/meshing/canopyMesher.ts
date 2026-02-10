import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TreeSkeleton } from "../types";

export type CanopyMesherOptions = {
  detail: number;
  sampleStride: number;
  baseRadius: number;
  minRadius: number;
  seed: number;
  windSkew: number;
};

function hash(seed: number) {
  const s = Math.sin(seed * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}

export function createCanopyGeometry(
  skeleton: TreeSkeleton,
  options: CanopyMesherOptions,
) {
  const puffGeometries: THREE.BufferGeometry[] = [];

  for (
    let terminalIndex = 0;
    terminalIndex < skeleton.terminalNodeIds.length;
    terminalIndex += Math.max(options.sampleStride, 1)
  ) {
    const nodeId = skeleton.terminalNodeIds[terminalIndex];
    const node = skeleton.nodes[nodeId];

    const nodeSeed = options.seed + nodeId * 17.37;
    const radius = Math.max(
      options.minRadius,
      options.baseRadius * THREE.MathUtils.lerp(0.72, 1.28, hash(nodeSeed + 1.9)),
    );

    const puff = new THREE.IcosahedronGeometry(radius, options.detail);
    const offset = new THREE.Vector3(
      (hash(nodeSeed + 2.2) - 0.5) * radius * 0.45 + options.windSkew * radius * 0.35,
      (hash(nodeSeed + 3.4) - 0.5) * radius * 0.32,
      (hash(nodeSeed + 5.6) - 0.5) * radius * 0.45,
    );

    puff.translate(
      node.position.x + offset.x,
      node.position.y + offset.y,
      node.position.z + offset.z,
    );
    puffGeometries.push(puff);
  }

  if (puffGeometries.length === 0) {
    return new THREE.IcosahedronGeometry(0.08, 0);
  }

  const merged = mergeGeometries(puffGeometries, false);
  for (const geometry of puffGeometries) {
    geometry.dispose();
  }
  merged.computeVertexNormals();
  return merged;
}
