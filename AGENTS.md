# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## Project

A 3D character rig sandbox — a playable scene with a character you control, a camera that follows them, rocks with living shader surfaces, and a grass field under open sky. Built with Next.js 16, React Three Fiber, Three.js, and Rapier physics.

```bash
npm install
npm run dev      # Dev server at localhost:3000
npm run build    # Production build
npm run lint     # ESLint (Next.js + TypeScript rules)
```

No test framework is configured.

## Controls

| Input | Action |
|---|---|
| Click canvas | Lock pointer |
| Mouse | Look around |
| W, A, S, D | Move |
| Shift (hold) | Alternate gait (run / walk) |
| CapsLock | Toggle default gait |
| Space | Jump |
| H | Trigger happy emote |
| J | Trigger sad emote |
| V | Cycle third-person / first-person / third-person free-look |
| Esc | Unlock pointer |

## Architecture

```
page.tsx → CharacterRigScene → Canvas (R3F)
  ├── Physics (Rapier world)
  ├── WorldGeometry (ground plane, rock formations with colliders)
  └── CharacterRigController (input, physics loop, camera)
        └── CharacterActor (model loading, animation mixer)
```

- All components under `app/` are client components (`"use client"`).
- State is managed via React hooks only — no global state library. `useRef` for per-frame mutable state (input, timers), `useState` for render-triggering state (camera mode, gait).
- The gameplay loop runs in `useFrame` inside `CharacterRigController.tsx` — the central orchestrator for input → physics → camera → animation each frame.
- Vertical movement is fully physics-driven (Rapier gravity); horizontal intent is on the XZ plane.
- Player is a capsule rigid body; ground uses a trimesh collider; rocks use cuboid colliders.

---

## The creative palette

Everything you can shape lives in one of these layers. Each layer maps to specific files and values.

### 1. Movement feel

How heavy, light, snappy, or floaty the character feels to control.

**File:** `app/utils/constants.ts`

| What you're shaping | Constant | What it does |
|---|---|---|
| Walking pace | `PLAYER_WALK_SPEED` | How fast the character strolls (currently ~3.6 m/s) |
| Running pace | `PLAYER_RUN_SPEED` | How fast the character sprints (currently ~5.8 m/s) |
| Overall speed scaling | `PLAYER_SPEED_SCALAR` | Multiplier on both walk and run — turn this up to make everything faster |
| Responsiveness | `PLAYER_ACCELERATION` | How quickly the character reaches full speed — higher feels snappier, lower feels heavier |
| Stopping drag | `PLAYER_LINEAR_DAMPING` | How quickly the character slows down when you let go — higher stops faster, lower slides |
| Jump power | `PLAYER_JUMP_VELOCITY` | How high the character launches — affects air time too |
| Gravity weight | `WORLD_GRAVITY_Y` | How hard the world pulls down — less negative feels floatier, more negative feels heavier |
| Ledge forgiveness | `GROUNDED_GRACE_SECONDS` | Brief window after walking off an edge where you can still jump (currently 0.08s) |
| Jump input buffer | `JUMP_INPUT_BUFFER_SECONDS` | How early before landing you can press jump and still have it count (currently 0.15s) |

Walk and run speeds are built from a base value times `PLAYER_SPEED_SCALAR`. Change the scalar to shift both proportionally, or change each individually for a different walk-to-run ratio. Jump air time is calculated automatically from jump velocity and gravity — change either one and the arc adjusts.

### 2. Camera personality

How the camera frames the character, how it responds to the mouse, and how each viewpoint feels.

**File:** `app/utils/constants.ts`

| What you're shaping | Constant | What it does |
|---|---|---|
| Mouse responsiveness | `CAMERA_LOOK_SENSITIVITY` | How far the camera turns per pixel of mouse movement |
| Look-up / look-down limit | `MIN_PITCH`, `MAX_PITCH` | How far you can tilt the camera up or down (in radians, ~63 degrees each way) |
| First-person field of view | `FIRST_PERSON_CAMERA_FOV` | Wider = more peripheral vision, narrower = more focused and cinematic |
| Third-person field of view | `THIRD_PERSON_CAMERA_FOV` | Same idea, but for the over-the-shoulder view |
| Camera distance | `THIRD_PERSON_CAMERA_DISTANCE` | How far behind the character the camera orbits |
| Camera height bias | `THIRD_PERSON_ORBIT_ORIGIN_HEIGHT_OFFSET` | Negative = camera orbits around the character's knees, positive = around their head |
| Look-at height | `THIRD_PERSON_PIVOT_HEIGHT_OFFSET` | Where the camera points relative to the orbit origin — shifts the framing up or down |
| Camera lag | `THIRD_PERSON_CAMERA_SMOOTHNESS` | How smoothly the camera follows — higher is smoother and more cinematic, lower is more immediate |
| Wall collision radius | `THIRD_PERSON_CAMERA_COLLISION_RADIUS` | How big the invisible ball is that prevents the camera from clipping through walls |
| Minimum zoom | `THIRD_PERSON_CAMERA_MIN_DISTANCE` | Closest the camera can get when pushed by a wall behind the character |

