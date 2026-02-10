# Tree System Rip-and-Replace Plan (Stylized Low-Poly, Mobile-Safe)

## Summary
Replace the current inline recursive tree builder with a modular tree-generation pipeline that uses:
1. Blue-noise placement (Poisson disk) for stable, natural distribution.
2. Space-colonization skeleton growth with resource-inspired radius solving.
3. Multi-LOD batched rendering optimized for desktop + mobile 60 FPS.
4. Clear separation of generation, meshing, rendering, and config for extensibility.

This is a **big-bang replacement** (remove old tree path in one PR).

Research basis:
- Space colonization for realistic branch competition: [Runions et al. 2007](http://algorithmicbotany.org/papers/colonization.egwnp2007.large.pdf)
- Self-organizing biological growth concepts (apical dominance/light competition): [Palubicki et al. 2009](https://algorithmicbotany.org/papers/selforg.sig2009.pdf)
- Modern game-ready modular/LOD procedural pipeline: [Clasping Trees 2022](https://dl.acm.org/doi/pdf/10.1145/3558530.3558722)
- Recent ML tree generation direction (not practical here without training/data pipeline): [DeepTree 2023](https://arxiv.org/abs/2309.05730), [Autoregressive Trees 2025](https://arxiv.org/abs/2507.05523)
- Placement quality/perf standard: [Bridson Poisson Disk 2007](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf)
- Runtime batching/culling primitives in Three.js: [BatchedMesh docs](https://threejs.org/docs/pages/BatchedMesh.html), [LOD docs](https://threejs.org/docs/pages/LOD.html)

Inference from sources: for this repo’s constraints (no training pipeline, static scene, mobile target), a hybrid procedural approach is the current practical standard over end-to-end neural generation.

## Scope
In scope:
1. Replace all tree generation/rendering logic currently embedded in `/Users/peterwang/code/rings/app/scene/WorldGeometry.tsx`.
2. Move tree code to dedicated modules.
3. Keep trees statically generated at scene init.
4. Keep stylized low-poly look and current world integration behavior.

Out of scope:
1. Runtime growth simulation.
2. Tree physics colliders.
3. Dataset/training-based ML tree synthesis pipeline.

## File Organization (Final Structure)
Create:
1. `/Users/peterwang/code/rings/app/vegetation/trees/types.ts`
2. `/Users/peterwang/code/rings/app/vegetation/trees/treeConfig.ts`
3. `/Users/peterwang/code/rings/app/vegetation/trees/TreeField.tsx`
4. `/Users/peterwang/code/rings/app/vegetation/trees/generation/poissonPlacement.ts`
5. `/Users/peterwang/code/rings/app/vegetation/trees/generation/spaceColonization.ts`
6. `/Users/peterwang/code/rings/app/vegetation/trees/generation/radiusSolver.ts`
7. `/Users/peterwang/code/rings/app/vegetation/trees/meshing/branchMesher.ts`
8. `/Users/peterwang/code/rings/app/vegetation/trees/meshing/canopyMesher.ts`
9. `/Users/peterwang/code/rings/app/vegetation/trees/meshing/buildArchetypes.ts`
10. `/Users/peterwang/code/rings/app/vegetation/trees/rendering/treeMaterials.ts`
11. `/Users/peterwang/code/rings/app/vegetation/trees/rendering/createTreeBatches.ts`
12. `/Users/peterwang/code/rings/app/vegetation/trees/rendering/lodController.ts`
13. `/Users/peterwang/code/rings/app/vegetation/trees/index.ts`

Modify:
1. `/Users/peterwang/code/rings/app/scene/WorldGeometry.tsx`
2. `/Users/peterwang/code/rings/app/utils/constants.ts`
3. `/Users/peterwang/code/rings/AGENTS.md`

Delete old inline tree implementation from `/Users/peterwang/code/rings/app/scene/WorldGeometry.tsx` (trunk/branch/foliage `useMemo`, refs, per-instance setup effects, and local tree-only constants).

## Public APIs / Interfaces / Types
Add and treat as internal public interfaces for tree subsystem:

1. `TreeSystemConfig` in `/Users/peterwang/code/rings/app/vegetation/trees/types.ts`
2. `TreeSpeciesPreset` in `/Users/peterwang/code/rings/app/vegetation/trees/types.ts`
3. `TerrainSampler` in `/Users/peterwang/code/rings/app/vegetation/trees/types.ts`
4. `buildTreeArchetypes(config, seed): TreeArchetype[]` in `/Users/peterwang/code/rings/app/vegetation/trees/meshing/buildArchetypes.ts`
5. `generateTreePlacements(config, terrainSampler, rockFormations): TreePlacement[]` in `/Users/peterwang/code/rings/app/vegetation/trees/generation/poissonPlacement.ts`
6. `TreeField(props: TreeFieldProps)` in `/Users/peterwang/code/rings/app/vegetation/trees/TreeField.tsx`

`TreeFieldProps`:
1. `terrainSampler` (height/slope callbacks)
2. `rockFormations`
3. `camera` optional override (default from R3F state)

## Implementation Plan (Decision-Complete)
1. Extract tree constants from `/Users/peterwang/code/rings/app/utils/constants.ts` into `/Users/peterwang/code/rings/app/vegetation/trees/treeConfig.ts` as a single `TREE_SYSTEM_CONFIG` object.
2. Implement Poisson-disk placement with constraints: field radius, clearing radius, rock clearance, max slope, and deterministic seed.
3. Implement space-colonization branch growth using attractor cloud volumes per species (round, conical, windswept stylized presets).
4. Compute branch radii bottom-up via pipe-model exponent (`gamma = 2.0`) and prune sub-threshold twigs for low-poly readability.
5. Build archetypes (12 total defaults: 3 species × 4 variants) once at init; each archetype includes LOD0/LOD1/LOD2 geometries.
6. Build stylized low-poly meshes:
   1. Branch mesher: low radial segments (LOD0: 6, LOD1: 4, LOD2: 3 trunk-only).
   2. Canopy mesher: clustered low-poly puffs from terminal branch groups (LOD2 uses minimal puff count).
7. Render via `THREE.BatchedMesh`:
   1. One batch for branches per LOD.
   2. One batch for canopy per LOD.
   3. Use `setVisibleAt` to switch LOD per tree instance.
   4. Keep `perObjectFrustumCulled = true`.
8. Add distance hysteresis and throttled LOD updates in `/Users/peterwang/code/rings/app/vegetation/trees/rendering/lodController.ts`:
   1. Update rate: 8 Hz.
   2. Distances: LOD0 `< 16m`, LOD1 `< 30m`, LOD2 `< 52m`, hidden `>= 70m`.
   3. Hysteresis band: `2.5m`.
9. Integrate `<TreeField />` into `/Users/peterwang/code/rings/app/scene/WorldGeometry.tsx`; remove old tree refs/material setup/effects and keep terrain/grass/rocks unchanged.
10. Update `/Users/peterwang/code/rings/AGENTS.md` tree sections and file map to reflect new architecture and tuning knobs.

## Defaults Chosen
1. Visual target: stylized low-poly.
2. Performance target: desktop + mobile 60 FPS.
3. Migration: big-bang replacement.
4. Simulation: static generation only.
5. Determinism: fixed global tree seed for reproducible scenes.
6. No tree colliders (behavior parity with current state).
7. Preserve current tree count default (`82`) unless perf validation fails.

## Validation and Acceptance Criteria
Functional checks:
1. Trees spawn only on valid terrain and respect clearing/rock avoidance.
2. No branch inversion or disconnected canopy clusters.
3. Camera mode cycling still works exactly as before.
4. Tree rendering disposes all geometries/material resources on unmount.

Performance checks:
1. Initial tree generation finishes under `30ms` on desktop and under `90ms` on mobile-class device.
2. Frame pacing remains stable with no visible LOD thrash while moving.
3. Draw-call count does not regress versus current implementation at equivalent view.

Visual checks:
1. Distinct species silhouettes are readable at near/mid/far distances.
2. LOD transitions do not produce obvious popping at normal movement speed.
3. Tree palette harmonizes with existing terrain/rock colors.

Repo checks:
1. `npm run lint` passes.
2. `npm run build` passes.
3. Manual playtest using existing controls from `/Users/peterwang/code/rings/AGENTS.md` passes.
