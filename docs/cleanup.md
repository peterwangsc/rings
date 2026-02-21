Here's what the current spawn architecture looks like, and areas where it can be simplified:

## Current Spawn Architecture

### Goombas

**Two-layer spawning system:**

1. **`seedGoombas.ts`** — a bootstrap seed file that inserts a single hardcoded goomba at (2.4, 2.8) on startup. But this is **never called** — `init.ts` only calls `ensureWorldStateRow`, not `ensureGoombaRows`. The seed file is dead code.
2. **`goombaChunkSpawns.ts`** — the real spawning system, called every tick from `goombas.ts`. Procedurally spawns one goomba per eligible chunk near any player. Uses deterministic chunk hashing. ID is `"goomba-{chunkX}-{chunkZ}"`.

### Mystery Boxes

**Single-layer spawning system (`mysteryBoxChunkSpawns.ts`)** — same chunk-based approach as goombas. No bootstrap seed. One box per eligible chunk near players. ID is `"mystery-box-{chunkX}-{chunkZ}"`.

### Rings (Coins)

**No dedicated spawn system** — rings are a side effect of:

- `hitGoomba` reducer → 1 ring at goomba location
- `goombas.ts` tick → 1–5 spilled rings when goomba hits a player
- `hitMysteryBox` reducer → 5 rings in a burst

---

## Key Observations and Opportunities

### 1. ~~Dead code: `seedGoombas.ts` is never called~~ ✅ DONE

~~`init.ts` only calls `ensureWorldStateRow`. The `ensureGoombaRows` function from `seedGoombas.ts` is imported nowhere — it's completely dead. Since the real spawning is chunk-based (not seed-based), this whole file can be **deleted**.~~

### 2. ~~Duplicate `hashStringToUint32` defined in two places~~ ✅ DONE

~~`hashStringToUint32` is defined identically in both `goombaChunkSpawns.ts` (line 53–60) and `goombas.ts` (line 128–135). It should live in `shared/` and be imported.~~ Moved to `shared/mathUtils.ts`; removed from `goombaChunkSpawns.ts`, `goombas.ts`, and the now-deleted `seedGoombas.ts`.

### 3. ~~Duplicate `clampWorldAxis` defined in two places~~ ✅ DONE

~~`clampWorldAxis` is defined identically in `goombaChunkSpawns.ts` (line 62–64) and `mysteryBoxChunkSpawns.ts` (line 52–54), and independently again in `goombas.ts` (line 177–179). Same candidate for a shared utility.~~ Moved to `shared/mathUtils.ts`; removed from all three files.

### 4. ~~The two chunk spawn systems (`goombaChunkSpawns.ts` and `mysteryBoxChunkSpawns.ts`) are nearly identical~~ ✅ DONE

~~Both files implement the same pattern...~~ Extracted all shared logic into `shared/chunkSpawns.ts` (`tickEntityChunkSpawns`, `ChunkSpawnConfig`, `ChunkSpawnTickCtx`, `ChunkSpawnStateRow`). Each entity-specific file is now a thin wrapper that adapts its DB row shape to the generic interface and provides its entity-specific config and `spawnEntity` callback. The client rewrite (v2) made these systems fully server-side; rendering is driven directly by `useTable(goombaState)` / `useTable(mysteryBoxState)` subscriptions.

### 5. `goombaState` has `spawnX/Y/Z` fields that are only used for leash/home behavior

The goomba table carries both `spawnX/Y/Z` (home location) and `x/y/z` (current position). Mystery box table does the same. This is fine since spawn home is needed for the leash logic — but it does add 6 fields per entity.

### 6. `hitGoomba` reducer manually manages `goombaChunkSpawnState`

When a goomba is defeated via the `hitGoomba` reducer, the reducer directly inserts/updates `goombaChunkSpawnState`. But the `tickGoombas` system also calls `maybeReleaseChunkSlot()` when it deletes a defeated goomba. There's some duplication in chunk state management across the reducer and the tick system.

---

Remaining items in V1 mission order:

1. ~~**Delete `seedGoombas.ts`** (dead code, never called)~~ ✅ DONE
2. ~~**Extract `hashStringToUint32` and `clampWorldAxis` to `shared/`** (duplicate elimination)~~ ✅ DONE
3. ~~**Merge the two chunk spawn systems** into a shared parameterized helper (biggest complexity reduction).~~ ✅ DONE