First-person and both third-person modes share independent FOV behavior — first-person benefits from wider peripheral awareness, while third-person modes look better tighter. The third-person camera does a physics sphere-cast to avoid poking through geometry.

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

| What you're shaping | Constant | What it does |
|---|---|---|
| Blend speed | `STATE_BLEND_DURATION_SECONDS` | How long cross-fades take between idle/walk/run/jump — shorter is snappier, longer is smoother |
| Walk animation speed | `WALK_TIME_SCALE` | Playback rate for the walk loop — speed up or slow down the leg cycle |
| Run animation speed | `RUNNING_TIME_SCALE` | Same for the run loop |
| Jump animation speed | `JUMP_TIME_SCALE` | Same for the standing jump |
| Running jump speed | `JUMP_RUNNING_TIME_SCALE` | Same for the running jump |
| Happy emote speed | `HAPPY_TIME_SCALE` | Playback rate for the happy one-shot |
| Sad emote speed | `SAD_TIME_SCALE` | Playback rate for the sad one-shot |
| Movement detection threshold | `WALK_SPEED_THRESHOLD` | Minimum speed before the character switches from idle to walking — prevents twitchy transitions |
| Speed readout smoothing | `PLANAR_SPEED_SMOOTHING` | How smoothly the speed measurement updates — prevents flickering between walk/idle at low speeds |

The character has seven motion states: `idle`, `walk`, `running`, `jump`, `jump_running`, `happy`, `sad`. Locomotion and airborne transitions happen automatically based on speed/input. `happy` and `sad` are one-shot emotes triggered by `H`/`J`, and they play only while grounded with no move intent. The blend duration is the single most impactful timing value — it controls how fluid or mechanical transitions feel. Animation playback speed and movement speed are independent, so you can have a character that moves fast but animates calmly, or vice versa.

**Files for deeper animation work:**
- `app/lib/CharacterActor.tsx` — animation clips loaded and mixer managed
- `app/lib/characterAnimation.ts` — clip lookup, root motion stripping, character scaling
- `app/lib/characterTypes.ts` — motion state type definitions

### 4. Lighting & atmosphere

The mood of the scene — sky color, fog, sun direction, ambient tone.

**Files:** `app/utils/constants.ts` for colors and fog range. `app/scene/CharacterRigScene.tsx` for light positions and intensities.

| What you're shaping | Where | What it does |
|---|---|---|
| Sky color | `SKY_BACKGROUND_COLOR` in constants | Background and fog color (currently pale blue `#CFE9FF`) |
| Fog start | `SKY_FOG_NEAR` in constants | How close fog begins (currently 35 units) |
| Fog end | `SKY_FOG_FAR` in constants | Where fog becomes fully opaque (currently 135 units) — closer = more enclosed, farther = more open |
| Sky/ground ambient tint | `hemisphereLight` in CharacterRigScene | Two-tone ambient: sky tint `#EAF6FF` from above, ground tint `#8AA36D` from below |
| Fill light | `ambientLight` in CharacterRigScene | Flat overall brightness (currently 0.95) |
| Sun color and power | `directionalLight` in CharacterRigScene | Warm key light `#FFF4D6` at intensity 1.35 |
| Sun direction | `directionalLight position` in CharacterRigScene | Where shadows fall from — currently `[8, 14, 6]` (high and slightly behind-right) |
| Shadow quality | `shadow-mapSize` in CharacterRigScene | Shadow map resolution (currently 2048x2048) |

The hemisphere light is the main tool for overall color mood — its sky tint washes the tops of everything, its ground tint washes the undersides. The directional light adds shape through shadows. Fog distance dramatically affects how intimate or vast the world feels.

### 5. Rock surfaces — the shader palette

The rocks use a custom shader that layers multiple visual effects. Each effect has its own set of knobs.

**File:** `app/utils/shaders.ts` — constants at the top of the file.

