# Rings Rewrite Foundation Plan

> Status (2026-02-14): Historical reference only.
>
> Active implementation now runs through V1 using:
> - `docs/v1-multiplayer-platform-plan.md`
> - `app/`
> - `spacetimedb/`
>
> Use this document only for salvage ideas that can be backported safely into V1.

## Goal

Rewrite the game into a durable architecture where:

1. Simulation rules are deterministic and shared between client prediction and server authority.
2. Rendering is a projection of state, not the owner of gameplay logic.
3. Networking is explicit command/event flow, not ad-hoc side effects in scene components.
4. Files are organized by runtime responsibility (sim, render, net, content) rather than feature sprawl.

This plan is incremental and leverages the current codebase so the game stays playable during migration.

## Target Structure

```text
/apps
  /web
    /src/game
      /bootstrap
      /runtime
      /sim
      /render
      /net
      /world
      /ui
      /config
  /server
    /src
      /reducers
      /systems
      /validation
      /bootstrap
/packages
  /core
    /src
      /math
      /terrain
      /gameplay
      /loop
  /protocol
    /src
      commands.ts
      snapshots.ts
      events.ts
  /content
    /src
      movement.ts
      camera.ts
      world.ts
      rings.ts
      goombas.ts
      lighting.ts
```

## High-Level Runtime Ownership

- `packages/core`: pure rules and deterministic stepping (no React, no Three, no Spacetime types).
- `apps/server`: authoritative reducer handlers and world lifecycle systems.
- `apps/web/src/game/sim`: client prediction, interpolation, reconciliation.
- `apps/web/src/game/render`: Three/R3F scene/layers that read sim state only.
- `apps/web/src/game/net`: protocol adapters and inbound/outbound buffering.
- `packages/content`: tuneables and content definitions (constants split by domain).

## Foundation Game Loop

### Client frame loop

```ts
frame(dtRender):
  input.captureFrame()
  net.pullInbound()

  accumulator += dtRender
  while accumulator >= FIXED_DT:
    sim.applyInputCommands(input.consumeForStep())
    sim.applyInboundEvents(net.consumeForStep())
    sim.step(FIXED_DT)
    sim.reconcile()
    if netTick.ready():
      net.sendPlayerSnapshot(sim.localSnapshot())
    accumulator -= FIXED_DT

  alpha = accumulator / FIXED_DT
  renderState = sim.interpolate(alpha)
  renderer.draw(renderState)
  ui.update(renderState, net.status)
```

### Server authority loop

```ts
onReducer(command):
  validate(command)
  apply(command)
  worldTick.advanceBounded()
  systems.tickGoombas()
  systems.pruneExpiredRows()
  publish()
```

## Step-by-Step Rewrite Plan

## Phase 0 - Baseline and Safety Rails

### Work

1. Freeze behavior with a baseline branch and perf captures (FPS, memory, network row counts).
2. Tighten lint scope so `npm run lint` is actionable for product code only.
3. Add a minimal `docs/rewrite-checklist.md` with pass/fail gates per phase.

### Leverage from current code

- Existing FPS probe: `app/scene/FrameRateProbe.tsx`
- Existing diagnostics counters: `app/multiplayer/state/useMultiplayerSync.ts`
- ESLint entry point: `eslint.config.mjs`

### Exit criteria

- Lint failures are only in active app/server code.
- Baseline metrics recorded for side-by-side comparison later.

## Phase 1 - Extract Shared Core Rules

### Work

1. Create `packages/core/src`.
2. Move pure math, terrain, and simulation helpers into `core`.
3. Keep wrappers in current paths that re-export from `core` to avoid breakage during migration.

### First extraction targets

- `app/utils/math.ts` -> `packages/core/src/math/angles.ts`
- `app/utils/terrain.ts` -> `packages/core/src/terrain/terrainSampler.ts`
- Fireball simulation logic:
  - `app/gameplay/abilities/fireballSim.ts`
  - `app/gameplay/abilities/fireballManager.ts`
  -> `packages/core/src/gameplay/fireballs/*`
- Motion resolution:
  - `app/utils/physics.ts`
  -> `packages/core/src/gameplay/movementRules.ts`

### Exit criteria

