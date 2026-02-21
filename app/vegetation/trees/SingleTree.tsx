import { useEffect, useMemo } from "react";
import * as THREE from "three";

type SingleTreeProps = {
  position: readonly [number, number, number];
  heightScale?: number;
  species?: SingleTreeSpecies;
  variationSeed?: number;
};

export type SingleTreeSpecies = "pine" | "redwood" | "fir";

export type SingleTreeTrunkCollider = {
  halfHeight: number;
  centerY: number;
  radius: number;
};

type CanopyLayerTemplate = {
  y: number;
  radius: number;
  height: number;
  color: string;
};

type SpeciesShapeProfile = {
  canopyLayers: readonly CanopyLayerTemplate[];
  canopyTwistRadians: number;
  asymmetry: number;
  trunkTopRadius: number;
  trunkBottomRadius: number;
  trunkTaperExponent: number;
  trunkTopMargin: number;
  trunkCanopyPenetration: number;
};

type SingleTreeShape = {
  normalizedHeightScale: number;
  canopyLayers: Array<{
    y: number;
    x: number;
    z: number;
    radius: number;
    height: number;
    twist: number;
    color: string;
  }>;
  canopyBounds: {
    lowestBottom: number;
    highestTop: number;
  };
  trunkDimensions: {
    height: number;
    y: number;
  };
  trunkRadii: {
    top: number;
    bottom: number;
  };
};

const SPECIES_SHAPE_PROFILES: Record<SingleTreeSpecies, SpeciesShapeProfile> = {
  pine: {
    canopyLayers: [
      { y: 6.7, radius: 3.6, height: 4.8, color: "#3C7738" },
      { y: 8.7, radius: 3.0, height: 4.0, color: "#376F35" },
      { y: 10.6, radius: 2.3, height: 3.2, color: "#336832" },
      { y: 12.1, radius: 1.65, height: 2.5, color: "#305F2E" },
      { y: 13.3, radius: 1.05, height: 1.9, color: "#2B562A" },
    ],
    canopyTwistRadians: Math.PI * 0.36,
    asymmetry: 0.11,
    trunkTopRadius: 0.03,
    trunkBottomRadius: 0.56,
    trunkTaperExponent: 2.45,
    trunkTopMargin: 0.45,
    trunkCanopyPenetration: 0.35,
  },
  redwood: {
    canopyLayers: [
      { y: 12.9, radius: 2.0, height: 2.9, color: "#3E7738" },
      { y: 14.5, radius: 2.15, height: 2.7, color: "#3C7536" },
      { y: 16.2, radius: 1.9, height: 2.5, color: "#396F35" },
      { y: 17.8, radius: 1.55, height: 2.3, color: "#346A32" },
      { y: 19.1, radius: 1.2, height: 2.0, color: "#30612E" },
      { y: 20.2, radius: 0.86, height: 1.6, color: "#2C582A" },
    ],
    canopyTwistRadians: Math.PI * 0.22,
    asymmetry: 0.07,
    trunkTopRadius: 0.04,
    trunkBottomRadius: 0.72,
    trunkTaperExponent: 2.2,
    trunkTopMargin: 0.38,
    trunkCanopyPenetration: 0.24,
  },
  fir: {
    canopyLayers: [
      { y: 6.4, radius: 3.0, height: 3.8, color: "#376F35" },
      { y: 8.1, radius: 2.45, height: 3.4, color: "#346B33" },
      { y: 9.9, radius: 2.0, height: 2.9, color: "#316632" },
      { y: 11.5, radius: 1.56, height: 2.5, color: "#2E6030" },
      { y: 12.9, radius: 1.14, height: 2.0, color: "#2B592C" },
      { y: 14.0, radius: 0.82, height: 1.6, color: "#285228" },
    ],
    canopyTwistRadians: Math.PI * 0.3,
    asymmetry: 0.1,
    trunkTopRadius: 0.028,
    trunkBottomRadius: 0.49,
    trunkTaperExponent: 2.6,
    trunkTopMargin: 0.42,
    trunkCanopyPenetration: 0.31,
  },
};

const TRUNK_COLLIDER_RADIUS_MULTIPLIER = 0.82;
const TRUNK_TOP_RATIO_MIN = 0.015;
const TRUNK_TOP_RATIO_MAX = 0.08;
const TRUNK_MIN_TOP_RADIUS = 0.008;
const TRUNK_RADIUS_HEIGHT_EXPONENT = 0.5;
const TALL_TREE_THICKNESS_REDUCTION_START = 1.05;
const TALL_TREE_THICKNESS_REDUCTION_END = 1.8;
const TALL_TREE_THICKNESS_MIN_SCALE = 0.82;
const TRUNK_RADIAL_SEGMENTS = 12;
const TRUNK_HEIGHT_SEGMENTS = 14;
const SEED_PRIME_A = 127.1;
const SEED_PRIME_B = 311.7;
const SEED_PRIME_C = 74.7;

