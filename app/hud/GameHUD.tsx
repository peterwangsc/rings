"use client";

import {
  type WorldEntityManager,
  useWorldEntityVersion,
} from "../scene/world/worldEntityManager";

function RingIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r="6"
        stroke="#FFD700"
        strokeWidth="2.5"
        fill="none"
      />
      <circle
        cx="9"
        cy="9"
        r="6"
        stroke="#FFA000"
        strokeWidth="1"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

export function GameHUD({
  worldEntityManager,
}: {
  worldEntityManager: WorldEntityManager;
}) {
  const worldVersion = useWorldEntityVersion(worldEntityManager);
  void worldVersion;

  const ringCount = worldEntityManager.hud.ringCount;
  const totalRings = worldEntityManager.hud.totalRings;

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-20">
      <div className="flex items-center gap-2 rounded-lg border border-yellow-400/35 bg-black/40 px-3 py-2 backdrop-blur-sm">
        <RingIcon />
        <span className="text-[13px] font-semibold leading-4 tabular-nums text-yellow-100">
          {ringCount}
          <span className="text-yellow-100/50"> / {totalRings}</span>
        </span>
      </div>
    </div>
  );
}