- Web app compiles using `core` imports for these modules.
- No gameplay behavior drift in movement/jump/fireball basic flow.

## Phase 2 - Introduce Protocol Package

### Work

1. Create `packages/protocol/src/{commands,snapshots,events}.ts`.
2. Define stable DTOs for:
  - player snapshot command
  - fireball cast command
  - ring collect command
  - goomba hit command
  - chat send command
3. Replace duplicated ad-hoc payload types in client/server with protocol imports.

### Leverage from current code

- Client types: `app/multiplayer/state/multiplayerTypes.ts`
- Reducer payloads: `spacetimedb/src/index.ts`

### Exit criteria

- All reducer payload shapes are imported from `packages/protocol`.
- Client send methods and server reducers use the same protocol types.

## Phase 3 - Server Decomposition (SpacetimeDB Module)

### Work

1. Split `spacetimedb/src/index.ts` into:
  - `schema.ts`
  - `reducers/*.ts`
  - `systems/{worldTick,goombaAi,ringDropLifecycle}.ts`
  - `validation/{playerValidation,fireballValidation}.ts`
  - `bootstrap/seedWorld.ts`
2. Add monotonic `lastInputSeq` enforcement in player upsert validation.
3. Keep behavior identical except explicit bug fixes approved in checklist.

### Leverage from current code

- Existing reducer logic all in `spacetimedb/src/index.ts`

### Exit criteria

- Generated bindings unchanged except intended type cleanup.
- Server behavior parity verified for movement, ring collect, fireball cast, goomba hit.

## Phase 4 - Client Runtime Shell and Fixed-Step Loop

### Work

1. Create `apps/web/src/game/runtime/{GameRuntime,FixedStepClock}.ts`.
2. Move frame orchestration out of R3F-heavy component body into runtime layer.
3. Keep `CharacterRigController` as adapter until systems are fully moved.

### Leverage from current code

- Current frame authority: `app/controller/CharacterRigController.tsx`
- Camera math: `app/camera/cameraRig.ts`

### Exit criteria

- One explicit fixed-step orchestrator owns simulation order.
- Render components consume state snapshots instead of mutating gameplay state directly.

## Phase 5 - Simulation Systems Split

### Work

1. Build `apps/web/src/game/sim/systems`:
  - `InputSystem`
  - `MovementSystem`
  - `AbilitySystem`
  - `ProjectileSystem`
  - `RingCollectSystem`
  - `GoombaInteractionSystem`
  - `ReconciliationSystem`
2. Move system logic out of `CharacterRigController` in slices.
3. Keep a compatibility adapter that maps old refs to new sim state each step.

### Leverage from current code

- Main logic source: `app/controller/CharacterRigController.tsx`

### Exit criteria

- `CharacterRigController` becomes mostly binding/wiring layer.
- Most game logic resides in plain TS sim systems.

## Phase 6 - Render Layer Refactor

### Work

1. Create `apps/web/src/game/render/layers/*`.
2. Move visual-only concerns from gameplay components into render layers.
3. Replace tree rendering path with batched/instanced path as default.

### Leverage from current code

- Fireball visuals: `app/gameplay/abilities/FireballRenderLayer.tsx`
- Goomba visuals: `app/gameplay/goombas/GoombaLayer.tsx`
- World chunks: `app/scene/world/ChunkContent.tsx`
- Existing batched tree tooling:
  - `app/vegetation/trees/TreeField.tsx`
  - `app/vegetation/trees/rendering/createTreeBatches.ts`

### Exit criteria

- Render layers do not own gameplay state transitions.
- Scene draw-call and frame-time metrics improve or hold steady.

## Phase 7 - Networking Bridge Refactor

### Work

1. Create `apps/web/src/game/net/{InboundEventQueue,OutboundCommandBuffer,ReplicationBridge}.ts`.
2. Move transient queue behavior out of store cloning logic.
3. Use selector-style subscriptions for multiplayer domains (players/goombas/chat/rings).

### Leverage from current code

- Sync hook: `app/multiplayer/state/useMultiplayerSync.ts`
- Store implementation: `app/multiplayer/state/multiplayerStore.ts`
- Client connection: `app/multiplayer/spacetime/client.ts`

### Exit criteria

