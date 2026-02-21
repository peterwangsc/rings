"use client";

import type { ConnectionStatus } from "../multiplayer/state/multiplayerTypes";

export function PlayerInfoWidget({
  localDisplayName,
  connectionStatus,
  remotePlayerCount,
}: {
  localDisplayName?: string;
  connectionStatus?: ConnectionStatus;
  remotePlayerCount?: number;
}) {
  return (
    <div className="mt-2 rounded-lg border border-cyan-300/30 bg-black/40 px-3 py-2 text-[11px] text-cyan-100/95 backdrop-blur-sm">
      <p className="font-semibold tracking-wide text-cyan-100">
        {localDisplayName ?? "Guest"}
      </p>
      <p className="mt-0.5 uppercase tracking-wide text-cyan-200/90">
        {connectionStatus ?? "connecting"}
      </p>
      <p className="mt-0.5 text-cyan-100/85">
        Players: {remotePlayerCount ? remotePlayerCount + 1 : 1}
      </p>
    </div>
  );
}
