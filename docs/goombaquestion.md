## Two separate problems

### Problem 1: Re-renders on every server tick

**Root cause:** The server ticks goombas every **50ms minimum** (`GOOMBA_TICK_MIN_INTERVAL_MS`). On every tick, active goombas in idle state call `stepGoombaForward` which moves them slightly — changing `x`, `z`, `y`, `yaw`, and `nextChargeAllowedAtMs` (RNG state) — so `hasGoombaChanged` returns true and `ctx.db.goombaState.goombaId.update(...)` fires, which SpacetimeDB broadcasts to all clients.

The client's `useTable(tables.goombaState)` fires every time a row changes, which causes the `GoombaLayerSlice` effect to run, which calls `setGoombas(store, ...)`, which re-renders the whole goomba layer.

**The `toGoombaState` identity preservation helps** (it avoids creating new objects for unchanged goombas), and `setGoombas` has an early-exit equality check. But since idle goombas actually move every 50ms, those objects do genuinely change, so the entire array reference changes, triggering `GoombaLayer` to re-render and produce a new `goombaArray`, which React then diffs. Every goomba's `GoombaActor` that got a new prop object will see its `useEffect`s re-run.

**The real fix options:**

**Option A — Don't update the DB for idle goombas that have no players nearby (skip wandering DB writes).** The server already skips the _tick_ for inactive chunks, but an idle goomba in an active chunk still writes every 50ms for position. You could make idle wandering purely cosmetic client-side (use a deterministic wander simulation driven by the goomba's spawn point + `stateEndsAtMs` as the seed), and only write to DB on state transitions (idle→charge, etc.) and when a player hits the goomba. This is the biggest win but requires careful design so the server still has authoritative position when aggro begins.

**Option B — Increase `GOOMBA_TICK_MIN_INTERVAL_MS` for idle goombas.** Idle goomba position doesn't need to be authoritative at 50ms. You could run the collision/enrage check at 50ms but only write idle wander position every 500ms. This cuts idle goomba writes 10x.

**Option C — Per-goomba memo in `GoombaLayer`.** `GoombaActor` already handles position smoothing in `useFrame` via refs, so it only _needs_ the new prop when `x/y/z/yaw/state` actually change enough to matter. But currently the `goomba` prop is a new object every tick even when values barely change. Making `GoombaLayer` use `memo` per actor with a custom comparator could eliminate most re-renders, at the cost that each `GoombaActor` still re-checks on every table update.

**Best combined approach:**

- The server already uses `maybeUpdateGoomba` / `hasGoombaChanged` to skip unchanged rows, which is good.
- The **real waste** is that idle goomba position changes every 50ms (they walk continuously). Client-side, since `GoombaActor` already smooths position via `useFrame`, you could increase the server-side idle wander write interval significantly without visual degradation. The client interpolates anyway.
- Additionally, `GoombaActor` should be wrapped in `memo` with a field-level comparator to prevent re-renders when `goomba` prop object identity changes but values haven't.

### Problem 2: Goombas persist in the DB forever

**Root cause:** `goombaChunkSpawnState` rows are written the first time a player enters a chunk, and those rows are **never deleted**. The `goomba_chunk_spawn_state` table accumulates one row per visited chunk forever.

For `goombaState` itself, defeated goombas are deleted after `GOOMBA_DEFEATED_DESPAWN_MS` (900ms) — that's fine. But _living_ goombas in inactive chunks are not deleted either; they just stop ticking. When a player comes back to the same chunk, the existing goomba row is still there.

Actually, looking at `spawnEntity` in `goombaChunkSpawns.ts:109` — the goombaId is deterministic: `goomba-${chunkX}-${chunkZ}`. If the goomba already exists, it returns early. So living goombas that a player walks away from persist indefinitely in the `goombaState` table. This means **every player in the game gets that goomba row replicated to them**, even if they're on the other side of the world.

**The fix:** Goombas in inactive chunks (no nearby player) should be deleted from the DB when no player is within `GOOMBA_CHUNK_ACTIVE_RADIUS`. When the chunk becomes active again, the goomba re-spawns deterministically from the chunk seed. You'd need to persist enough state to recreate the goomba correctly (the `goombaChunkSpawnState` already has `spawnSequence`, so the respawn position is deterministic — you just lose the current wander position, which is fine since players won't notice).

This would dramatically reduce table size and eliminate cross-world replication of irrelevant goombas.

---

**Summary of what to do:**

1. **Server: Delete living goombas from inactive chunks** instead of leaving them in the DB. The chunk spawn state already tracks everything needed to re-create them. This reduces replication to only goombas near at least one player.

2. **Server: Write idle goomba position less frequently.** Since the client smooths anyway, writing every 200–500ms for idle goombas instead of every 50ms cuts DB writes and SpacetimeDB broadcasts significantly.

3. **Client: Memo `GoombaActor`** with shallow field comparison so that a new goomba object with identical `x/y/z/yaw/state` doesn't trigger re-renders or `useEffect`s.
