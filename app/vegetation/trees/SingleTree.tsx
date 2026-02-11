import { useEffect, useMemo } from "react";
import * as THREE from "three";

type SingleTreeProps = {
  position: readonly [number, number, number];
  heightScale?: number;
};

export type SingleTreeTrunkCollider = {
  halfHeight: number;
  centerY: number;
  radius: number;
};

const BASE_CANOPY_LAYERS = [
  { y: 6.7, radius: 3.6, height: 4.8, color: "#3C7738" },
  { y: 8.7, radius: 3.0, height: 4.0, color: "#376F35" },
  { y: 10.6, radius: 2.3, height: 3.2, color: "#336832" },
  { y: 12.1, radius: 1.65, height: 2.5, color: "#305F2E" },
  { y: 13.3, radius: 1.05, height: 1.9, color: "#2B562A" },
] as const;
const CANOPY_MAX_TWIST_RADIANS = Math.PI * 0.38;
const TRUNK_COLLIDER_RADIUS_MULTIPLIER = 0.82;
const TRUNK_COLLIDER_CANOPY_PENETRATION = 0.35;

type SingleTreeShape = {
  normalizedHeightScale: number;
  canopyLayers: Array<{
    y: number;
    radius: number;
    height: number;
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

function createSingleTreeShape(heightScale: number): SingleTreeShape {
  const normalizedHeightScale = THREE.MathUtils.clamp(heightScale, 0.7, 1.8);
  const canopyRadiusScale = Math.pow(normalizedHeightScale, 0.72);
  const trunkRadiusScale = Math.pow(normalizedHeightScale, 0.62);
  const canopyLayers = BASE_CANOPY_LAYERS.map((layer) => ({
    ...layer,
    y: layer.y * normalizedHeightScale,
    height: layer.height * normalizedHeightScale,
    radius: layer.radius * canopyRadiusScale,
  }));
  const canopyBounds = canopyLayers.reduce(
    (bounds, layer) => {
      const halfHeight = layer.height * 0.5;
      bounds.lowestBottom = Math.min(bounds.lowestBottom, layer.y - halfHeight);
      bounds.highestTop = Math.max(bounds.highestTop, layer.y + halfHeight);
      return bounds;
    },
    { lowestBottom: Infinity, highestTop: -Infinity },
  );
  const topMargin = 0.45 * normalizedHeightScale;
  const minimumReachIntoCanopy = 0.75 * normalizedHeightScale;
  const topY = canopyBounds.highestTop - topMargin;
  const trunkHeight = Math.max(
    canopyBounds.lowestBottom + minimumReachIntoCanopy,
    topY,
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
      top: 0.22 * trunkRadiusScale,
      bottom: 0.56 * trunkRadiusScale,
    },
  };
}

export function getSingleTreeTrunkCollider(
  heightScale = 1,
): SingleTreeTrunkCollider {
  const { normalizedHeightScale, canopyBounds, trunkDimensions, trunkRadii } =
    createSingleTreeShape(heightScale);
  const colliderTopY = Math.min(
    trunkDimensions.height,
    canopyBounds.lowestBottom + TRUNK_COLLIDER_CANOPY_PENETRATION * normalizedHeightScale,
  );
  const colliderHeight = Math.max(colliderTopY, 0.1);

  return {
    halfHeight: colliderHeight * 0.5,
    centerY: colliderHeight * 0.5,
    radius: Math.max(trunkRadii.bottom * TRUNK_COLLIDER_RADIUS_MULTIPLIER, 0.05),
  };
}

export function SingleTree({ position, heightScale = 1 }: SingleTreeProps) {
  const treeShape = useMemo(() => createSingleTreeShape(heightScale), [heightScale]);
  const { canopyLayers, canopyBounds, trunkDimensions, trunkRadii } = treeShape;
  const canopyTwistAngles = useMemo(() => {
    const heightSpan = Math.max(
      canopyBounds.highestTop - canopyBounds.lowestBottom,
      1e-6,
    );
    return canopyLayers.map((layer) => {
      const normalizedHeight =
        (layer.y - canopyBounds.lowestBottom) / heightSpan;
      return normalizedHeight * CANOPY_MAX_TWIST_RADIANS;
    });
  }, [canopyBounds, canopyLayers]);

  const trunkMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#5A4431", roughness: 0.98, metalness: 0.01 }),
    [],
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

  const disposeList = useMemo(
    () => [trunkMaterial, ...canopyMaterials],
    [canopyMaterials, trunkMaterial],
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
      >
        <cylinderGeometry
          args={[trunkRadii.top, trunkRadii.bottom, trunkDimensions.height, 12, 1]}
        />
      </mesh>

      {canopyLayers.map((layer, index) => (
        <mesh
          key={`single-tree-canopy-${index}`}
          castShadow
          receiveShadow
          position={[0, layer.y, 0]}
          rotation={[0, canopyTwistAngles[index], 0]}
          material={canopyMaterials[index]}
        >
          <coneGeometry args={[layer.radius, layer.height, 9, 1]} />
        </mesh>
      ))}
    </group>
  );
}
