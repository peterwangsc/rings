"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  useReducer as useSpacetimeReducer,
  useSpacetimeDB,
  useTable,
} from "spacetimedb/react";
import { RING_COLLECT_RADIUS } from "../../utils/constants";
import {
  collectWorldRing,
  applyServerRingRows,
  setWorldLocalRingCount,
  type WorldEntityManager,
  type WorldRingSnapshot,
  useWorldEntityVersion,
} from "../../scene/world/worldEntityManager";
import { tables, reducers } from "../../multiplayer/spacetime/bindings";
import { toCollectRingCommand } from "../../multiplayer/protocol";
import type { MultiplayerStore } from "../../multiplayer/state/multiplayerStore";
import { Ring } from "./Ring";
import { isDropRingCollectible } from "./ringTiming";

const RING_COLLECT_RETRY_INTERVAL_MS = 160;

function warnInvalidCommand(commandName: string, details: unknown) {
  if (process.env.NODE_ENV === "production") return;
  console.warn(`[multiplayer] dropped invalid ${commandName} command`, details);
}

export function RingField({
  worldEntityManager,
  store,
  onCollectRing,
  onCollect,
}: {
  worldEntityManager: WorldEntityManager;
  /** Store is passed through so callers can still use the legacy onCollectRing override. */
  store: MultiplayerStore;
  onCollectRing?: (ringId: string) => void;
  onCollect?: () => void;
}) {
  void store; // store arg kept for API compat; ring data flows via worldEntityManager
  const connectionState = useSpacetimeDB();
  const [ringDropRows] = useTable(tables.ringDropState);
  const [playerInventoryRows] = useTable(tables.playerInventory);
  const sendCollectRing = useSpacetimeReducer(reducers.collectRing);

  const localIdentity = connectionState.identity?.toHexString() ?? null;
  const isActive = connectionState.isActive;
  const projectedRingsBufferRef = useRef<WorldRingSnapshot[]>([]);

  // Ring rows → worldEntityManager (bypasses store entirely)
  useEffect(() => {
    if (!isActive) return;
    const projected = projectedRingsBufferRef.current;
    projected.length = 0;
    for (const ringDrop of ringDropRows) {
      if (ringDrop.collected) continue;
      projected.push({
        id: ringDrop.ringId,
        x: ringDrop.x,
        y: ringDrop.y,
        z: ringDrop.z,
        spawnedAtMs: ringDrop.spawnedAtMs,
      });
    }
    applyServerRingRows(worldEntityManager, projected);
  }, [isActive, ringDropRows, worldEntityManager]);

  // Local ring count → worldEntityManager HUD
  useEffect(() => {
    if (!isActive || !localIdentity) return;
    for (const row of playerInventoryRows) {
      if (row.identity !== localIdentity) continue;
      setWorldLocalRingCount(
        worldEntityManager,
        Math.max(0, Math.floor(row.ringCount)),
      );
      break;
    }
  }, [isActive, localIdentity, playerInventoryRows, worldEntityManager]);

  // Subscribe to worldEntityManager version so we re-render when rings change
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
      // Caller-provided override
      if (onCollectRing) {
        onCollectRing(ringId);
        return;
      }
      // Multiplayer: send to server
      if (isActive) {
        const command = toCollectRingCommand(ringId);
        if (!command) {
          warnInvalidCommand("collect_ring", { ringId });
          return;
        }
        sendCollectRing(command);
        return;
      }
      // Singleplayer fallback
      collectWorldRing(worldEntityManager, ringId);
    },
    [onCollect, onCollectRing, isActive, sendCollectRing, worldEntityManager],
  );

  useFrame(() => {
    const nowMs = Date.now();
    const playerPosition = worldEntityManager.playerPosition;
    const collectRadiusSquared = RING_COLLECT_RADIUS * RING_COLLECT_RADIUS;
    const attempts = lastCollectAttemptByRingRef.current;
    const soundPlayed = soundPlayedByRingRef.current;

    for (const id of soundPlayed) {
      if (!visibleRingEntities.some((r) => r.id === id)) soundPlayed.delete(id);
    }

    for (const ring of visibleRingEntities) {
      if (!isDropRingCollectible(ring.spawnedAtMs, nowMs)) continue;
      const [ringX, ringY, ringZ] = ring.position;
      const dx = playerPosition.x - ringX;
      const dy = playerPosition.y - ringY;
      const dz = playerPosition.z - ringZ;
      if (dx * dx + dy * dy + dz * dz > collectRadiusSquared) continue;
      const lastAttemptMs = attempts.get(ring.id) ?? 0;
      if (nowMs - lastAttemptMs < RING_COLLECT_RETRY_INTERVAL_MS) continue;
      attempts.set(ring.id, nowMs);
      handleCollect(ring.id);
      break;
    }
  });
  const ringGroupsRef = useRef(new Map<string, THREE.Group>());
  const frustumRef = useRef(new THREE.Frustum());
  const projMatRef = useRef(new THREE.Matrix4());
  const sphereRef = useRef(new THREE.Sphere(new THREE.Vector3(), 1.5));

  useFrame((state) => {
    projMatRef.current.multiplyMatrices(
      state.camera.projectionMatrix,
      state.camera.matrixWorldInverse,
    );
    frustumRef.current.setFromProjectionMatrix(projMatRef.current);
    const frustum = frustumRef.current;
    const sphere = sphereRef.current;
    for (const ring of visibleRingEntities) {
      const group = ringGroupsRef.current.get(ring.id);
      if (!group) continue;
      sphere.center.set(ring.position[0], ring.position[1], ring.position[2]);
      group.visible = frustum.intersectsSphere(sphere);
    }
  });

  return (
    <>
      {visibleRingEntities.map((ring) => (
        <group
          key={ring.id}
          ref={(g) => {
            if (g) ringGroupsRef.current.set(ring.id, g);
            else ringGroupsRef.current.delete(ring.id);
          }}
        >
          <Ring
            position={ring.position}
            spawnedAtMs={ring.spawnedAtMs}
          />
        </group>
      ))}
    </>
  );
}
