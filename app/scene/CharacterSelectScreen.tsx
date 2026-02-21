"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { CharacterActor } from "../lib/CharacterActor";
import {
  CHARACTER_MODEL_YAW_OFFSET,
  CHARACTER_OLD_PATH,
  CHARACTER_PATH,
} from "../utils/constants";

export type CharacterModelId = "old" | "new";

const PREVIEW_OPTIONS: ReadonlyArray<{
  id: CharacterModelId;
  characterPath: string;
  ariaLabel: string;
}> = [
  {
    id: "old",
    characterPath: CHARACTER_OLD_PATH,
    ariaLabel: "Select classic character",
  },
  {
    id: "new",
    characterPath: CHARACTER_PATH,
    ariaLabel: "Select modern character",
  },
];

function CharacterPreviewCard({
  characterPath,
  isSelected,
  onClick,
  ariaLabel,
}: {
  characterPath: string;
  isSelected: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      onClick={onClick}
      className={`group relative aspect-[4/5] w-full overflow-hidden rounded-2xl border-2 bg-slate-950/60 transition ${
        isSelected
          ? "border-sky-400 shadow-[0_0_0_1px_rgba(14,165,233,0.4),0_0_26px_rgba(56,189,248,0.24)]"
          : "border-cyan-300/25 hover:border-cyan-200/55"
      }`}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.74, 1.34], fov: 34, near: 0.01, far: 12 }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 1.3, 0);
        }}
        className="h-full w-full"
      >
        <color attach="background" args={["#020617"]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[1.6, 2.2, 2.1]} intensity={1.35} />
        <directionalLight position={[-1.7, 1.2, -1.4]} intensity={0.5} />
        <Suspense fallback={null}>
          <group rotation={[0, CHARACTER_MODEL_YAW_OFFSET + Math.PI, 0]}>
            <CharacterActor characterPath={characterPath} motionState="idle" />
          </group>
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/65 to-transparent" />
      {!isSelected ? (
        <div className="pointer-events-none absolute inset-0 bg-slate-950/18 transition group-hover:bg-slate-950/8" />
      ) : null}
    </button>
  );
}

export function CharacterSelectScreen({
  selectedCharacterModelId,
  onSelectCharacterModelId,
  draftDisplayName,
  onDisplayNameChange,
  onConfirm,
}: {
  selectedCharacterModelId: CharacterModelId | null;
  onSelectCharacterModelId: (nextModelId: CharacterModelId) => void;
  draftDisplayName: string;
  onDisplayNameChange: (nextDisplayName: string) => void;
  onConfirm: () => void;
}) {
  const isSelectionReady = selectedCharacterModelId !== null;

  return (
    <div className="ui-nonselectable fixed inset-0 z-50 flex items-center justify-center bg-slate-950 px-6 text-cyan-50">
      <div className="w-full max-w-4xl rounded-2xl border border-cyan-300/30 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
          Rings
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-cyan-50">
          Choose Character
        </h1>
        <p className="mt-2 text-sm text-cyan-100/80">
          Select one model, set your name, and enter the world.
        </p>

        <form
          className="mt-5 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isSelectionReady) {
              return;
            }
            onConfirm();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            {PREVIEW_OPTIONS.map((option) => (
              <CharacterPreviewCard
                key={option.id}
                characterPath={option.characterPath}
                ariaLabel={option.ariaLabel}
                isSelected={selectedCharacterModelId === option.id}
                onClick={() => onSelectCharacterModelId(option.id)}
              />
            ))}
          </div>

          <div>
            <label
              htmlFor="character-select-display-name"
              className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/85"
            >
              Name Tag
            </label>
            <input
              id="character-select-display-name"
              name="displayName"
              type="text"
              maxLength={24}
              value={draftDisplayName}
              onChange={(event) =>
                onDisplayNameChange(event.currentTarget.value)
              }
              placeholder="Guest Name"
              className="h-10 w-full rounded-lg border border-cyan-100/40 bg-black/35 px-3 text-sm font-medium text-cyan-50 outline-none transition focus:border-cyan-100/70 focus:bg-black/45"
            />
          </div>

          <button
            type="submit"
            disabled={!isSelectionReady}
            className={`h-10 w-full rounded-lg border text-sm font-semibold uppercase tracking-[0.12em] transition ${
              isSelectionReady
                ? "border-sky-300/80 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
                : "cursor-not-allowed border-cyan-300/20 bg-slate-950/40 text-cyan-100/45"
            }`}
          >
            Play
          </button>
        </form>
      </div>
    </div>
  );
}
