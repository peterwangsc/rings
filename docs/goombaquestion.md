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

**Task 1 — Server: Delete goombas from inactive chunks**
In `tickGoombas`, after `tickGoombaChunkSpawns` returns `activeChunks`, for each goomba that is NOT defeated AND whose spawn chunk is NOT in `activeChunks`, delete it from the DB and release the chunk slot.

**Task 2 — Server: Option A — Don't write idle wander to DB**
For idle goombas with no player nearby: skip `stepGoombaForward` and skip the DB write entirely. The server still needs the RNG state (`nextChargeAllowedAtMs`) and `stateEndsAtMs` for wander timing — but since these also only change during idle (which we're now suppressing), we only need to write when starting a NEW idle wander segment or when transitioning states. The key insight: when the goomba is idle AND in an active chunk AND no player nearby, we still need to detect player arrival (so the server still ticks the chunk). We just don't write position to DB.

Wait — there's a subtlety. The server still needs to maintain the goomba's position for collision detection. But if we suppress DB writes for idle position, the server loses authoritative position. When a player enters the enrage radius, the server needs to know where the goomba is to set the charge yaw.

The doc's Option A says: "use a deterministic wander simulation driven by the goomba's spawn point + `stateEndsAtMs` as the seed, and only write to DB on state transitions (idle→charge, etc.) and when a player hits the goomba." The key insight is: the client and server independently run the same deterministic simulation. On the server, when transitioning out of idle, we compute where the goomba would be deterministically and write that position.

The server can reconstruct goomba position from: `spawnX/spawnZ` (fixed), `stateEndsAtMs` (encodes current wander segment timing), `nextChargeAllowedAtMs` (RNG state), and `updatedAtMs` (when we last wrote).

**Simpler approach**: When idle and no player nearby — don't call `stepGoombaForward`, don't update `x/z/y/yaw`. Do still update `stateEndsAtMs`/RNG when wander segment ends (to pick a new yaw). This way the DB `x/z/yaw` represents the start of the current wander segment, and the client simulates forward. On transition to CHARGE, compute the current position from spawn/time.

Actually wait — this gets complex. Let me think about what the client needs to simulate:

The client needs: `spawnX`, `spawnZ`, `stateEndsAtMs` (when current wander segment ends), `nextChargeAllowedAtMs` (RNG state), `updatedAtMs` (when wander segment started / last DB write). From these, it can compute what yaw the goomba is walking on this segment, and how far it has advanced.

So the approach:

- Server: When idle wander segment starts (`startIdleWanderSegment`), write the current position + new yaw + new `stateEndsAtMs` to DB. Between segment starts, don't write.
- Server: When player detected (idle→charge), compute the simulated current position by stepping forward `(timestampMs - updatedAtMs) / 1000` seconds at idle walk speed. Then write that computed position + charge state.
- Client: When `state === "idle"`, simulate forward from `x/z/yaw` (last written position) using elapsed time since `updatedAtMs`.

This is clean. Let me now look at what `updatedAtMs` represents vs. when we'd need it. Currently `updatedAtMs` is updated on every DB write. We'd use it as "time of last position snapshot."

Now let me check what the client `GoombaState` has — it needs `spawnX`, `spawnZ`, `stateEndsAtMs`, `nextChargeAllowedAtMs`, `updatedAtMs` for the simulation. Let me check what the client currently receives:

The client already receives `spawnX`, `spawnZ`, `stateEndsAtMs`, `nextChargeAllowedAtMs`, and `updatedAtMs` from the server via the generated bindings. This is great — the client can simulate idle wandering from these fields without any schema changes.

Now let me also look at client terrain sampling to understand what the client simulation needs:

Good, `sampleTerrainHeight` is available in `app/utils/terrain.ts`. Now I have enough info to implement everything. Let me also check if there's a `stepPlanarControllerMovement` or equivalent on the client:

The movement controller is server-only. The client simulation needs to do a simpler version. For idle wandering it's just: advance position forward at `GOOMBA_IDLE_WALK_SPEED` in direction `yaw` for `deltaSeconds`, clamped to world bounds. The goomba doesn't have terrain clinging on the client side for idle (the server samples terrain height, but the client can approximate).

Actually, we have `sampleTerrainHeight` on the client, and the simulation just does:

```
x += sin(yaw) * speed * dt
z -= cos(yaw) * speed * dt
y = sampleTerrainHeight(x, z)
```

The server uses `stepPlanarControllerMovement` which handles collision with terrain (not walls/bounds). For idle wandering, it's essentially just forward movement — the leash logic prevents them going too far. The client sim needs to match this closely but doesn't need perfect fidelity since it just needs to look right.

Now let me implement all three tasks. I'll start with the server changes:

**Task 1: Delete goombas from inactive chunks**

In `tickGoombas`, right after `tickGoombaChunkSpawns` and before iterating goombas, we need to delete non-defeated goombas whose chunk is inactive. Actually, we can just do it in the main loop — the current code already skips ticking them with `continue`, but we should also delete them.

**Task 2: Option A — Don't write idle goomba position to DB**

When idle and no player nearby:

- Still update `stateEndsAtMs` and RNG when wander segment ends (write to DB)
- But don't call `stepGoombaForward` and don't update x/z/y
- The DB `x/z/yaw` = position at start of current wander segment, `updatedAtMs` = when that segment started
- When transitioning idle→charge: reconstruct current position by simulating forward, THEN write

Now let me implement all the server-side changes in `goombas.ts`. The key changes are:

1. Delete non-defeated goombas from inactive chunks
2. For idle goombas: only write to DB on wander segment transitions, not every tick
3. When transitioning idle→charge: simulate current position before writing

You've hit your limit · resets 7am (America/Los_Angeles)
