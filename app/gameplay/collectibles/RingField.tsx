"use client";

import { useCallback, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RING_COLLECT_RADIUS } from "../../utils/constants";
import {
  collectWorldRing,
  type WorldEntityManager,
  useWorldEntityVersion,
} from "../../scene/world/worldEntityManager";
import { Ring } from "./Ring";
import { isDropRingCollectible } from "./ringTiming";

const RING_COLLECT_RETRY_INTERVAL_MS = 160;

export function RingField({
  worldEntityManager,
  onCollectRing,
}: {
  worldEntityManager: WorldEntityManager;
  onCollectRing?: (ringId: string) => void;
}) {
  useWorldEntityVersion(worldEntityManager);
  const lastCollectAttemptByRingRef = useRef<Map<string, number>>(new Map());
  const prevVisibleRingEntitiesRef = useRef(worldEntityManager.visibleRingEntities);

  const { visibleRingEntities } = worldEntityManager;

  // Prune stale attempt entries whenever the visible ring list changes.
  if (prevVisibleRingEntitiesRef.current !== visibleRingEntities) {
    prevVisibleRingEntitiesRef.current = visibleRingEntities;
    const attempts = lastCollectAttemptByRingRef.current;
    if (attempts.size > 0) {
      const visibleIds = new Set(visibleRingEntities.map((r) => r.id));
      for (const ringId of attempts.keys()) {
        if (!visibleIds.has(ringId)) {
          attempts.delete(ringId);
        }
      }
    }
  }

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

  useFrame(() => {
    const nowMs = Date.now();
    const playerPosition = worldEntityManager.playerPosition;
    const collectRadiusSquared = RING_COLLECT_RADIUS * RING_COLLECT_RADIUS;
    const attempts = lastCollectAttemptByRingRef.current;

    for (const ring of visibleRingEntities) {
      if (ring.source === "drop") {
        if (
          ring.spawnedAtMs === undefined ||
          !isDropRingCollectible(ring.spawnedAtMs, nowMs)
        ) {
          continue;
        }
      }

      const [ringX, ringY, ringZ] = ring.position;
      const dx = playerPosition.x - ringX;
      const dy = playerPosition.y - ringY;
      const dz = playerPosition.z - ringZ;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared > collectRadiusSquared) {
        continue;
      }

      const lastAttemptMs = attempts.get(ring.id) ?? 0;
      if (nowMs - lastAttemptMs < RING_COLLECT_RETRY_INTERVAL_MS) {
        continue;
      }

      attempts.set(ring.id, nowMs);
      handleCollect(ring.id);
      break;
    }
  });

  return (
    <>
      {visibleRingEntities.map((ring) => (
        <Ring
          key={ring.id}
          position={ring.position}
          spawnedAtMs={ring.spawnedAtMs}
        />
      ))}
    </>
  );
}
