import * as THREE from "three";
import { solveBranchRadii } from "../generation/radiusSolver";
import { generateSpaceColonizationSkeleton } from "../generation/spaceColonization";
import type { TreeArchetype, TreeSpeciesPreset, TreeSystemConfig } from "../types";
import { createBranchGeometry } from "./branchMesher";
import { createCanopyGeometry } from "./canopyMesher";

function createRng(seed: number) {
  let state = (Math.floor(seed) ^ 0x85ebca6b) >>> 0;
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

function computeBoundsRadius(archetype: TreeArchetype) {
  let radius = 0;
  for (const lod of archetype.lods) {
    lod.branchGeometry.computeBoundingSphere();
    lod.canopyGeometry.computeBoundingSphere();
    radius = Math.max(radius, lod.branchGeometry.boundingSphere?.radius ?? 0);
    radius = Math.max(radius, lod.canopyGeometry.boundingSphere?.radius ?? 0);
  }
  return radius;
}

function buildArchetype(
  species: TreeSpeciesPreset,
  variantIndex: number,
  config: TreeSystemConfig,
  archetypeSeed: number,
): TreeArchetype {
  const rng = createRng(archetypeSeed);
  const skeleton = generateSpaceColonizationSkeleton(species, config, archetypeSeed);
  solveBranchRadii(skeleton, config, config.meshing.trunkDepthForLod2);

  const canopyBaseRadius = rangeLerp(species.canopyPuffRadius, rng());

  const lods = [0, 1, 2].map((lodLevel) => {
    const branchGeometry = createBranchGeometry(skeleton, {
      radialSegments: config.meshing.lodBranchRadialSegments[lodLevel],
      minRadius: config.radius.minKeptRadius * 0.8,
      depthLimit: lodLevel === 2 ? config.meshing.trunkDepthForLod2 : undefined,
    });

    const canopyGeometry = createCanopyGeometry(skeleton, {
      detail: config.meshing.lodCanopyDetail[lodLevel],
      sampleStride: config.meshing.lodCanopySampleStride[lodLevel],
      baseRadius: canopyBaseRadius,
      minRadius: canopyBaseRadius * 0.65,
      seed: archetypeSeed + lodLevel * 73,
      windSkew: species.windSkew,
    });

    return { branchGeometry, canopyGeometry };
  }) as TreeArchetype["lods"];

  const archetype: TreeArchetype = {
    id: `${species.id}-${variantIndex}`,
    speciesId: species.id,
    variantIndex,
    seed: archetypeSeed,
    lods,
    boundsRadius: 0,
  };

  archetype.boundsRadius = computeBoundsRadius(archetype);
  return archetype;
}

export function buildTreeArchetypes(config: TreeSystemConfig, seed = config.seed) {
  const archetypes: TreeArchetype[] = [];

  for (let speciesIndex = 0; speciesIndex < config.species.length; speciesIndex++) {
    const species = config.species[speciesIndex];
    for (let variantIndex = 0; variantIndex < config.variantsPerSpecies; variantIndex++) {
      const archetypeSeed = seed + speciesIndex * 1_000_003 + variantIndex * 4099;
      archetypes.push(buildArchetype(species, variantIndex, config, archetypeSeed));
    }
  }

  return archetypes;
}
