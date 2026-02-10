import * as THREE from "three";
import type { TreeSkeleton, TreeSpeciesPreset, TreeSystemConfig } from "../types";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function createRng(seed: number) {
  let state = (Math.floor(seed) ^ 0x7f4a7c15) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rangeLerp(range: readonly [number, number], t: number) {
  return THREE.MathUtils.lerp(range[0], range[1], t);
}

function sampleAttractorPoint(
  shape: TreeSpeciesPreset["shape"],
  trunkHeight: number,
  canopyHeight: number,
  canopyRadius: number,
  windSkew: number,
  rng: () => number,
) {
  const theta = rng() * Math.PI * 2;
  const u = rng();
  const v = rng();

  if (shape === "conical") {
    const yNorm = Math.pow(u, 0.78);
    const radial = (1 - yNorm) * canopyRadius * Math.sqrt(v);
    return new THREE.Vector3(
      Math.cos(theta) * radial,
      trunkHeight + yNorm * canopyHeight,
      Math.sin(theta) * radial,
    );
  }

  const radiusScale = Math.cbrt(v);
  const phi = Math.acos(1 - 2 * u);
  const sphereRadius = canopyRadius * radiusScale;
  const sphereX = Math.sin(phi) * Math.cos(theta) * sphereRadius;
  const sphereY = Math.cos(phi) * sphereRadius;
  const sphereZ = Math.sin(phi) * Math.sin(theta) * sphereRadius;

  const position = new THREE.Vector3(
    sphereX,
    trunkHeight + canopyHeight * 0.5 + sphereY * 0.72,
    sphereZ,
  );

  if (shape === "windswept") {
    position.x += canopyRadius * windSkew * 0.42;
    position.z -= canopyRadius * windSkew * 0.12;
  }

  return position;
}

export function generateSpaceColonizationSkeleton(
  species: TreeSpeciesPreset,
  config: TreeSystemConfig,
  seed: number,
): TreeSkeleton {
  const rng = createRng(seed);
  const trunkHeight = rangeLerp(species.trunkHeight, rng());
  const canopyHeight = rangeLerp(species.canopyHeight, rng());
  const canopyRadius = rangeLerp(species.canopyRadius, rng());
  const attractorCount = Math.floor(rangeLerp(species.attractorCount, rng()));

  const nodes: TreeSkeleton["nodes"] = [];
  const addNode = (position: THREE.Vector3, parentId: number | null) => {
    const id = nodes.length;
    const depth = parentId === null ? 0 : nodes[parentId].depth + 1;
    nodes.push({
      id,
      parentId,
      children: [],
      position,
      depth,
      radius: 0,
    });
    if (parentId !== null) {
      nodes[parentId].children.push(id);
    }
    return id;
  };

  const rootId = addNode(new THREE.Vector3(0, 0, 0), null);
  const trunkDirection = new THREE.Vector3(species.windSkew * 0.2, 1, -species.lean * 0.15).normalize();
  const trunkSegments = Math.max(4, Math.floor(trunkHeight / config.growth.stepSize));

  let currentId = rootId;
  for (let i = 0; i < trunkSegments; i++) {
    const parent = nodes[currentId];
    const bendStrength = THREE.MathUtils.lerp(0.15, 0.95, i / Math.max(trunkSegments - 1, 1));
    const bendDirection = new THREE.Vector3(
      (rng() - 0.5) * species.lean,
      1,
      (rng() - 0.5) * species.lean,
    )
      .addScaledVector(trunkDirection, bendStrength * species.lean)
      .normalize();

    const childPosition = parent.position
      .clone()
      .addScaledVector(bendDirection, config.growth.stepSize);
    currentId = addNode(childPosition, currentId);
  }

  let attractors: THREE.Vector3[] = [];
  for (let i = 0; i < attractorCount; i++) {
    attractors.push(
      sampleAttractorPoint(
        species.shape,
        trunkHeight,
        canopyHeight,
        canopyRadius,
        species.windSkew,
        rng,
      ),
    );
  }

  const influenceRadius = config.growth.influenceRadius;
  const killDistance = config.growth.killDistance;
  const stepSize = config.growth.stepSize;

  const nearestDirection = new THREE.Vector3();

  for (let iteration = 0; iteration < config.growth.maxIterations && attractors.length > 0; iteration++) {
    const directionSums = new Map<number, THREE.Vector3>();
    const directionCounts = new Map<number, number>();
    const nextAttractors: THREE.Vector3[] = [];

    for (const attractor of attractors) {
      let closestNodeId = -1;
      let closestDistanceSq = Infinity;

      for (let nodeId = 0; nodeId < nodes.length; nodeId++) {
        const node = nodes[nodeId];
        const distanceSq = node.position.distanceToSquared(attractor);
        if (distanceSq < closestDistanceSq) {
          closestDistanceSq = distanceSq;
          closestNodeId = nodeId;
        }
      }

      if (closestNodeId < 0) {
        continue;
      }

      const closestDistance = Math.sqrt(closestDistanceSq);
      if (closestDistance <= killDistance) {
        continue;
      }

      if (closestDistance <= influenceRadius) {
        const node = nodes[closestNodeId];
        nearestDirection.copy(attractor).sub(node.position).normalize();
        const sum = directionSums.get(closestNodeId) ?? new THREE.Vector3();
        sum.add(nearestDirection);
        directionSums.set(closestNodeId, sum);
        directionCounts.set(closestNodeId, (directionCounts.get(closestNodeId) ?? 0) + 1);
      } else {
        nextAttractors.push(attractor);
      }
    }

    if (directionSums.size === 0) {
      break;
    }

    for (const [nodeId, directionSum] of directionSums) {
      const node = nodes[nodeId];
      const count = directionCounts.get(nodeId) ?? 1;
      const direction = directionSum.multiplyScalar(1 / count);

      const depthNormalized = node.depth / Math.max(nodes.length, 1);
      const apical = (1 - depthNormalized) * config.growth.apicalDominance;

      direction
        .multiplyScalar(1 - config.growth.lateralBias)
        .addScaledVector(WORLD_UP, config.growth.trunkLiftBias + apical)
        .add(new THREE.Vector3(species.windSkew * 0.03, 0, 0))
        .normalize();

      const childPosition = node.position.clone().addScaledVector(direction, stepSize);

      let tooClose = false;
      for (let existingId = 0; existingId < nodes.length; existingId++) {
        if (nodes[existingId].position.distanceToSquared(childPosition) < (stepSize * 0.58) ** 2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        continue;
      }

      addNode(childPosition, nodeId);
    }

    attractors = nextAttractors;
  }

  const terminalNodeIds = nodes
    .filter((node) => node.children.length === 0)
    .map((node) => node.id);

  return {
    nodes,
    rootId,
    terminalNodeIds,
  };
}
