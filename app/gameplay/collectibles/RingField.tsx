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
  onCollect,
}: {
  worldEntityManager: WorldEntityManager;
  onCollectRing?: (ringId: string) => void;
  onCollect?: () => void;
}) {
  useWorldEntityVersion(worldEntityManager);
  const lastCollectAttemptByRingRef = useRef<Map<string, number>>(new Map());
  const soundPlayedByRingRef = useRef<Set<string>>(new Set());

  const { visibleRingEntities } = worldEntityManager;

  const handleCollect = useCallback(
    (ringId: string) => {
      if (!soundPlayedByRingRef.current.has(ringId)) {
        soundPlayedByRingRef.current.add(ringId);
        onCollect?.();
      }
      if (onCollectRing) {
        onCollectRing(ringId);
        return;
      }
      collectWorldRing(worldEntityManager, ringId);
    },
    [onCollect, onCollectRing, worldEntityManager],
  );

  useFrame(() => {
    const nowMs = Date.now();
    const playerPosition = worldEntityManager.playerPosition;
    const collectRadiusSquared = RING_COLLECT_RADIUS * RING_COLLECT_RADIUS;
    const attempts = lastCollectAttemptByRingRef.current;
    const soundPlayed = soundPlayedByRingRef.current;

    for (const id of soundPlayed) {
      if (!visibleRingEntities.some((r) => r.id === id)) {
        soundPlayed.delete(id);
      }
    }

    for (const ring of visibleRingEntities) {
      if (!isDropRingCollectible(ring.spawnedAtMs, nowMs)) {
        continue;
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
