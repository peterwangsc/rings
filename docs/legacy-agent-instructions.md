# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## Documentation sync rule

- `AGENTS.md` and `CLAUDE.local.md` must stay identical.
- Any change made to one of these files must be made to the other in the same update.
- If they drift, treat `AGENTS.md` as the source of truth and resync `CLAUDE.local.md` immediately.

## Architecture rules for V1 (forward path)

- Keep deterministic gameplay/math logic in plain TS modules (no React/Three/SDK imports in those helpers).
- `spacetimedb/src` remains authoritative for mutation validation and world state transitions.
- Client networking code should separate ingest, reconciliation, and dispatch responsibilities.
- Rendering/UI layers should project multiplayer state, not own multiplayer authority transitions.
- Prefer shared payload contracts and constants over duplicated client/server shape definitions.

## SpacetimeDB and multiplayer guardrails

When touching V1 server/client networking, enforce these non-negotiables:

- Reducers are mutations, not reads.
- Reducers are deterministic.
- `ctx.sender` is the authority identity.
- Generated bindings are the only allowed client API surface.
- Client reducer calls use object payloads.

## Validation expectations

Run relevant checks from the repo root after changes:

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

Manual checks should cover touched gameplay/networking domains (movement feel, fireball behavior, ring/goomba interactions, chat/presence, and synchronization semantics).

## Project

A 3D character rig sandbox with realtime multiplayer. Players share movement/presence, fireball casts, ring state, chat, and Goomba interactions through SpacetimeDB. Built with Next.js 16, React Three Fiber, Three.js, Rapier physics, and SpacetimeDB.

```bash
npm install
npm run dev      # Dev server at localhost:3000 (auto-starts local SpacetimeDB if needed)
npm run dev:web  # Dev server only (no SpacetimeDB auto-start)
npm run build    # Production build
npm run lint     # ESLint (Next.js + TypeScript rules)
npm run multiplayer:db:start     # Local SpacetimeDB on 127.0.0.1:3001
npm run multiplayer:db:publish   # Publish module to local SpacetimeDB
npm run multiplayer:db:generate  # Regenerate TS bindings from module schema
```

## Controls

| Input                        | Action                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| Click canvas                 | Lock pointer                                                    |
| Mouse                        | Look around                                                     |
| W, A, S, D                   | Move (camera-relative on the ground plane)                      |
| Shift (hold)                 | Alternate gait (run / walk)                                     |
| CapsLock                     | Toggle default gait                                             |
| Space                        | Jump                                                            |
| Click (while pointer-locked) | Cast fireball                                                   |
| V                            | Toggle third-person / first-person                              |
| F                            | Toggle FPS overlay                                              |
| Enter                        | Open chat (unlocks pointer while chat is open)                  |
| Esc                          | Unlock pointer; if chat is open, close chat and resume gameplay |

## Architecture

```
page.tsx → CharacterRigScene → SpacetimeDBProvider
  └── CharacterRigSceneContent
       ├── Canvas (R3F)
       │    ├── AnimatedSun (sky, day/night cycle, atmosphere)
       │    ├── Physics (Rapier world)
       │    │    ├── WorldGeometry (chunked terrain, grass, rocks, trees, clouds, campfire)
       │    │    ├── RingField (starter rings + dropped rings)
       │    │    ├── GoombaLayer (enemy rendering)
       │    │    ├── RemotePlayersLayer (remote avatars + chat nametags)
       │    │    └── CharacterRigController (input → physics → camera → animation)
       │    └── useMultiplayerSync (SpacetimeDB subscriptions + reducers)
       └── HUD + overlays (GameHUD, GlobalChatFeed, ChatOverlay, splash, mobile controls)
```

- Most gameplay/rendering components under `app/` are client components (`"use client"`); `app/page.tsx` remains a server component.
- State is managed via React hooks only — no global state library. `useRef` for per-frame mutable state (input, timers), `useState` for render-triggering state (camera mode, gait).
- The gameplay loop runs in `useFrame` inside `CharacterRigController.tsx` — the central orchestrator for input → physics → camera → animation each frame.
- Vertical movement is fully physics-driven (Rapier gravity); horizontal intent is on the XZ plane.
- Player is a capsule rigid body; ground uses trimesh colliders; rocks use hull mesh colliders.
- Multiplayer authority is server-validated in `spacetimedb/src/index.ts` with client prediction on the local player.

