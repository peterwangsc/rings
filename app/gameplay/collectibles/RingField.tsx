"use client";

import { useCallback } from "react";
import {
  collectWorldRing,
  type WorldEntityManager,
  useWorldEntityVersion,
} from "../../scene/world/worldEntityManager";
import { Ring } from "./Ring";

export function RingField({
  worldEntityManager,
  onCollectRing,
}: {
  worldEntityManager: WorldEntityManager;
  onCollectRing?: (ringId: string) => void;
}) {
  const worldVersion = useWorldEntityVersion(worldEntityManager);
  void worldVersion;

  const handleCollect = useCallback(
    (ringId: string) => {
      if (onCollectRing) {
        onCollectRing(ringId);
        return;
      }
      collectWorldRing(worldEntityManager, ringId);
    },
    [onCollectRing, worldEntityManager],
  );

  return (
    <>
      {worldEntityManager.visibleRingEntities.map((ring) => (
        <Ring
          key={ring.id}
          id={ring.id}
          position={ring.position}
          spawnedAtMs={ring.spawnedAtMs}
          onCollect={handleCollect}
        />
      ))}
    </>
  );
}
