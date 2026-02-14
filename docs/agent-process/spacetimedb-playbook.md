# SpacetimeDB Agent Playbook

Use this when working on:

- `spacetimedb/src/index.ts`
- `app/multiplayer/spacetime/*`
- `app/multiplayer/state/*` integrations that depend on generated bindings

This is a pruned process reference extracted from the removed template metadata docs.

## Non-negotiables

1. Reducers are transactional mutations. Do not treat them like query endpoints.
2. Read game state from subscribed tables, not reducer return values.
3. Reducers must be deterministic: no filesystem, network calls, non-deterministic timers, `Date.now()`, or `Math.random()`.
4. `ctx.sender` is the authority identity. Never trust ownership claims from payload fields.
5. Use only generated bindings and documented SDK surfaces. Do not invent APIs.

## TypeScript SDK guardrails

- Import generated tables/reducers/connection types from `app/multiplayer/spacetime/bindings`.
- Use `spacetimedb/react` hooks as documented (`useTable`, `useSpacetimeDB`, `useReducer` aliases).
- Reducer calls must use object payloads:
  - Good: `conn.reducers.castFireball({ x, y, z })`
  - Bad: `conn.reducers.castFireball(x, y, z)`
- `useTable` returns a tuple (`[rows, isLoading]`); destructure accordingly.
- Keep `connectionBuilder` stable in React (`useMemo`) to avoid reconnect loops.
- Client bindings expose reducer names in camelCase, even if server reducer name is snake_case.

## Schema and table/index gotchas

- `table()` signature is `table(options, columns)`. Put `indexes` in `options`.
- Include `algorithm` for explicit index declarations.
- For auto-increment fields, insert with `0n` placeholder.
- `.insert()` returns the inserted row, not just the primary key.
- Use `.find()` for unique lookups and `.filter(value)` for non-unique indexes.
- Avoid object-argument `filter({ ... })`; pass raw indexed value.
- Do not assume auto-increment IDs are gapless or time-ordered.
- If using multi-column indexes, verify behavior on current runtime before relying on partial-key access patterns.

## Feature implementation order

1. Add/update schema tables and indexes.
2. Add/update reducers with validation and authority checks.
3. Regenerate bindings.
4. Wire table subscriptions and state mapping on client.
5. Wire reducer call sites from gameplay/UI.
6. Add reconciliation/ordering validation for networked fields (for example monotonic `lastInputSeq`).
7. Run local two-client validation for sync, authority, and rollback behavior.

## Local command loop

```bash
spacetime start --listen-addr 127.0.0.1:3001 --non-interactive
spacetime publish <db-name> --project-path ./spacetimedb --server http://127.0.0.1:3001 --yes
spacetime generate --lang typescript --project-path ./spacetimedb --out-dir ./app/multiplayer/spacetime/bindings --yes
```

Optional remote operations:

```bash
spacetime login
spacetime publish <db-name> --project-path ./spacetimedb --yes
spacetime logs <db-name>
```

## Definition of done for multiplayer changes

- Reducer is actually called from client code path (not just defined).
- Table subscription receives authoritative updates that drive rendering/state.
- No invented SDK methods/imports were introduced.
- Server/client authority constants are synchronized or intentionally documented.
