"use client";

/**
 * useGameScene
 *
 * Owns all imperative, non-rendering session state:
 *   - worldEntityManager lifecycle
 *   - audio callbacks
 *   - music blending (via setInterval, not React state)
 *   - player position → chunk sync
 *
 * Does NOT call useTable or useMultiplayerSync. All network subscriptions
 * live in the leaf components that consume each table's data.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useGameAudio } from "../audio/useGameAudio";
import type { FireballSpawnEvent } from "../multiplayer/state/multiplayerTypes";
import type { MultiplayerStore } from "../multiplayer/state/multiplayerStore";
import {
  createWorldEntityManager,
  disposeWorldEntityManager,
  updateWorldPlayerPosition,
} from "./world/worldEntityManager";

const MUSIC_BLEND_TICK_MS = 200;
const MUSIC_DAY_NIGHT_START_SUN_HEIGHT = -0.08;
const MUSIC_DAY_NIGHT_END_SUN_HEIGHT = 0.12;
const MUSIC_CYCLE_PHASE_OFFSET_RADIANS = Math.PI * 0.25;

function smoothstep(edge0: number, edge1: number, value: number) {
  const clamped = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return clamped * clamped * (3 - 2 * clamped);
}

function getMusicNightFactor({
  dayCycleAnchorMs,
  dayCycleDurationSeconds,
  estimatedServerTimeOffsetMs,
}: {
  dayCycleAnchorMs: number;
  dayCycleDurationSeconds: number;
  estimatedServerTimeOffsetMs: number;
}) {
  const durationMs = Math.max(1, dayCycleDurationSeconds * 1000);
  const estimatedServerNowMs = Date.now() + estimatedServerTimeOffsetMs;
  const elapsedMs = estimatedServerNowMs - dayCycleAnchorMs;
  const wrappedElapsedMs = ((elapsedMs % durationMs) + durationMs) % durationMs;
  const cycleProgress = wrappedElapsedMs / durationMs;
  const sunHeight = Math.sin(cycleProgress * Math.PI * 2 + MUSIC_CYCLE_PHASE_OFFSET_RADIANS);
  return 1 - smoothstep(MUSIC_DAY_NIGHT_START_SUN_HEIGHT, MUSIC_DAY_NIGHT_END_SUN_HEIGHT, sunHeight);
}

export function useGameScene(multiplayerStore: MultiplayerStore) {
  const worldEntityManager = useMemo(() => createWorldEntityManager(), []);

  useEffect(() => {
    return () => disposeWorldEntityManager(worldEntityManager);
  }, [worldEntityManager]);

  const networkFireballSpawnQueueRef = useRef<FireballSpawnEvent[]>([]);

  const {
    playCoin,
    playShoot,
    playJump,
    playGoombaDefeated,
    setFootstepsActive,
    setDayNightMusicBlend,
    fireballLoops,
  } = useGameAudio();

  // Music blending: runs on a fixed interval, reads store state via ref
  const multiplayerStateRef = useRef(multiplayerStore.state);
  useEffect(() => {
    const listener = () => { multiplayerStateRef.current = multiplayerStore.state; };
    multiplayerStore.listeners.add(listener);
    return () => multiplayerStore.listeners.delete(listener);
  }, [multiplayerStore]);

  const fallbackMusicCycleAnchorMsRef = useRef<number | null>(null);
  useEffect(() => {
    const updateMusicBlend = () => {
      if (fallbackMusicCycleAnchorMsRef.current === null) {
        fallbackMusicCycleAnchorMsRef.current = Date.now();
      }
      const state = multiplayerStateRef.current;
      const cycleAnchorMs = state.dayCycleAnchorMs ?? fallbackMusicCycleAnchorMsRef.current;
      setDayNightMusicBlend(getMusicNightFactor({
        dayCycleAnchorMs: cycleAnchorMs,
        dayCycleDurationSeconds: state.dayCycleDurationSeconds,
        estimatedServerTimeOffsetMs: state.serverTimeOffsetMs ?? 0,
      }));
    };
    updateMusicBlend();
    const id = window.setInterval(updateMusicBlend, MUSIC_BLEND_TICK_MS);
    return () => window.clearInterval(id);
  }, [setDayNightMusicBlend]);

  const handlePlayerPositionUpdate = useCallback(
    (x: number, y: number, z: number) => updateWorldPlayerPosition(worldEntityManager, x, y, z),
    [worldEntityManager],
  );

  return {
    worldEntityManager,
    networkFireballSpawnQueueRef,
    playCoin,
    playShoot,
    playJump,
    playGoombaDefeated,
    setFootstepsActive,
    fireballLoops,
    handlePlayerPositionUpdate,
  };
}
