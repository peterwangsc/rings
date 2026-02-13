"use client";

import { RotateCw } from "lucide-react";

const SPLASH_CONTROLS: ReadonlyArray<{
  keys: readonly string[];
  action: string;
}> = [
  { keys: ["W", "A", "S", "D"], action: "Move" },
  { keys: ["Space"], action: "Jump" },
  { keys: ["Shift"], action: "Hold for walk/run" },
  { keys: ["CapsLock"], action: "Toggle walk/run" },
  { keys: ["V"], action: "Toggle camera mode" },
  { keys: ["H", "J"], action: "Happy and sad emotes" },
  { keys: ["F"], action: "Toggle FPS overlay" },
  { keys: ["Esc"], action: "Unlock pointer" },
];

export function DesktopSplashOverlay({
  isPointerLocked,
  isSplashDismissedByTouch,
}: {
  isPointerLocked: boolean;
  isSplashDismissedByTouch: boolean;
}) {
  if (isPointerLocked || isSplashDismissedByTouch) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30 hidden overflow-hidden jump-overlay-copy xl:block">
      <div className="jump-scrim absolute inset-0" />
      <div className="jump-splash absolute inset-0" />
      <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-8">
        <div className="jump-splash-panel w-full max-w-5xl rounded-3xl p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-cyan-100/90 sm:text-sm">
                Character Rig Sandbox
              </p>
              <div className="relative mt-2">
                <p className="jump-logo-glow absolute left-[0.03em] top-[0.06em] text-5xl uppercase tracking-[0.1em] sm:text-7xl lg:text-8xl">
                  Jump Man
                </p>
                <h1 className="jump-logo relative text-5xl uppercase tracking-[0.1em] sm:text-7xl lg:text-8xl">
                  Jump Man
                </h1>
              </div>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-cyan-50 sm:text-base">
                Click anywhere to lock in and drop into the scene.
              </p>
              <div className="mt-7 inline-flex items-center gap-3 rounded-full border border-cyan-100/65 bg-cyan-100/14 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-50">
                <span className="jump-cta-pulse inline-block h-2.5 w-2.5 rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(149,242,255,0.9)]" />
                Click to start
              </div>
            </div>
            <div className="w-full max-w-xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/85 sm:text-sm">
                Controls
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SPLASH_CONTROLS.map(({ keys, action }) => (
                  <div
                    key={action}
                    className="jump-control-card rounded-xl px-3 py-2.5"
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {keys.map((keyLabel) => (
                        <span
                          key={`${action}-${keyLabel}`}
                          className="jump-keycap inline-flex rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-50/95 sm:text-[11px]"
                        >
                          {keyLabel}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-cyan-50/92 sm:text-xs">
                      {action}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileOrientationOverlay() {
  return (
    <div className="mobile-portrait-lock jump-overlay-copy absolute inset-0 z-50 items-center justify-center px-5 py-8 text-center">
      <div className="mobile-portrait-lock__scrim absolute inset-0" />
      <div className="mobile-portrait-lock__panel relative w-full max-w-sm rounded-2xl px-6 py-7">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/85">
          Orientation Required
        </p>
        <div className="mt-4 flex justify-center">
          <div className="mobile-portrait-lock__device-frame">
            <RotateCw
              aria-hidden="true"
              className="mobile-portrait-lock__rotation-icon"
            />
            <div className="mobile-portrait-lock__device-notch" />
          </div>
        </div>
        <h2 className="mt-5 text-2xl font-semibold uppercase tracking-[0.12em] text-cyan-50">
          Rotate To Landscape
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-cyan-50/92">
          This experience is optimized for a wide screen. Rotate your device to
          continue.
        </p>
      </div>
    </div>
  );
}
