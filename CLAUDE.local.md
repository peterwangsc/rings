# AGENTS.md

This file defines the operating rules for AI coding agents in this repo.

## Documentation sync rule

- `AGENTS.md` and `CLAUDE.local.md` must stay identical.
- Any change to one must be applied to the other in the same update.
- If they drift, treat `AGENTS.md` as source of truth and resync `CLAUDE.local.md` immediately.

## V1 mission (consolidation phase)

Rings V1 is in system consolidation, optimization, and tech-debt payoff.

- Primary goal: massively reduce code size and complexity while improving performance.
- Performance scope: graphics, netcode, algorithms, runtime cycles, memory, and storage footprint.
- Remove dead code, stale assumptions, duplication, and unnecessary abstraction aggressively.
- Prefer reuse and simplification over additive architecture.
- Keep player-facing gameplay and visual experience mostly unchanged.
- Preserve fundamental SpacetimeDB atomic data model behavior.
- Preserve gameplay semantics (no fundamental gameplay changes in this phase).

## Architecture and multiplayer guardrails

- Keep deterministic gameplay/math logic in plain TypeScript modules (no React/Three/SDK imports in those helpers).
- `spacetimedb/src` is authoritative for mutation validation and world state transitions.
- Client networking should separate ingest, reconciliation, and dispatch.
- Rendering/UI projects multiplayer state; it does not own multiplayer authority transitions.
- Prefer shared payload contracts/constants over duplicated client/server shapes.
- Reducers are mutations, not reads.
- Reducers are deterministic.
- `ctx.sender` is the authority identity.
- Generated bindings are the only allowed client API surface.
- Client reducer calls use object payloads.

## Refactor priorities (default order)

1. Delete obsolete code first.
2. Collapse duplicate logic into shared helpers/contracts.
3. Reduce branching/state surface area and ownership ambiguity.
4. Improve hot-path efficiency without changing behavior.
5. Keep changes measurable (fewer allocations, smaller payloads, fewer sync edges).

## Validation expectations

Run from repo root after relevant changes:

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

Manual checks must cover touched gameplay/networking domains (movement feel, fireball behavior, ring/goomba interactions, chat/presence, synchronization semantics).
