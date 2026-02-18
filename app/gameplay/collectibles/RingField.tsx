"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  RING_COLLECT_RADIUS,
  RING_DROP_MAX_ACTIVE_POINT_LIGHTS,
  RING_DROP_POINT_LIGHT_ENABLED,
} from "../../utils/constants";
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
  const worldVersion = useWorldEntityVersion(worldEntityManager);
  const lastCollectAttemptByRingRef = useRef<Map<string, number>>(new Map());
  const ringsWithPointLight = new Set<string>();
  const droppedCandidates: { id: string; spawnedAtMs: number }[] = [];
  for (const ring of worldEntityManager.visibleRingEntities) {
    if (ring.source === "starter") {
      ringsWithPointLight.add(ring.id);
      continue;
    }
    if (!RING_DROP_POINT_LIGHT_ENABLED) {
      continue;
    }
    droppedCandidates.push({
      id: ring.id,
      spawnedAtMs: ring.spawnedAtMs ?? 0,
    });
  }
  droppedCandidates.sort((a, b) => b.spawnedAtMs - a.spawnedAtMs);
  const dropLights = Math.min(
    RING_DROP_MAX_ACTIVE_POINT_LIGHTS,
    droppedCandidates.length,
  );
  for (let index = 0; index < dropLights; index += 1) {
    ringsWithPointLight.add(droppedCandidates[index].id);
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

  useEffect(() => {
    const attempts = lastCollectAttemptByRingRef.current;
    if (attempts.size <= 0) {
      return;
    }

    const visibleRingIds = new Set(
      worldEntityManager.visibleRingEntities.map((ring) => ring.id),
    );
    for (const ringId of attempts.keys()) {
      if (!visibleRingIds.has(ringId)) {
        attempts.delete(ringId);
      }
    }
  }, [worldEntityManager, worldVersion]);

  useFrame(() => {
    const nowMs = Date.now();
    const playerPosition = worldEntityManager.playerPosition;
    const collectRadiusSquared = RING_COLLECT_RADIUS * RING_COLLECT_RADIUS;
    const attempts = lastCollectAttemptByRingRef.current;

    for (const ring of worldEntityManager.visibleRingEntities) {
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
      {worldEntityManager.visibleRingEntities.map((ring) => (
        <Ring
          key={ring.id}
          position={ring.position}
          spawnedAtMs={ring.spawnedAtMs}
          withPointLight={ringsWithPointLight.has(ring.id)}
        />
      ))}
    </>
  );
}
