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
}: {
  worldEntityManager: WorldEntityManager;
}) {
  const worldVersion = useWorldEntityVersion(worldEntityManager);
  void worldVersion;

  const handleCollect = useCallback(
    (ringId: string) => {
      collectWorldRing(worldEntityManager, ringId);
    },
    [worldEntityManager],
  );

  return (
    <>
      {worldEntityManager.visibleRingEntities.map((ring) => (
        <Ring
          key={ring.id}
          id={ring.id}
          position={ring.position}
          onCollect={handleCollect}
        />
      ))}
    </>
  );
}