---

## The creative palette

Everything you can shape lives in one of these layers. Each layer maps to specific files and values.

### 1. Movement feel

How heavy, light, snappy, or floaty the character feels to control.

**File:** `app/utils/constants.ts`

| What you're shaping   | Constant                    | What it does                                                                              |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| Walking pace          | `PLAYER_WALK_SPEED`         | How fast the character strolls (currently ~1.92 m/s)                                      |
| Running pace          | `PLAYER_RUN_SPEED`          | How fast the character sprints (currently ~6.4 m/s)                                       |
| Overall speed scaling | `PLAYER_SPEED_SCALAR`       | Multiplier on both walk and run — turn this up to make everything faster                  |
| Responsiveness        | `PLAYER_ACCELERATION`       | How quickly the character reaches full speed — higher feels snappier, lower feels heavier |
| Stopping drag         | `PLAYER_LINEAR_DAMPING`     | How quickly the character slows down when you let go — higher stops faster, lower slides  |
| Jump power            | `PLAYER_JUMP_VELOCITY`      | How high the character launches — affects air time too                                    |
| Gravity weight        | `WORLD_GRAVITY_Y`           | How hard the world pulls down — less negative feels floatier, more negative feels heavier |
| Ledge forgiveness     | `GROUNDED_GRACE_SECONDS`    | Brief window after walking off an edge where you can still jump (currently 0.12s)         |
| Jump input buffer     | `JUMP_INPUT_BUFFER_SECONDS` | How early before landing you can press jump and still have it count (currently 0.15s)     |

Walk and run speeds are built from a base value times `PLAYER_SPEED_SCALAR`. Change the scalar to shift both proportionally, or change each individually for a different walk-to-run ratio. Jump air time is calculated automatically from jump velocity and gravity — change either one and the arc adjusts.
Movement intent is camera-relative on XZ: input sets desired acceleration direction from camera yaw, velocity updates toward target speed, and heading aligns to planar velocity while moving.

### 2. Camera personality

How the camera frames the character, how it responds to the mouse, and how each viewpoint feels.

**File:** `app/utils/constants.ts`

| What you're shaping        | Constant                                  | What it does                                                                                     |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Mouse responsiveness       | `CAMERA_LOOK_SENSITIVITY`                 | How far the camera turns per pixel of mouse movement                                             |
| Look-up / look-down limit  | `MIN_PITCH`, `MAX_PITCH`                  | How far you can tilt the camera up or down (in radians, ~63 degrees each way)                    |
| First-person field of view | `FIRST_PERSON_CAMERA_FOV`                 | Wider = more peripheral vision, narrower = more focused and cinematic                            |
| Third-person field of view | `THIRD_PERSON_CAMERA_FOV`                 | Same idea, but for the over-the-shoulder view                                                    |
| Camera distance            | `THIRD_PERSON_CAMERA_DISTANCE`            | How far behind the character the camera orbits                                                   |
| Camera height bias         | `THIRD_PERSON_ORBIT_ORIGIN_HEIGHT_OFFSET` | Negative = camera orbits around the character's knees, positive = around their head              |
| Look-at height             | `THIRD_PERSON_PIVOT_HEIGHT_OFFSET`        | Where the camera points relative to the orbit origin — shifts the framing up or down             |
| Camera lag                 | `THIRD_PERSON_CAMERA_SMOOTHNESS`          | How smoothly the camera follows — higher is smoother and more cinematic, lower is more immediate |
| Wall collision radius      | `THIRD_PERSON_CAMERA_COLLISION_RADIUS`    | How big the invisible ball is that prevents the camera from clipping through walls               |
| Minimum zoom               | `THIRD_PERSON_CAMERA_MIN_DISTANCE`        | Closest the camera can get when pushed by a wall behind the character                            |

First-person and third-person share independent FOV behavior — first-person benefits from wider peripheral awareness, while third-person looks better tighter. The third-person camera does a physics sphere-cast to avoid poking through geometry.

**Camera math conventions:**

First-person:

- `cameraPos = sampledHeadWorld` (head-anchored)
- `lookTarget = cameraPos + lookDirection(yaw, pitch) * LOOK_TARGET_DISTANCE`

