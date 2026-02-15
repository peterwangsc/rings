# V1 Multiplayer Platform Plan

This document defines the active engineering roadmap for improving multiplayer architecture within V1 (`app/` + `spacetimedb/`) while preserving current gameplay behavior.

## Mission

- Keep V1 as the only shipping target.
- Improve architecture incrementally without destabilizing gameplay.
- Backport proven ideas from `v2/` only when they are low-risk and measurable improvements.

## Working Model

- Prefer in-place modularization over rewrites.
- Treat behavior parity in V1 as a non-negotiable constraint.
- Land small, reversible changes with validation evidence.

## V2 Salvage Policy

Adopt:
- Deterministic pure helpers for gameplay/math/terrain logic.
- Explicit command/event payload contracts.
- Clear reducer/system/validation boundaries in SpacetimeDB module code.
- Reliability diagnostics and alert semantics that expose real operator risk.

Avoid:
- React-driven per-frame runtime snapshots in the critical render path.
- Expensive procedural regeneration tied to unstable render-state identities.
- Phase completion gates that pass with severe FPS regressions.

## Roadmap (Living Checklist)

Status legend:
- `[ ]` not started
- `[~]` in progress
- `[x]` complete
- `[!]` blocked

### Phase 0: Governance and Baseline

- [x] Pivot repo instructions and process docs to V1-first execution.
- [ ] Capture fresh V1 baseline metrics (desktop/mobile FPS, memory trend, row/event volumes) with reproducible scripts.
- [ ] Define explicit performance budgets and fail thresholds for parity/stability gates.

### Phase 1: Server Module Decomposition (In V1)

- [x] Split `spacetimedb/src/index.ts` into `schema`, `reducers`, `systems`, `validation`, `bootstrap` modules.
- [x] Keep reducer behavior unchanged during the split (no gameplay drift).
- [x] Add focused reducer-level validation helpers with shared constants.

### Phase 2: Protocol Contract Consolidation (In V1)

- [x] Create/organize explicit protocol contract types under `app/multiplayer/protocol/`.
- [x] Remove duplicated payload shape definitions between client and server-facing code.
- [x] Add contract sanity checks at command dispatch boundaries.

### Phase 3: Client Networking Ownership Cleanup

- [ ] Separate inbound ingestion, reconciliation, and outbound dispatch responsibilities in V1 net code.
- [ ] Replace broad state churn paths with domain-focused selectors/update paths.
- [ ] Add bounded queue/backlog telemetry for command/event flow.

### Phase 4: Reliability and Observability

- [ ] Add runtime health summary (connection, command outcomes, backlog, authority visibility).
- [ ] Add domain-level reliability counters for abilities/rings/goombas/chat.
- [ ] Add alert thresholds with clear operator actions.

### Phase 5: Render/Runtime Performance Guardrails

- [ ] Add guardrails against per-frame allocations in critical loops.
- [ ] Ensure heavy world/procedural generation is cached and not re-triggered by unrelated UI updates.
- [ ] Add a repeatable perf smoke run that fails on major FPS regression.

### Phase 6: Validation and Regression Automation

- [ ] Create deterministic multiplayer regression scenarios (movement/fireball/rings/goombas/chat/day-cycle).
- [ ] Ensure validation runs start from clean DB state.
- [ ] Produce artifact outputs with pass/fail criteria that include performance gates.

## Session Workflow

For each implementation session:
1. Pick one unchecked roadmap item and mark it `[~]`.
2. Implement in V1 paths only (`app/`, `spacetimedb/`) unless explicitly requested otherwise.
3. Validate with relevant checks.
4. Mark `[x]` only when code + validation are complete, otherwise mark `[!]` with blocker + next action.
5. Append a dated progress entry with files changed and validation outcomes.

## Validation Commands (Default)

```bash
npm run lint
npm run build
```

For multiplayer/server-affecting changes, also run:

```bash
npm run multiplayer:db:start
npm run multiplayer:db:publish
npm run multiplayer:db:generate
```

## Progress Log

### 2026-02-14

- Established V1-first architecture direction and execution framework.
- Added this roadmap/checklist to govern incremental multiplayer platform improvements in V1.
- Updated top-level agent instructions and process docs to keep active implementation work in V1.
- Validation: documentation/process update only (no runtime code changes).
- Completed Phase 1 server decomposition in V1 by splitting `spacetimedb/src/index.ts` into `schema`, `bootstrap`, `reducers`, `systems`, `validation`, and `shared` modules while preserving reducer contracts and semantics.
- Added reducer-focused shared validation helpers for numeric payload checks, fireball range checks, motion/goomba state sanitization, and ring count normalization.
- Files changed: `spacetimedb/src/index.ts`, `spacetimedb/src/schema.ts`, `spacetimedb/src/bootstrap/init.ts`, `spacetimedb/src/bootstrap/seedGoombas.ts`, `spacetimedb/src/reducers/*`, `spacetimedb/src/systems/*`, `spacetimedb/src/shared/*`, `spacetimedb/src/validation/reducerValidation.ts`.
- Validation: `npm run build` (pass), `npm run multiplayer:db:publish` (pass), `npm run multiplayer:db:generate` (pass), `npx eslint spacetimedb/src/**/*.ts` (pass), `npm run lint` (fails on pre-existing unrelated lint errors in `docs/*`, `.next/*`, and `v2/*` generated/artifact paths).
- Completed Phase 2 protocol consolidation by adding explicit command contract types in `app/multiplayer/protocol/commands.ts`, central sanity guards in `app/multiplayer/protocol/sanity.ts`, and shared exports in `app/multiplayer/protocol/index.ts`.
- Replaced duplicated inline reducer payload shapes in V1 client networking (`app/multiplayer/state/multiplayerTypes.ts`, `app/multiplayer/state/useMultiplayerSync.ts`, `app/controller/controllerTypes.ts`) with protocol command types derived from generated SpacetimeDB contracts.
- Added dispatch-boundary contract checks for `upsert_player_state`, `cast_fireball`, `collect_ring`, `hit_goomba`, and `send_chat_message` in `app/multiplayer/state/useMultiplayerSync.ts`; invalid commands are dropped with dev-only warnings.
- Files changed: `app/multiplayer/protocol/*`, `app/multiplayer/state/multiplayerTypes.ts`, `app/multiplayer/state/useMultiplayerSync.ts`, `app/controller/controllerTypes.ts`, `spacetimedb/src/systems/goombas.ts`.
- Validation: `npx eslint app/multiplayer/protocol/**/*.ts app/multiplayer/state/multiplayerTypes.ts app/multiplayer/state/useMultiplayerSync.ts app/controller/controllerTypes.ts spacetimedb/src/systems/goombas.ts` (pass), `npx tsc --noEmit -p spacetimedb/tsconfig.json` (pass), `npm run build` (pass), `npm run multiplayer:db:publish` (pass), `npm run multiplayer:db:generate` (pass). Repo-wide `npx tsc --noEmit` remains failing on pre-existing root/V2 issues unrelated to this phase.

