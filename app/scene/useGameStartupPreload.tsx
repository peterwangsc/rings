"use client";

import { useGLTF, useProgress } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLoader, Cache, TextureLoader } from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import {
  PRELOAD_AUDIO_PATHS,
  PRELOAD_TEXTURE_PATHS,
} from "../assets/gameAssets";
import {
  CHARACTER_OLD_PATH,
  CHARACTER_PATH,
  GOOMBA_MODEL_PATH,
} from "../utils/constants";

const PRELOAD_IDLE_GRACE_MS = 1600;

function startGameAssetPreload() {
  Cache.enabled = true;
  useGLTF.preload(CHARACTER_PATH);
  useGLTF.preload(CHARACTER_OLD_PATH);
  useLoader.preload(ColladaLoader, GOOMBA_MODEL_PATH);
  useLoader.preload(TextureLoader, PRELOAD_TEXTURE_PATHS as unknown as string[]);
  useLoader.preload(AudioLoader, PRELOAD_AUDIO_PATHS as unknown as string[]);
}

function toItemLabel(item: string) {
  const withoutOrigin = item.replace(/^https?:\/\/[^/]+/i, "");
  try {
    return decodeURIComponent(withoutOrigin);
  } catch {
    return withoutOrigin;
  }
}

export function useGameStartupPreload() {
  const { active, progress, loaded, total, item, errors } = useProgress();
  const hasStartedRef = useRef(false);
  const [idleGracePassed, setIdleGracePassed] = useState(false);
  const [hasSeenTrackedLoading, setHasSeenTrackedLoading] = useState(false);
  const [hasReleased, setHasReleased] = useState(false);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;
    startGameAssetPreload();
    const timeoutId = window.setTimeout(() => {
      setIdleGracePassed(true);
    }, PRELOAD_IDLE_GRACE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const hasTrackedLoading = active || total > 0 || loaded > 0;
  const trackedLoadingEver = hasSeenTrackedLoading || hasTrackedLoading;

  useEffect(() => {
    if (!hasTrackedLoading || hasSeenTrackedLoading) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setHasSeenTrackedLoading(true);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [hasSeenTrackedLoading, hasTrackedLoading]);

  const percent = useMemo(() => {
    if (!trackedLoadingEver) {
      return idleGracePassed ? 100 : 0;
    }
    if (total > 0) {
      return Math.max(0, Math.min(100, (loaded / total) * 100));
    }
    return Math.max(0, Math.min(100, progress));
  }, [
    trackedLoadingEver,
    idleGracePassed,
    loaded,
    progress,
    total,
  ]);

  const releaseCandidate = useMemo(() => {
    if (!trackedLoadingEver) {
      return idleGracePassed;
    }
    return !active && (total === 0 || loaded >= total);
  }, [active, idleGracePassed, loaded, total, trackedLoadingEver]);

  useEffect(() => {
    if (hasReleased || !releaseCandidate) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setHasReleased(true);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [hasReleased, releaseCandidate]);

  const isReady = hasReleased || releaseCandidate;

  return {
    isReady,
    percent,
    loaded,
    total,
    itemLabel: item ? toItemLabel(item) : null,
    errorCount: errors.length,
  };
}

export function GameStartupLoadingScreen({
  percent,
  loaded,
  total,
  itemLabel,
}: {
  percent: number;
  loaded: number;
  total: number;
  itemLabel: string | null;
}) {
  const roundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  const hasTrackedCounts = total > 0 || loaded > 0;

  return (
    <div className="ui-nonselectable fixed inset-0 z-50 flex items-center justify-center bg-slate-950 px-6 text-cyan-50">
      <div className="w-full max-w-xl rounded-2xl border border-cyan-300/30 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
          Rings
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-cyan-50">
          Loading assets
        </h1>
        <p className="mt-2 text-sm text-cyan-100/80">
          Preparing world, characters, audio, and effects.
        </p>
        <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-cyan-900/45">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-cyan-300 transition-[width] duration-150"
            style={{ width: `${roundedPercent}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-cyan-100/85">
          <span>{roundedPercent}%</span>
          <span>
            {hasTrackedCounts ? `${loaded}/${total}` : "Initializing"}
          </span>
        </div>
        <p className="mt-2 truncate text-xs text-cyan-200/70">
          {itemLabel ?? "Preparing startup assets..."}
        </p>
      </div>
    </div>
  );
}