Third-person:

- `orbitOrigin = playerCapsuleCenter + (0, THIRD_PERSON_ORBIT_ORIGIN_HEIGHT_OFFSET, 0)`
- `pivot = orbitOrigin + (0, THIRD_PERSON_PIVOT_HEIGHT_OFFSET, 0)`
- `cameraPosDesired = pivot - lookDirection(yaw, pitch) * THIRD_PERSON_CAMERA_DISTANCE`
- `cameraPos = pivot - lookDirection(yaw, pitch) * clampedDistance` where `clampedDistance` is solved by Rapier sphere cast
- `lookTarget = pivot + lookDirection(yaw, pitch) * LOOK_TARGET_DISTANCE`

### 3. Animation rhythm

How motion states blend together and how fast each clip plays.

**File:** `app/utils/constants.ts`

| What you're shaping          | Constant                       | What it does                                                                                     |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Blend speed                  | `STATE_BLEND_DURATION_SECONDS` | How long cross-fades take between idle/walk/run/jump — shorter is snappier, longer is smoother   |
| Walk animation speed         | `WALK_TIME_SCALE`              | Playback rate for the walk loop — speed up or slow down the leg cycle                            |
| Run animation speed          | `RUNNING_TIME_SCALE`           | Same for the run loop                                                                            |
| Jump animation speed         | `JUMP_TIME_SCALE`              | Same for the standing jump                                                                       |
| Running jump speed           | `JUMP_RUNNING_TIME_SCALE`      | Same for the running jump                                                                        |
| Happy emote speed            | `HAPPY_TIME_SCALE`             | Playback rate for the happy one-shot                                                             |
| Sad emote speed              | `SAD_TIME_SCALE`               | Playback rate for the sad one-shot                                                               |
| Movement detection threshold | `WALK_SPEED_THRESHOLD`         | Minimum speed before the character switches from idle to walking — prevents twitchy transitions  |
| Speed readout smoothing      | `PLANAR_SPEED_SMOOTHING`       | How smoothly the speed measurement updates — prevents flickering between walk/idle at low speeds |

The character has seven motion states: `idle`, `walk`, `running`, `jump`, `jump_running`, `happy`, `sad`. Locomotion and airborne transitions happen automatically based on speed/input. `happy` and `sad` clips are available as motion states, but they are not currently bound to local input keys. The blend duration is the single most impactful timing value — it controls how fluid or mechanical transitions feel. Animation playback speed and movement speed are independent, so you can have a character that moves fast but animates calmly, or vice versa.

**Files for deeper animation work:**

- `app/lib/CharacterActor.tsx` — animation clips loaded and mixer managed
- `app/lib/characterAnimation.ts` — clip lookup, root motion stripping, character scaling
- `app/lib/characterTypes.ts` — motion state type definitions

### 4. Lighting & atmosphere

The mood of the scene — sky color, fog, sun direction, ambient tone.

**Files:** `app/utils/constants.ts` for colors and fog range. `app/scene/AnimatedSun.tsx` for sky/day-night lighting behavior and shadow settings. `app/scene/world/placements.ts` and `app/scene/world/ChunkContent.tsx` for cloud placement/rendering.

| What you're shaping     | Where                                        | What it does                                                                                       |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Sky color               | `HORIZON_COLOR` in constants                 | Background and fog color (currently pale blue `#CFE9FF`)                                           |
| Fog start               | `SKY_FOG_NEAR` in constants                  | How close fog begins (currently 35 units)                                                          |
| Fog end                 | `SKY_FOG_FAR` in constants                   | Where fog becomes fully opaque (currently 135 units) — closer = more enclosed, farther = more open |
| Sky/ground ambient tint | `hemisphereLight` in `AnimatedSun.tsx`       | Two-tone ambient: sky tint `#EAF6FF` from above, ground tint `#8AA36D` from below                  |
| Fill light              | `ambientLight` in `AnimatedSun.tsx`          | Base ambient intensity for day/night blend (currently 0.75 by day, 0.2 by night)                   |
| Sun color and power     | `directionalLight` in `AnimatedSun.tsx`      | Warm key light `#FFF4D6` at peak daytime intensity 1.35                                            |
| Sun path / direction    | `SUN_ORBIT_*` constants in `AnimatedSun.tsx` | Orbits the light around the player to drive dynamic day/night shading                              |
| Shadow quality          | `shadow-mapSize` in `AnimatedSun.tsx`        | Shadow map resolution (currently 1024x1024)                                                        |