**Base material:**
| Knob | Constant | What it does |
|---|---|---|
| Surface roughness | `ROCK_BASE_ROUGHNESS` | How matte vs. glossy (0.94 = very rough stone) |
| Metal quality | `ROCK_BASE_METALNESS` | How metallic the reflections are (0.02 = almost none) |
| Ambient glow color | `ROCK_BASE_EMISSIVE` | Subtle self-illumination tint |
| Ambient glow strength | `ROCK_BASE_EMISSIVE_INTENSITY` | How visible the self-illumination is |

**Bump and relief — the surface texture that catches light:**
| Knob | Constant | What it does |
|---|---|---|
| Noise scale | `ROCK_NOISE_TRIPLANAR_SCALE` | Size of the main noise pattern projected onto the rock |
| Detail layer scale | `ROCK_NOISE_DETAIL_SCALE` | Size of the medium detail noise |
| Micro detail scale | `ROCK_NOISE_MICRO_SCALE` | Size of the finest grain noise |
| Drift speed | `ROCK_NOISE_DRIFT_SPEED` | How fast the noise pattern slowly shifts over time |
| Bump depth | `ROCK_BUMP_STRENGTH` | How pronounced the surface relief appears |
| Bump blend | `ROCK_BUMP_BLEND` | How much the bump normals override the mesh normals |

**Color variation layers — painted onto the surface based on shape and position:**
| Knob | What it does |
|---|---|
| `STRATA_FREQUENCY` | How many horizontal bands of color stripe across the rock |
| `STRATA_TILT_X`, `STRATA_TILT_Z` | How much the strata tilt away from perfectly horizontal — makes them feel geological |
| `STRATA_DARKEN_FACTOR`, `STRATA_LIGHTEN_FACTOR` | Contrast between dark and light bands |
| `WEATHERING_LIGHTEN` | How much upward-facing surfaces lighten, like real sun-bleached rock |
| `CAVITY_DARKEN` | How dark the crevices and pockets get — adds depth |
| `RIDGE_LIGHTEN` | How bright the raised ridges get — adds sharpness |

**Accent materials — iron veins and lichen patches:**
| Knob | What it does |
|---|---|
| `IRON_VEIN_FREQUENCY` | How many rusty orange veins run through the rock |
| `IRON_VEIN_STRENGTH` | How visible the iron coloring is |
| `LICHEN_STRENGTH` | How visible the green-gray lichen patches are |
| `LICHEN_MIN`, `LICHEN_MAX` | Which surface angles get lichen (currently upward-facing areas) |

**Animated glow effects — light that pulses from inside the cracks:**
| Knob | What it does |
|---|---|
| `ROCK_GLOW_INTENSITY` | Strength of the cyan-blue light in deep cracks |
| `ROCK_EMBER_INTENSITY` | Strength of the orange-red ember glow |

The glow colors are defined inline in the shader: cyan abyss glow `(0.10, 0.84, 0.96)` and orange ember glow `(0.94, 0.30, 0.16)`. To change these colors, search for `abyssGlow` and `emberGlow` in the emissive section of the shader.

### 6. Rock silhouettes — the procedural shape

Each rock is generated from a sphere that gets sculpted by layered noise.

**File:** `app/utils/rockGeometry.ts` — constants at the top.

| What you're shaping | Constant | What it does |
|---|---|---|
| Overall mass | `ROCK_MACRO_MASS_STRENGTH` | How much the big-scale noise pushes the surface in and out |
| Asymmetry | `ROCK_MACRO_ASYMMETRY_STRENGTH` | How lopsided and irregular the overall form is |
| Surface warp | `ROCK_DOMAIN_WARP_STRENGTH` | How much the noise coordinates get twisted before sampling — more warp = more organic |
| Ridge sharpness | `ROCK_STACK_RIDGE_STRENGTH` | How pronounced the sharp ridges are |
| Basin depth | `ROCK_STACK_BASIN_STRENGTH` | How deep the concave pockets carve in |
| Erosion | `ROCK_EROSION_STRENGTH` | How much the sides get eaten away, like real weathering |
| Crown softening | `ROCK_CROWN_SOFTEN_STRENGTH` | How rounded the tops become |
| Base flatness | `ROCK_FOOTING_Y_MIN`, `ROCK_FOOTING_Y_MAX` | How the bottom flattens out to sit on the ground |

### 7. World layout

Where things are placed, how big they are, and the ground colors.

