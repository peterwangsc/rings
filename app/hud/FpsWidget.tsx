"use client";

export function FpsWidget({ fps }: { fps: number | null }) {
  return (
    <div className="ui-nonselectable pointer-events-none absolute right-4 top-4 z-20 rounded-lg border border-white/35 bg-black/40 px-3 py-2 text-[11px] leading-4 text-white/95 backdrop-blur-sm">
      <p className="font-semibold tracking-wide text-white">FPS</p>
      <p>{fps ?? "--"}</p>
    </div>
  );
}