The hemisphere light is the main tool for overall color mood — its sky tint washes the tops of everything, its ground tint washes the undersides. The directional light adds shape through shadows. Fog distance dramatically affects how intimate or vast the world feels.

### 5. Tree silhouettes — handcrafted conifer stack

Trees are currently built from a single handcrafted conifer profile (trunk + layered cone canopies) and instanced across the terrain with deterministic placement.

**Primary files:** `app/vegetation/trees/SingleTree.tsx`, `app/scene/world/placements.ts`, `app/scene/WorldGeometry.tsx`

| What you're shaping             | Where                                                                              | What it does                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Canopy profile                  | `BASE_CANOPY_LAYERS` in `SingleTree.tsx`                                           | Defines each canopy layer's height, radius, vertical placement, and color  |
| Canopy twist                    | `CANOPY_MAX_TWIST_RADIANS` in `SingleTree.tsx`                                     | Rotates higher canopy layers further around trunk for spiral structure     |
| Tree height variance            | `heightScale` prop on `SingleTree`                                                 | Scales trunk + canopy proportions while preserving silhouette relationship |
| Trunk thickness scaling         | `trunkRadiusScale` in `SingleTree.tsx`                                             | Keeps trunk believable as tree height changes                              |
| Forest density                  | `CHUNK_TREE_COUNT` in `app/utils/constants.ts`                                     | Number of trees attempted per active terrain chunk                         |
| Forest coverage                 | `ACTIVE_TERRAIN_CHUNK_RADIUS`, `TERRAIN_CHUNK_SIZE`, `CHUNK_SPAWN_CLEARING_RADIUS` | Active chunk coverage around player and origin spawn clearing              |
| Spacing and collision avoidance | `CHUNK_TREE_MIN_SPACING`, `CHUNK_TREE_ROCK_CLEARANCE` in `app/utils/constants.ts`  | Prevents trees from clumping or intersecting chunk rocks                   |

### 6. Rock surfaces — the shader palette

The rocks use a custom shader that layers multiple visual effects. Each effect has its own set of knobs.

**File:** `app/utils/shaders.ts` — constants at the top of the file.

**Base material:**
| Knob | Constant | What it does |
|---|---|---|
| Surface roughness | `ROCK_BASE_ROUGHNESS` | How matte vs. glossy the base material appears |
| Metal quality | `ROCK_BASE_METALNESS` | How metallic the reflections are |

**Triplanar noise stack:**
| Knob | Constant | What it does |
|---|---|---|
| Primary noise scale | `ROCK_NOISE_TRIPLANAR_SCALE` | Base triplanar projection scale for rock noise |
| Detail noise scale | `ROCK_NOISE_DETAIL_SCALE` | Medium-frequency detail multiplier |
| Micro noise scale | `ROCK_NOISE_MICRO_SCALE` | High-frequency detail multiplier |
| Axis blend sharpness | `ROCK_TRIPLANAR_BLEND_POWER` | How sharply normals choose projection axes |

**Bump and normal response:**
| Knob | Constant | What it does |
|---|---|---|
| Bump sample step | `ROCK_BUMP_SAMPLE_OFFSET` | World-space offset used to estimate bump gradient |
| Bump depth | `ROCK_BUMP_STRENGTH` | How strongly bump normals perturb the surface |
| Bump blend | `ROCK_BUMP_BLEND` | How much bump normals override base normals |

**Roughness shaping:**
| Knob | Constant | What it does |
|---|---|---|
| Cavity roughness boost | `ROCK_ROUGHNESS_CAVITY_BOOST` | Makes crevices rougher |
| Ridge roughness reduction | `ROCK_ROUGHNESS_RIDGE_REDUCE` | Makes exposed ridges slightly smoother |

### 7. Rock silhouettes — the procedural shape

Each rock is generated from a sphere that gets sculpted by layered noise.

**File:** `app/utils/rockGeometry.ts` — constants at the top.