**Files:** `app/utils/constants.ts` for ground/rocks/grass layout, `app/vegetation/trees/treeConfig.ts` for procedural tree system knobs.

| What you're shaping | Constant | What it does |
|---|---|---|
| Rock positions | `ROCK_FORMATIONS[].position` | World coordinates `[x, y, z]` for each rock cluster |
| Rock visual scale | `ROCK_FORMATIONS[].scale` | Stretch in each axis — `[width, height, depth]` |
| Rock collision size | `ROCK_FORMATIONS[].collider` | Invisible box the player bumps into — should roughly match visual scale |
| Grass field color | `GRASS_FIELD_COLOR` | Main ground plane color |
| Grass patch color | `GRASS_PATCH_COLOR` | Overlay circle color — slightly darker for variation |
| Rock base color | `ROCK_MATERIAL_COLOR` | Base tint before shader effects layer on top |
| Ground size | `GROUND_HALF_EXTENT` | Half-width of the ground plane in meters |
| Tree generation, species mix, LOD distances | `TREE_SYSTEM_CONFIG` | Central tree settings for placement, growth, meshing, and rendering thresholds |

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
4. Check the result from first-person, third-person follow, and third-person free-look camera modes.

### For adding new visual elements

1. State what the element is and where it should appear.
2. Follow existing patterns: new world objects go in `WorldGeometry.tsx` with a `RigidBody` wrapper. New shader effects extend the existing `onBeforeCompile` pipeline in `shaders.ts`. New global constants go in `constants.ts`, while tree-system constants belong in `app/vegetation/trees/treeConfig.ts`.
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

**Character-camera coupling:** In `first_person` and `third_person`, the character faces where the camera points. In `third_person_free_look`, mouse look rotates camera only; character heading is driven by movement direction. The yaw sign inversion (`CHARACTER_CAMERA_YAW_SIGN = -1`) and model offset (`CHARACTER_MODEL_YAW_OFFSET = Math.PI`) are calibrated to the model. The visual root stays at a fixed local offset under the physics capsule so vertical placement is fully physics-driven.

**Root motion stripping:** Animation clips have root translation tracks removed so physics controls position. New animations need the same treatment (see `characterAnimation.ts`). Locomotion/airborne clips are matched by alias and played as `idle`, `walk`, `running`, `jump`, `jump_running`; emote clips are matched as `happy` and `sad`.

**Collider-visual alignment:** Each rock's `collider` size should roughly match its `scale`. If you resize a rock visually, update its collider too or the player will bump into invisible walls or walk through visible rock.

**Character asset:** Single rigged glTF at `public/models/character/character_new.gltf`. Character root is centered in X/Z, grounded at local Y=0, auto-scaled to target height (1.85m). Mesh shadows enabled.

---

## Validating your changes

- Move around. Does the character accelerate, stop, and turn the way you intended?
- Cycle all camera modes (press V). Do transitions feel coherent, and does free-look keep camera orbit independent from heading while idle?
- Jump near rocks. Does the character land on them as expected, or clip through?
- Look at rocks from all camera modes. Do the shader effects (glow, strata, bump) read well at different distances and angles?
- Walk into fog. Does the atmosphere fade feel natural at the distance you set?
- If you changed animation timing, watch transitions between idle, walk, run, and jump. Do the blends feel smooth or do they pop?

---

## Assumption change rule

When changing camera, movement, coordinate-space, or animation coupling behavior: preserve the assumptions documented above, or update this file in the same change. Do not leave behavior and documentation out of sync.

---

## File map

| Layer | Primary file |
|---|---|
| Movement, camera, timing, layout, colors | `app/utils/constants.ts` |
| Lighting, shadows, fog, canvas setup | `app/scene/CharacterRigScene.tsx` |
| Ground plane, grass, rock placement | `app/scene/WorldGeometry.tsx` |
| Tree config + species tuning | `app/vegetation/trees/treeConfig.ts` |
| Tree generation + meshing + LOD rendering | `app/vegetation/trees/` |
| Rock surface shader effects | `app/utils/shaders.ts` |
| Rock procedural shape | `app/utils/rockGeometry.ts` |
| Character model, animation playback | `app/lib/CharacterActor.tsx` |
| Animation helpers, clip processing | `app/lib/characterAnimation.ts` |
| Input and per-frame gameplay loop | `app/controller/CharacterRigController.tsx` |
| Camera application logic | `app/camera/cameraRig.ts` |
| Direction and angle math | `app/utils/math.ts` |
| Motion state resolution | `app/utils/physics.ts` |
