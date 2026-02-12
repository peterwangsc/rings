"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils } from "three";

const FPS_UPDATE_INTERVAL_SECONDS = 0.35;
const FPS_SMOOTHING_FACTOR = 0.45;

export function FrameRateProbe({
  onUpdate,
}: {
  onUpdate: (fps: number) => void;
}) {
  const elapsedRef = useRef(0);
  const frameCountRef = useRef(0);
  const smoothedFpsRef = useRef<number | null>(null);

  useFrame((_, delta) => {
    if (delta <= 0) {
      return;
    }

    elapsedRef.current += delta;
    frameCountRef.current += 1;

    if (elapsedRef.current < FPS_UPDATE_INTERVAL_SECONDS) {
      return;
    }

    const sampledFps = frameCountRef.current / elapsedRef.current;
    const previousSmoothedFps = smoothedFpsRef.current;
    const smoothedFps =
      previousSmoothedFps === null
        ? sampledFps
        : MathUtils.lerp(previousSmoothedFps, sampledFps, FPS_SMOOTHING_FACTOR);
    smoothedFpsRef.current = smoothedFps;
    onUpdate(smoothedFps);
    elapsedRef.current = 0;
    frameCountRef.current = 0;
  });

  return null;
}