| What you're shaping | Constant                                   | What it does                                                                          |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Overall mass        | `ROCK_MACRO_MASS_STRENGTH`                 | How much the big-scale noise pushes the surface in and out                            |
| Asymmetry           | `ROCK_MACRO_ASYMMETRY_STRENGTH`            | How lopsided and irregular the overall form is                                        |
| Surface warp        | `ROCK_DOMAIN_WARP_STRENGTH`                | How much the noise coordinates get twisted before sampling — more warp = more organic |
| Ridge sharpness     | `ROCK_STACK_RIDGE_STRENGTH`                | How pronounced the sharp ridges are                                                   |
| Basin depth         | `ROCK_STACK_BASIN_STRENGTH`                | How deep the concave pockets carve in                                                 |
| Erosion             | `ROCK_EROSION_STRENGTH`                    | How much the sides get eaten away, like real weathering                               |
| Crown softening     | `ROCK_CROWN_SOFTEN_STRENGTH`               | How rounded the tops become                                                           |
| Base flatness       | `ROCK_FOOTING_Y_MIN`, `ROCK_FOOTING_Y_MAX` | How the bottom flattens out to sit on the ground                                      |

### 8. World layout

Where things are placed, how big they are, and the ground colors.

**Files:** `app/utils/constants.ts`, `app/scene/world/terrainChunks.tsx`, `app/scene/world/placements.ts`

| What you're shaping | Constant                                                     | What it does                                           |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| Active world span   | `ACTIVE_TERRAIN_CHUNK_RADIUS`, `TERRAIN_CHUNK_SIZE`          | Number/size of loaded terrain chunks around the player |
| Spawn clearing      | `CHUNK_SPAWN_CLEARING_RADIUS`                                | Keeps origin area playable and unobstructed            |
| Rock density        | `CHUNK_ROCK_COUNT`, `CHUNK_ROCK_MIN_SPACING`                 | Per-chunk rock count and minimum spacing               |
| Rock size range     | `CHUNK_ROCK_SCALE_MIN`, `CHUNK_ROCK_SCALE_MAX`               | Procedural rock size envelope                          |
| Tree density        | `CHUNK_TREE_COUNT`, `CHUNK_TREE_MIN_SPACING`                 | Per-chunk tree count and spacing                       |
| Tree clearance      | `CHUNK_TREE_ROCK_CLEARANCE`                                  | Avoids tree overlap with chunk rocks                   |
| Tree height range   | `CHUNK_TREE_HEIGHT_SCALE_MIN`, `CHUNK_TREE_HEIGHT_SCALE_MAX` | Procedural tree silhouette variation                   |
| Terrain palette     | `TERRAIN_COLOR_*`                                            | Height/slope-driven terrain color bands                |
| Grass color         | `GRASS_FIELD_COLOR`                                          | Base grass tint used by grass material                 |
| Rock base tint      | `ROCK_MATERIAL_COLOR`                                        | Base color passed into rock shader material            |

### 9. Rings (collectibles)

Golden torus collectibles include starter world rings and temporary dropped rings (from Goomba reward/spill). Collection is server-authoritative and synced to all players.

**Primary files:** `app/gameplay/collectibles/Ring.tsx`, `app/gameplay/collectibles/RingField.tsx`, `app/scene/world/worldEntityManager.ts`, `spacetimedb/src/index.ts`

| What you're shaping | Constant                                                                                         | What it does                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Float height        | `RING_HOVER_HEIGHT`                                                                              | How far above the terrain surface rings float                       |
| Ring size           | `RING_MAJOR_RADIUS`, `RING_TUBE_RADIUS`                                                          | Torus dimensions — overall ring size and tube thickness             |
| Ring color          | `RING_COLOR`                                                                                     | Base gold color of the ring                                         |
| Ring glow           | `RING_EMISSIVE_COLOR`, `RING_EMISSIVE_INTENSITY`                                                 | Self-illumination color and strength — keeps rings visible at night |
| Ring surface        | `RING_ROUGHNESS`, `RING_METALNESS`                                                               | Material feel — lower roughness and higher metalness for shiny gold |
| Spin speed          | `RING_ROTATION_SPEED`                                                                            | How fast the ring rotates around its vertical axis                  |
| Bob motion          | `RING_BOB_AMPLITUDE`, `RING_BOB_SPEED`                                                           | Vertical hovering motion — amplitude and frequency                  |
| Pickup range        | `RING_COLLECT_RADIUS`                                                                            | Distance threshold used by both client checks and server validation |
| Drop fall-in        | `RING_DROP_FALL_START_HEIGHT`, `RING_DROP_FALL_DURATION_MS`                                      | Drop ring fall animation from spawn height down to hover height     |
| Drop lifetime       | `RING_DROP_LIFETIME_MS`                                                                          | Total time before dropped rings despawn                             |
| Drop despawn flash  | `RING_DROP_DESPAWN_FLASH_WINDOW_MS`, `RING_DROP_DESPAWN_FLASH_HZ`, `RING_DROP_DESPAWN_MIN_ALPHA` | Sonic-style flash/fade before dropped rings disappear               |
| Ring positions      | `RING_PLACEMENTS`                                                                                | Array of `[x, z]` coordinates — Y is computed from terrain height   |
| Mesh detail         | `RING_TORUS_SEGMENTS`, `RING_TUBE_SEGMENTS`                                                      | Geometry resolution of the torus                                    |

