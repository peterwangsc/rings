"use client";

import { X } from "lucide-react";

export interface OnlineLeaderboardEntry {
  identity: string;
  displayName: string;
  ringCount: number;
  highestRingCount: number;
}

export interface AllTimeLeaderboardEntry {
  identity: string;
  displayName: string;
  highestRingCount: number;
}

export function LeaderboardOverlay({
  isVisible,
  onlineEntries,
  allTimeEntries,
  onClose,
}: {
  isVisible: boolean;
  onlineEntries: readonly OnlineLeaderboardEntry[];
  allTimeEntries: readonly AllTimeLeaderboardEntry[];
  onClose: () => void;
}) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="ui-nonselectable pointer-events-auto absolute left-1/2 top-5 w-[min(64rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-cyan-100/35 bg-black/72 p-3 text-cyan-50 shadow-[0_18px_55px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-4"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="mb-3 flex items-center justify-between border-b border-cyan-200/20 pb-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/90">
            Leaderboard
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close leaderboard"
            className="pointer-events-auto rounded border border-cyan-200/35 px-2 py-1 text-[10px] tracking-[0.1em] text-cyan-100/90 transition hover:bg-cyan-100/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-cyan-200/20 bg-black/40 p-2.5 sm:p-3">
            <p className="mb-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/85">
              Online
            </p>
            {onlineEntries.length > 0 ? (
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-10" />
                  <col />
                  <col className="w-20" />
                  <col className="w-20" />
                </colgroup>
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.12em] text-cyan-100/55">
                    <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                      Rank
                    </th>
                    <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                      Name
                    </th>
                    <th className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                      Rings
                    </th>
                    <th className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                      Best
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {onlineEntries.map((entry, index) => (
                    <tr
                      key={entry.identity}
                      className="border-t border-cyan-100/10 bg-cyan-100/[0.04] text-[12px]"
                    >
                      <td className="px-2 py-1.5 font-semibold text-cyan-100/85 whitespace-nowrap">
                        {index + 1}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block truncate whitespace-nowrap text-cyan-50">
                          {entry.displayName}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-cyan-100/90 whitespace-nowrap">
                        {entry.ringCount}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-cyan-100/90 whitespace-nowrap">
                        {entry.highestRingCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-md bg-cyan-100/[0.04] px-2 py-2 text-[12px] text-cyan-100/65">
                No players online.
              </p>
            )}
          </section>
          <section className="overflow-hidden rounded-xl border border-cyan-200/20 bg-black/40 p-2.5 sm:p-3">
            <p className="mb-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/85">
              All Time
            </p>
            {allTimeEntries.length > 0 ? (
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-10" />
                  <col />
                  <col className="w-20" />
                </colgroup>
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.12em] text-cyan-100/55">
                    <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                      Rank
                    </th>
                    <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                      Name
                    </th>
                    <th className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                      Best
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allTimeEntries.map((entry, index) => (
                    <tr
                      key={entry.identity}
                      className="border-t border-cyan-100/10 bg-cyan-100/[0.04] text-[12px]"
                    >
                      <td className="px-2 py-1.5 font-semibold text-cyan-100/85 whitespace-nowrap">
                        {index + 1}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block truncate whitespace-nowrap text-cyan-50">
                          {entry.displayName}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-cyan-100/90 whitespace-nowrap">
                        {entry.highestRingCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-md bg-cyan-100/[0.04] px-2 py-2 text-[12px] text-cyan-100/65">
                No historical entries yet.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