function hash(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453123;
  return value - Math.floor(value);
}

function getFallbackVariationSeed(position: readonly [number, number, number]) {
  return (
    position[0] * SEED_PRIME_A +
    position[1] * SEED_PRIME_C +
    position[2] * SEED_PRIME_B
  );
}

function createMonumentTaperedTrunkGeometry(
  topRadius: number,
  bottomRadius: number,
  height: number,
  taperExponent: number,
) {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    TRUNK_RADIAL_SEGMENTS,
    TRUNK_HEIGHT_SEGMENTS,
    false,
  );
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;

  for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
    const x = positions.getX(vertexIndex);
    const y = positions.getY(vertexIndex);
    const z = positions.getZ(vertexIndex);
    const radial = Math.hypot(x, z);
    if (radial < 1e-6) {
      continue;
    }

    const t = THREE.MathUtils.clamp((y + height * 0.5) / Math.max(height, 1e-6), 0, 1);
    const linearRadius = THREE.MathUtils.lerp(bottomRadius, topRadius, t);
    const curvedRadius = topRadius + (bottomRadius - topRadius) * (1 - Math.pow(t, taperExponent));
    const targetRadius = Math.max(curvedRadius, topRadius);
    const scale = targetRadius / Math.max(linearRadius, 1e-6);
    positions.setX(vertexIndex, x * scale);
    positions.setZ(vertexIndex, z * scale);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createSingleTreeShape(
  heightScale: number,
  species: SingleTreeSpecies,
  variationSeed: number,
): SingleTreeShape {
  const profile = SPECIES_SHAPE_PROFILES[species];
  const normalizedHeightScale = THREE.MathUtils.clamp(heightScale, 0.7, 1.8);
  const canopyRadiusScale = Math.pow(normalizedHeightScale, 0.72);
  const tallTreeThicknessBlend = THREE.MathUtils.smoothstep(
    normalizedHeightScale,
    TALL_TREE_THICKNESS_REDUCTION_START,
    TALL_TREE_THICKNESS_REDUCTION_END,
  );
  const tallTreeThicknessScale = THREE.MathUtils.lerp(
    1,
    TALL_TREE_THICKNESS_MIN_SCALE,
    tallTreeThicknessBlend,
  );
  const trunkRadiusScale =
    Math.pow(normalizedHeightScale, TRUNK_RADIUS_HEIGHT_EXPONENT) *
    tallTreeThicknessScale;
  const canopyLayers = profile.canopyLayers.map((layer, layerIndex) => {
    const layerSeed = variationSeed + (layerIndex + 1) * 73.17;
    const radiusJitter = THREE.MathUtils.lerp(0.84, 1.16, hash(layerSeed + 1.2));
    const heightJitter = THREE.MathUtils.lerp(0.88, 1.14, hash(layerSeed + 2.8));
    const normalizedLayer = layerIndex / Math.max(profile.canopyLayers.length - 1, 1);
    const asymmetryStrength =
      layer.radius *
      canopyRadiusScale *
      profile.asymmetry *
      (1 - normalizedLayer * 0.58) *
      THREE.MathUtils.lerp(0.45, 1, hash(layerSeed + 4.9));
    const asymmetryAngle = hash(layerSeed + 6.4) * Math.PI * 2;

    return {
      y: layer.y * normalizedHeightScale,
      x: Math.cos(asymmetryAngle) * asymmetryStrength,
      z: Math.sin(asymmetryAngle) * asymmetryStrength,
      height: layer.height * normalizedHeightScale * heightJitter,
      radius: layer.radius * canopyRadiusScale * radiusJitter,
      twist:
        normalizedLayer * profile.canopyTwistRadians +
        (hash(layerSeed + 8.7) - 0.5) * Math.PI * 0.18,
      color: layer.color,
    };
  });

  const canopyBounds = canopyLayers.reduce(
    (bounds, layer) => {
      const halfHeight = layer.height * 0.5;
      bounds.lowestBottom = Math.min(bounds.lowestBottom, layer.y - halfHeight);
      bounds.highestTop = Math.max(bounds.highestTop, layer.y + halfHeight);
      return bounds;
    },
    { lowestBottom: Infinity, highestTop: -Infinity },
  );

  const topMargin = profile.trunkTopMargin * normalizedHeightScale;
  const minimumReachIntoCanopy = 0.75 * normalizedHeightScale;
  const topY = canopyBounds.highestTop - topMargin;
  const trunkHeight = Math.max(canopyBounds.lowestBottom + minimumReachIntoCanopy, topY);
  const trunkBottomRadius =
    profile.trunkBottomRadius *
    trunkRadiusScale *
    THREE.MathUtils.lerp(0.92, 1.12, hash(variationSeed + 21.4));
  const trunkTopRadiusBase =
    profile.trunkTopRadius *
    trunkRadiusScale *
    THREE.MathUtils.lerp(0.82, 1.03, hash(variationSeed + 15.6));
  const trunkTopRadius = Math.max(
    trunkTopRadiusBase,
    trunkBottomRadius *
      THREE.MathUtils.lerp(
        TRUNK_TOP_RATIO_MIN,
        TRUNK_TOP_RATIO_MAX,
        hash(variationSeed + 25.3),
      ),
    TRUNK_MIN_TOP_RADIUS,
  );

  return {
    normalizedHeightScale,
    canopyLayers,
    canopyBounds,
    trunkDimensions: {
      height: trunkHeight,
      y: trunkHeight * 0.5,
    },
    trunkRadii: {
      top: trunkTopRadius,
      bottom: trunkBottomRadius,
    },
  };
}

