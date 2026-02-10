import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TreeSkeleton } from "../types";

export type CanopyMesherOptions = {
  detail: number;
  sampleStride: number;
  baseRadius: number;
  minRadius: number;
  seed: number;
  branchSpread: number;
  windSkew: number;
};

function hash(seed: number) {
  const s = Math.sin(seed * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}

function createLeafBladeTemplate() {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const xNorm = Math.abs(x) / 0.5;
    const yNorm = y + 0.5;

    // Bend along the center vein and curl the tip for a leaf-like silhouette.
    const centerFold = (1 - THREE.MathUtils.clamp(xNorm, 0, 1)) * 0.08;
    const tipCurl = yNorm * yNorm * 0.06;
    position.setZ(vertexIndex, centerFold - tipCurl);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  // Move the pivot to the stem so matrix transforms place leaves naturally.
  geometry.translate(0, 0.5, 0);
  return geometry;
}

export function createCanopyGeometry(
  skeleton: TreeSkeleton,
  options: CanopyMesherOptions,
) {
  const leafGeometries: THREE.BufferGeometry[] = [];
  const leafTemplate = createLeafBladeTemplate();

  const branchDirection = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const leafDirection = new THREE.Vector3();
  const leafOffset = new THREE.Vector3();
  const leafPosition = new THREE.Vector3();
  const windOffset = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const spreadFactor = THREE.MathUtils.clamp(options.branchSpread, 0.22, 1.1);

  for (
    let terminalIndex = 0;
    terminalIndex < skeleton.terminalNodeIds.length;
    terminalIndex += Math.max(options.sampleStride, 1)
  ) {
    const nodeId = skeleton.terminalNodeIds[terminalIndex];
    const node = skeleton.nodes[nodeId];
    const parent =
      node.parentId === null ? null : skeleton.nodes[node.parentId];

    const nodeSeed = options.seed + nodeId * 17.37;
    const clumpRadius = Math.max(
      options.minRadius,
      options.baseRadius * THREE.MathUtils.lerp(0.72, 1.28, hash(nodeSeed + 1.9)),
    );
    const leafCount =
      3 +
      Math.max(options.detail, 0) * 2 +
      Math.floor(hash(nodeSeed + 8.4) * THREE.MathUtils.lerp(2, 5, spreadFactor));

    if (parent) {
      branchDirection.copy(node.position).sub(parent.position);
      if (branchDirection.lengthSq() < 1e-6) {
        branchDirection.copy(worldUp);
      } else {
        branchDirection.normalize();
      }
    } else {
      branchDirection.copy(worldUp);
    }

    tangent.copy(worldUp).cross(branchDirection);
    if (tangent.lengthSq() < 1e-6) {
      tangent.set(1, 0, 0);
    } else {
      tangent.normalize();
    }
    bitangent.copy(branchDirection).cross(tangent).normalize();
    windOffset.set(options.windSkew * clumpRadius * 0.18, 0, -options.windSkew * clumpRadius * 0.06);

    for (let leafIndex = 0; leafIndex < leafCount; leafIndex++) {
      const leafSeed = nodeSeed + leafIndex * 13.57;
      const azimuth = hash(leafSeed + 2.6) * Math.PI * 2;
      const spread =
        THREE.MathUtils.lerp(0.18, 0.92, hash(leafSeed + 3.9)) * spreadFactor;
      const lift = THREE.MathUtils.lerp(0.08, 0.42, hash(leafSeed + 5.2));

      leafDirection
        .copy(branchDirection)
        .multiplyScalar(THREE.MathUtils.lerp(0.42, 0.76, hash(leafSeed + 6.4)))
        .addScaledVector(tangent, Math.cos(azimuth) * spread)
        .addScaledVector(bitangent, Math.sin(azimuth) * spread)
        .addScaledVector(worldUp, lift)
        .addScaledVector(windOffset, 0.35)
        .normalize();

      const stemLift = THREE.MathUtils.lerp(0.04, 0.24, hash(leafSeed + 7.8));
      leafOffset
        .copy(branchDirection)
        .multiplyScalar(clumpRadius * stemLift)
        .addScaledVector(
          tangent,
          (hash(leafSeed + 9.1) - 0.5) * clumpRadius * 0.58 * spreadFactor,
        )
        .addScaledVector(
          bitangent,
          (hash(leafSeed + 10.7) - 0.5) * clumpRadius * 0.58 * spreadFactor,
        );

      leafPosition.copy(node.position).add(windOffset).add(leafOffset);

      orientation.setFromUnitVectors(worldUp, leafDirection);
      const rollRadians = (hash(leafSeed + 12.3) - 0.5) * Math.PI * 0.9;
      roll.setFromAxisAngle(leafDirection, rollRadians);
      orientation.multiply(roll);

      const leafLength = clumpRadius * THREE.MathUtils.lerp(0.56, 1.02, hash(leafSeed + 14.2));
      const leafWidth = leafLength * THREE.MathUtils.lerp(0.28, 0.46, hash(leafSeed + 15.6));
      const leafThickness = THREE.MathUtils.lerp(0.9, 1.25, hash(leafSeed + 16.4));

      const leafGeometry = leafTemplate.clone();
      scale.set(leafWidth, leafLength, leafThickness);
      matrix.compose(leafPosition, orientation, scale);
      leafGeometry.applyMatrix4(matrix);
      leafGeometries.push(leafGeometry);
    }
  }

  leafTemplate.dispose();

  if (leafGeometries.length === 0) {
    return new THREE.ConeGeometry(0.05, 0.14, 3, 1);
  }

  const merged = mergeGeometries(leafGeometries, false);
  for (const geometry of leafGeometries) {
    geometry.dispose();
  }
  merged.computeVertexNormals();
  return merged;
}