Starter ring positions are terrain-derived in `worldEntityManager`. Drop rings are inserted and expired server-side in `spacetimedb/src/index.ts` and rendered client-side with timed fall + flash/fade behavior. Ring collection is distance-based (no ring sensor colliders).

### 10. Multiplayer + Goomba gameplay

Multiplayer state and enemy behavior are split between client sync/store and server reducers/tables.

**Primary files:** `app/multiplayer/state/useMultiplayerSync.ts`, `app/multiplayer/state/multiplayerStore.ts`, `app/gameplay/goombas/GoombaLayer.tsx`, `spacetimedb/src/index.ts`

- Player state, inventory, rings, ring drops, world day cycle, chat, and Goomba state are replicated via SpacetimeDB tables/bindings.
- `CharacterRigController` predicts local movement and fireballs; authoritative snapshots from server are used for reconciliation.
- Goomba AI and ring-drop spawn/cleanup are server-side. Visual rig animation for Goomba is client-side.

**Convention for new gameplay elements:** constants in `constants.ts`, 3D components in `app/gameplay/<category>/`, HUD overlays in `app/hud/`, state orchestrated in `CharacterRigScene`.

---

## How to work

### For feel changes (movement, camera, animation timing)

1. Name what you want to feel different — "the jump feels too floaty", "the camera is too close", "transitions between walk and run are jarring."
2. Find the constant in the table above.
3. Adjust the value. One change at a time so you can feel the difference.
4. Keep the constant name and location — don't move things around.

### For look changes (lighting, colors, shader effects)

1. Describe the visual goal — "warmer golden hour light", "more dramatic crack glow", "subtler strata banding."
2. Identify which layer it belongs to (atmosphere, rock surface, rock shape, world layout).
3. Adjust the relevant constants in that layer's file.
4. Check the result from first-person and third-person camera modes.

### For adding new visual elements

1. State what the element is and where it should appear.
2. Follow existing patterns: compose new world objects in `WorldGeometry.tsx` with `RigidBody` wrappers, and put generation/helpers in `app/scene/world/*`. New shader effects extend the existing `onBeforeCompile` pipeline in `shaders.ts`. New constants go in `constants.ts`.
3. Keep shader work inside the `MeshStandardMaterial` customization pattern — don't replace it with a raw `ShaderMaterial` unless the standard pipeline can't do what you need.

### Implementation order when building a new feature

1. Pure helpers first — math functions, color utilities, any calculations.
2. State and input — what triggers the feature, what data it needs.
3. Actor and transform — how the character or objects move or change.
4. Camera — any framing adjustments, only after transforms are stable.
5. Surface and shader — visual polish last, once the behavior is locked.

---

## Load-bearing walls

These are structural decisions that keep the whole system working. Don't change them without understanding the consequences.

**Coordinate system:** Right-handed. `+X` right, `+Y` up, forward at yaw=0 points `-Z`. Movement basis: `forward(yaw) = (sin(yaw), 0, -cos(yaw))`, `right = forward x up`. Mouse look: yaw increases with mouse-right, pitch increases with mouse-up (`MOUSE_YAW_SIGN = 1`, `MOUSE_PITCH_SIGN = 1`). Changing a sign anywhere will flip or mirror behavior in hard-to-debug ways.