export function getSingleTreeTrunkCollider(
  heightScale = 1,
  species: SingleTreeSpecies = "pine",
  variationSeed = 0,
): SingleTreeTrunkCollider {
  const { normalizedHeightScale, canopyBounds, trunkDimensions, trunkRadii } =
    createSingleTreeShape(heightScale, species, variationSeed);
  const profile = SPECIES_SHAPE_PROFILES[species];
  const colliderTopY = Math.min(
    trunkDimensions.height,
    canopyBounds.lowestBottom + profile.trunkCanopyPenetration * normalizedHeightScale,
  );
  const colliderHeight = Math.max(colliderTopY, 0.1);

  return {
    halfHeight: colliderHeight * 0.5,
    centerY: colliderHeight * 0.5,
    radius: Math.max(trunkRadii.bottom * TRUNK_COLLIDER_RADIUS_MULTIPLIER, 0.05),
  };
}

export function SingleTree({
  position,
  heightScale = 1,
  species = "pine",
  variationSeed,
}: SingleTreeProps) {
  const resolvedSeed = useMemo(
    () => variationSeed ?? getFallbackVariationSeed(position),
    [position, variationSeed],
  );
  const treeShape = useMemo(
    () => createSingleTreeShape(heightScale, species, resolvedSeed),
    [heightScale, species, resolvedSeed],
  );
  const { canopyLayers, trunkDimensions, trunkRadii } = treeShape;
  const trunkTaperExponent = SPECIES_SHAPE_PROFILES[species].trunkTaperExponent;

  const trunkMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: species === "redwood" ? "#684A34" : "#5A4431",
        roughness: 0.98,
        metalness: 0.01,
      }),
    [species],
  );
  const canopyMaterials = useMemo(
    () =>
      canopyLayers.map(
        (layer) =>
          new THREE.MeshStandardMaterial({
            color: layer.color,
            roughness: 0.9,
            metalness: 0.01,
            flatShading: true,
          }),
      ),
    [canopyLayers],
  );
  const trunkGeometry = useMemo(
    () =>
      createMonumentTaperedTrunkGeometry(
        trunkRadii.top,
        trunkRadii.bottom,
        trunkDimensions.height,
        trunkTaperExponent,
      ),
    [trunkDimensions.height, trunkRadii.bottom, trunkRadii.top, trunkTaperExponent],
  );

  const disposeList = useMemo(
    () => [trunkMaterial, ...canopyMaterials, trunkGeometry],
    [canopyMaterials, trunkGeometry, trunkMaterial],
  );
  useEffect(() => {
    return () => {
      for (const disposable of disposeList) {
        disposable.dispose();
      }
    };
  }, [disposeList]);

  return (
    <group position={position}>
      <mesh
        castShadow
        receiveShadow
        position={[0, trunkDimensions.y, 0]}
        material={trunkMaterial}
        geometry={trunkGeometry}
      />

      {canopyLayers.map((layer, index) => (
        <mesh
          key={`single-tree-canopy-${index}`}
          castShadow
          receiveShadow
          position={[layer.x, layer.y, layer.z]}
          rotation={[0, layer.twist, 0]}
          material={canopyMaterials[index]}
        >
          <coneGeometry args={[layer.radius, layer.height, 11, 1]} />
        </mesh>
      ))}
    </group>
  );
}