### 2026-02-15

- User-directed V1 gameplay animation reset: rewrote `app/gameplay/goombas/GoombaLayer.tsx` from scratch to use rig-only procedural animation (alternating left/right foot vertical motion plus subtle body bob), removing prior mixer/death/blink animation paths.
- Updated Goomba facing to align with forward movement direction each frame (with smooth yaw interpolation), with fallback to server yaw when stationary.
- Validation: `npx eslint app/gameplay/goombas/GoombaLayer.tsx` (pass), `npm run build` (pass).
- Added foundational blink and death animation rewrites on top of the new rig-driven Goomba base: blink uses damage-eye node visibility pulses with randomized intervals; death uses a simple sink/tilt/squash timeline with hide delay while `state === defeated`.
- Kept facing/movement animation ownership in one place and did not reintroduce clip/mixer animation paths.
- Validation: `npx eslint app/gameplay/goombas/GoombaLayer.tsx` (pass), `npm run build` (pass).
- Updated death style per gameplay direction: removed tilt/fall motion and switched to Mario-style sequence (squish with closed eyelids, then short `drei` cloud poof that rises and fades out).
- Validation: `npx eslint app/gameplay/goombas/GoombaLayer.tsx` (pass), `npm run build` (pass).
- Reworked Goomba server movement to a controller-style loop (`spacetimedb/src/systems/movementController.ts`) that applies keyboard/mouse-like inputs (forward/right axes + look yaw) instead of direct position chasing.
- Replaced `charge/cooldown` behavior with `idle/enraged` behavior in `spacetimedb/src/systems/goombas.ts`: idle now performs deterministic random-walk segments with a spawn leash; enraged locks run direction toward the target at run start and keeps that heading for a fixed run duration before reacquiring.
- State flips now follow enrage radius presence rules (`idle -> enraged` on enter, `enraged -> idle` on exit), while preserving hit/spill/defeat/respawn flows.
- Added migration-safe state remaps so legacy rows/clients still function (`charge -> enraged`, `cooldown -> idle`) across `spacetimedb/src/validation/reducerValidation.ts` and `app/multiplayer/state/useMultiplayerSync.ts`.
- Validation: `npx eslint spacetimedb/src/systems/goombas.ts spacetimedb/src/systems/movementController.ts spacetimedb/src/reducers/hitGoomba.ts spacetimedb/src/bootstrap/seedGoombas.ts spacetimedb/src/validation/reducerValidation.ts app/multiplayer/state/multiplayerTypes.ts app/multiplayer/state/useMultiplayerSync.ts` (pass), `npm run build` (pass), `npm run multiplayer:db:publish` (pass), `npm run multiplayer:db:generate` (pass).
- Removed non-working procedural foot/body rig deformation from `app/gameplay/goombas/GoombaLayer.tsx` and kept only server-driven movement, facing, blink, and death-poof visuals while preparing for Blender-authored clips.
- Restored explicit enrage phases in server state (`idle -> charge -> enraged -> cooldown`) with longer pacing and farther activation distance (`GOOMBA_ENRAGE_RADIUS`, `GOOMBA_RUN_DURATION_MS`, `GOOMBA_COOLDOWN_DURATION_MS`) so runs travel farther and pauses are readable.
- Eliminated phase jitter by locking yaw within `charge` and `cooldown` and only reorienting on phase transitions (`setChargeState`, `startEnragedRun`, `setCooldownState`).
- Updated multiplayer goomba state contract back to include `charge`/`cooldown` (`app/multiplayer/state/multiplayerTypes.ts`, `app/multiplayer/state/useMultiplayerSync.ts`) and aligned sanitizer behavior in `spacetimedb/src/validation/reducerValidation.ts`.
- Validation: `npx eslint app/gameplay/goombas/GoombaLayer.tsx spacetimedb/src/shared/constants.ts spacetimedb/src/systems/goombas.ts spacetimedb/src/validation/reducerValidation.ts app/multiplayer/state/multiplayerTypes.ts app/multiplayer/state/useMultiplayerSync.ts` (pass), `npx tsc --noEmit -p spacetimedb/tsconfig.json` (pass), `npm run build` (pass), `npm run multiplayer:db:publish` (pass), `npm run multiplayer:db:generate` (pass).