**Physics authority:** The character's vertical position is controlled entirely by Rapier (gravity, collisions). Horizontal intent is on XZ. Never manually set the Y position per frame.

**Character-camera coupling:** In both camera modes, movement input is camera-relative on XZ. In `first_person`, mouse look controls the camera directly. In `third_person`, mouse look controls the orbit camera independently from movement. Character heading aligns with planar velocity direction while moving. The yaw sign inversion (`CHARACTER_CAMERA_YAW_SIGN = -1`) and model offset (`CHARACTER_MODEL_YAW_OFFSET = Math.PI`) are calibrated to the model. The visual root stays at a fixed local offset under the physics capsule so vertical placement is fully physics-driven.

**Root motion stripping:** Animation clips have root translation tracks removed so physics controls position. New animations need the same treatment (see `characterAnimation.ts`). Locomotion/airborne clips are matched by alias and played as `idle`, `walk`, `running`, `jump`, `jump_running`; emote clips are matched as `happy` and `sad`.

**Collider-visual alignment:** Each rock's `collider` size should roughly match its `scale`. If you resize a rock visually, update its collider too or the player will bump into invisible walls or walk through visible rock.

**Character asset:** Single rigged glTF at `public/models/character/character_new.gltf`. Character root is centered in X/Z, grounded at local Y=0, auto-scaled to target height (1.85m). Mesh shadows enabled.

---

## File map

| Layer                                                                | Primary file                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Movement, camera, timing, layout, colors                             | `app/utils/constants.ts`                                                                                                             |
| Lighting, shadows, sky/fog behavior, cloud layer                     | `app/scene/CharacterRigScene.tsx`, `app/scene/AnimatedSun.tsx`, `app/scene/world/placements.ts`, `app/scene/world/ChunkContent.tsx`  |
| Ground plane, grass, rock placement, campfire, forest tree placement | `app/scene/WorldGeometry.tsx`, `app/scene/world/terrainChunks.tsx`, `app/scene/world/grassField.ts`, `app/scene/world/placements.ts` |
| Handcrafted conifer tree mesh                                        | `app/vegetation/trees/SingleTree.tsx`                                                                                                |
| Rock surface shader effects                                          | `app/utils/shaders.ts`                                                                                                               |
| Rock procedural shape                                                | `app/utils/rockGeometry.ts`                                                                                                          |
| Character model, animation playback                                  | `app/lib/CharacterActor.tsx`                                                                                                         |
| Animation helpers, clip processing                                   | `app/lib/characterAnimation.ts`                                                                                                      |
| Input and per-frame gameplay loop                                    | `app/controller/CharacterRigController.tsx`                                                                                          |
| Input event wiring (keyboard, pointer-lock, touch look)              | `app/controller/useControllerInputHandlers.ts`                                                                                       |
| Multiplayer connection + table/reducer sync                          | `app/multiplayer/spacetime/client.ts`, `app/multiplayer/state/useMultiplayerSync.ts`                                                 |
| Multiplayer client store/types                                       | `app/multiplayer/state/multiplayerStore.ts`, `app/multiplayer/state/multiplayerTypes.ts`                                             |
| SpacetimeDB module schema/reducers                                   | `spacetimedb/src/index.ts`                                                                                                           |
| Mobile joystick and splash/orientation overlays                      | `app/scene/MobileControlsOverlay.tsx`, `app/scene/SceneOverlays.tsx`                                                                 |
| Camera application logic                                             | `app/camera/cameraRig.ts`                                                                                                            |
| Terrain height and noise sampling                                    | `app/utils/terrain.ts`                                                                                                               |
| Direction and angle math                                             | `app/utils/math.ts`                                                                                                                  |
| Motion state resolution                                              | `app/utils/physics.ts`                                                                                                               |
| Ring collectible (3D mesh + visual timing)                           | `app/gameplay/collectibles/Ring.tsx`                                                                                                 |
| Ring field spawner and collection state                              | `app/gameplay/collectibles/RingField.tsx`                                                                                            |
| Goomba enemy render/animation layer                                  | `app/gameplay/goombas/GoombaLayer.tsx`                                                                                               |
| HUD and chat overlays                                                | `app/hud/GameHUD.tsx`, `app/hud/GlobalChatFeed.tsx`, `app/hud/ChatOverlay.tsx`                                                       |