- No enqueue-then-immediate-consume store churn.
- Fewer React invalidations at multiplayer tick cadence.

## Phase 8 - World and Chunk Runtime Split

### Work

1. Move chunk streaming/cache orchestration into `game/world`.
2. Keep geometry/material generation in render domain.
3. Add bounded worker-backed precompute path for chunk decoration generation.

### Leverage from current code

- World manager: `app/scene/world/worldEntityManager.ts`
- Chunk cache: `app/scene/world/chunkDataCache.ts`
- Placements and grass generation:
  - `app/scene/world/placements.ts`
  - `app/scene/world/grassField.ts`

### Exit criteria

- World streamer owns chunk lifecycle explicitly.
- No gameplay state in render chunk components.

## Phase 9 - UI and UX Isolation

### Work

1. Move HUD/chat/splash into `apps/web/src/game/ui`.
2. Consume readonly view-models from runtime, not raw store internals.
3. Keep pointer-lock/chat focus policy in one `InputModeController`.

### Leverage from current code

- `app/hud/GameHUD.tsx`
- `app/hud/ChatOverlay.tsx`
- `app/hud/GlobalChatFeed.tsx`
- `app/scene/SceneOverlays.tsx`

### Exit criteria

- UI can be modified without touching sim systems.
- Chat and pointer-lock edge cases are covered by focused tests.

## Phase 10 - Cutover and Cleanup

### Work

1. Remove compatibility adapters and old paths.
2. Move shared constants into `packages/content`.
3. Archive deprecated files and update AGENTS/README docs for new map.

### Exit criteria

- New structure is default.
- Legacy paths removed or thinly aliased with deprecation markers.

## Current-to-Target File Mapping (Initial)

| Current path | Target path |
| --- | --- |
| `app/controller/CharacterRigController.tsx` | `apps/web/src/game/sim/systems/*` + `apps/web/src/game/runtime/GameRuntime.ts` |
| `app/gameplay/abilities/fireballManager.ts` | `packages/core/src/gameplay/fireballs/FireballManager.ts` |
| `app/gameplay/abilities/fireballSim.ts` | `packages/core/src/gameplay/fireballs/fireballStep.ts` |
| `app/utils/physics.ts` | `packages/core/src/gameplay/movementRules.ts` |
| `app/utils/terrain.ts` | `packages/core/src/terrain/terrainSampler.ts` |
| `app/multiplayer/state/useMultiplayerSync.ts` | `apps/web/src/game/net/ReplicationBridge.ts` |
| `app/multiplayer/state/multiplayerStore.ts` | `apps/web/src/game/net/domainStores/*` |
| `spacetimedb/src/index.ts` | `apps/server/src/{schema,reducers,systems,validation,bootstrap}/*` |
| `app/scene/world/worldEntityManager.ts` | `apps/web/src/game/world/WorldIndex.ts` |
| `app/scene/world/chunkDataCache.ts` | `apps/web/src/game/world/ChunkCache.ts` |
| `app/scene/world/ChunkContent.tsx` | `apps/web/src/game/render/layers/TerrainLayer.tsx` |
| `app/gameplay/goombas/GoombaLayer.tsx` | `apps/web/src/game/render/layers/GoombaLayer.tsx` |
| `app/gameplay/collectibles/RingField.tsx` | `apps/web/src/game/render/layers/RingLayer.tsx` |
| `app/hud/*` | `apps/web/src/game/ui/*` |

## Recommended PR Sequence

1. PR-01: Lint scope cleanup and baseline metrics doc.
2. PR-02: Add `packages/core` and migrate math/terrain pure helpers.
3. PR-03: Add `packages/protocol` and migrate payload types.
4. PR-04: Split server reducers/systems with behavior parity.
5. PR-05: Introduce client `GameRuntime` fixed-step shell.
6. PR-06+: Migrate one sim subsystem per PR from controller monolith.
7. PR-final: Remove adapters and legacy paths.

## Non-Negotiable Invariants During Migration

1. Server remains authoritative for multiplayer game state.
2. Client prediction never bypasses server validation rules.
3. Any gameplay rule change is implemented in shared core first.
4. No phase ends with undocumented behavior drift.
5. Each phase ships with a rollback path.
