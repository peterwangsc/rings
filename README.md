# Character Rig Sandbox

This project is a Next.js + React Three Fiber + Three.js sandbox for building a reusable character/camera gameplay foundation.

Public demo for play testing: [https://rings-gamma.vercel.app/](https://rings-gamma.vercel.app/)

## SpacetimeDB Multiplayer Module

The server module lives in `spacetimedb/` and is written in TypeScript (`spacetimedb/server`).

From the repo root:

```bash
npm run multiplayer:db:start      # start local SpacetimeDB
npm run multiplayer:db:publish    # build + publish module (rings-multiplayer)
npm run multiplayer:db:generate   # generate TS client bindings into app/multiplayer/spacetime/bindings
npm run multiplayer:db:dev        # watch + auto-publish + auto-generate bindings
```
