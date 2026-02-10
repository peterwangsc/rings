---
name: threejs-fiber-gameplay-foundations
description: Design and iterate on the look, feel, and motion of a 3D character sandbox built with React Three Fiber. Use when shaping how movement feels, how the camera behaves, how surfaces look, how light sets the mood, and how animations land. Covers the full creative palette from rock shader effects to jump timing to fog distance, while preserving the structural engineering underneath.
---

# Game Design & Visual Craft

## What this skill is for

This project is a playable 3D scene with a character you control, a camera that follows them, rocks with living shader surfaces, and a grass field under open sky. Every aspect of how it looks and feels is tunable.

This skill helps you work like a game designer: shaping the experience through small, intentional adjustments to movement, timing, surface, light, and space. Every change should be something you can walk around in and feel.

## The creative palette

Everything you can shape lives in one of these layers. Each layer maps to specific files and values you can adjust.

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

**Design notes:** Walk and run speeds are built from a base value times `PLAYER_SPEED_SCALAR`. Change the scalar to shift both proportionally, or change each individually for a different walk-to-run ratio. Jump air time is calculated automatically from jump velocity and gravity — change either one and the arc adjusts.

### 2. Camera personality

How the camera frames the character, how it responds to your mouse, and how each viewpoint feels.

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

**Design notes:** First-person and third-person have independent FOVs because they frame differently — first-person benefits from wider peripheral awareness, while third-person looks better tighter. The camera does a physics sphere-cast to avoid poking through geometry; the collision radius and skin values control how eagerly it pulls forward.

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
| Movement detection threshold | `WALK_SPEED_THRESHOLD` | Minimum speed before the character switches from idle to walking — prevents twitchy transitions |
| Speed readout smoothing | `PLANAR_SPEED_SMOOTHING` | How smoothly the speed measurement updates — prevents flickering between walk/idle at low speeds |

**Design notes:** The character has five motion states: `idle`, `walk`, `running`, `jump`, `jump_running`. Transitions happen automatically based on speed and input. The blend duration is the single most impactful timing value — it controls how fluid or mechanical transitions feel. Animation playback speed and movement speed are independent, so you can have a character that moves fast but animates calmly, or vice versa.

**Files for deeper animation work:**
- `app/lib/CharacterActor.tsx` — where animation clips are loaded and the mixer is managed
- `app/lib/characterAnimation.ts` — helper functions for clip lookup, root motion stripping, character scaling
- `app/lib/characterTypes.ts` — motion state type definitions

### 4. Lighting & atmosphere

The mood of the scene — sky color, fog, sun direction, ambient tone.

**File:** `app/utils/constants.ts` for colors and fog range. `app/scene/CharacterRigScene.tsx` for light positions and intensities.

| What you're shaping | Where | What it does |
|---|---|---|
| Sky color | `SKY_BACKGROUND_COLOR` in constants | Background color and fog color (currently pale blue `#CFE9FF`) |
| Fog start | `SKY_FOG_NEAR` in constants | How close fog begins (currently 35 units) |
| Fog end | `SKY_FOG_FAR` in constants | Where fog becomes fully opaque (currently 135 units) — closer = more enclosed, farther = more open |
| Sky/ground ambient tint | `hemisphereLight` in CharacterRigScene | Two-tone ambient: sky tint `#EAF6FF` from above, ground tint `#8AA36D` from below |
| Fill light | `ambientLight` in CharacterRigScene | Flat overall brightness (currently 0.95) |
| Sun color and power | `directionalLight` in CharacterRigScene | Warm key light `#FFF4D6` at intensity 1.35 |
| Sun direction | `directionalLight position` in CharacterRigScene | Where shadows fall from — currently `[8, 14, 6]` (high and slightly behind-right) |
| Shadow quality | `shadow-mapSize` in CharacterRigScene | Shadow map resolution (currently 2048x2048) |

**Design notes:** The hemisphere light is the main tool for overall color mood — its sky tint washes the tops of everything, its ground tint washes the undersides. The directional light adds shape through shadows. Fog distance dramatically affects how intimate or vast the world feels.

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

The glow colors themselves are defined inline in the shader: cyan abyss glow `(0.10, 0.84, 0.96)` and orange ember glow `(0.94, 0.30, 0.16)`. To change these colors, search for `abyssGlow` and `emberGlow` in the emissive section of the shader.

### 6. Rock silhouettes — the procedural shape

Each rock is generated from a sphere that gets sculpted by layered noise. The shape constants control how natural and varied the rocks look.

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

**File:** `app/utils/constants.ts`

| What you're shaping | Constant | What it does |
|---|---|---|
| Rock positions | `ROCK_FORMATIONS[].position` | World coordinates `[x, y, z]` for each rock cluster |
| Rock visual scale | `ROCK_FORMATIONS[].scale` | Stretch in each axis — `[width, height, depth]` |
| Rock collision size | `ROCK_FORMATIONS[].collider` | Invisible box the player bumps into — should roughly match visual scale |
| Grass field color | `GRASS_FIELD_COLOR` | Main ground plane color |
| Grass patch color | `GRASS_PATCH_COLOR` | Overlay circle color — slightly darker for variation |
| Rock base color | `ROCK_MATERIAL_COLOR` | Base tint before shader effects layer on top |
| Ground size | `GROUND_HALF_EXTENT` | Half-width of the ground plane in meters |

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
4. Check the result from both first-person and third-person camera.

### For adding new visual elements

1. State what the element is and where it should appear.
2. Follow existing patterns: new world objects go in `WorldGeometry.tsx` with a `RigidBody` wrapper. New shader effects extend the existing `onBeforeCompile` pipeline in `shaders.ts`. New constants go in `constants.ts`.
3. Keep shader work inside the `MeshStandardMaterial` customization pattern — don't replace it with a raw `ShaderMaterial` unless the standard pipeline can't do what you need.

### Implementation order when building a new feature

1. Pure helpers first — math functions, color utilities, any calculations.
2. State and input — what triggers the feature, what data it needs.
3. Actor and transform — how the character or objects move or change.
4. Camera — any framing adjustments, only after transforms are stable.
5. Surface and shader — visual polish last, once the behavior is locked.

## Load-bearing walls

These are structural decisions that keep the whole system working. Don't change them without understanding the consequences.

- **Coordinate system:** Right-handed. `+Y` up, `-Z` forward, `+X` right. Movement math, camera math, and character facing all depend on this. Changing a sign somewhere will flip or mirror behavior in hard-to-debug ways.
- **Physics authority:** The character's vertical position is controlled entirely by the Rapier physics engine (gravity, collisions). Never manually set the Y position per frame.
- **Character-camera coupling:** The character faces the direction the camera points. The yaw sign inversion (`CHARACTER_CAMERA_YAW_SIGN = -1`) and model offset (`CHARACTER_MODEL_YAW_OFFSET = Math.PI`) make this work. These values are calibrated to the model.
- **Root motion stripping:** Animation clips have their root translation tracks removed so physics controls position. If you add new animations, they need the same treatment (see `characterAnimation.ts`).
- **Collider-visual alignment:** Each rock's `collider` size should roughly match its `scale`. If you resize a rock visually, update its collider too or the player will bump into invisible walls (or walk through visible rock).

## Validating your changes

After making adjustments, walk through these checks:

- Move around. Does the character accelerate, stop, and turn the way you intended?
- Switch between first-person and third-person (press V). Does the transition feel coherent? Is the look direction preserved?
- Jump near rocks. Does the character land on them as expected, or clip through?
- Look at rocks from both camera modes. Do the shader effects (glow, strata, bump) read well at different distances and angles?
- Walk into fog. Does the atmosphere fade feel natural at the distance you set?
- If you changed animation timing, watch transitions between idle, walk, run, and jump. Do the blends feel smooth or do they pop?

## Quick reference: file map

| Creative layer | Primary file |
|---|---|
| Movement, camera, timing, layout, colors | `app/utils/constants.ts` |
| Lighting, shadows, fog, canvas setup | `app/scene/CharacterRigScene.tsx` |
| Ground plane, grass, rock placement | `app/scene/WorldGeometry.tsx` |
| Rock surface shader effects | `app/utils/shaders.ts` |
| Rock procedural shape | `app/utils/rockGeometry.ts` |
| Character model, animation playback | `app/lib/CharacterActor.tsx` |
| Animation helpers, clip processing | `app/lib/characterAnimation.ts` |
| Input and per-frame gameplay loop | `app/controller/CharacterRigController.tsx` |
| Camera application logic | `app/camera/cameraRig.ts` |
| Direction and angle math | `app/utils/math.ts` |
| Motion state resolution | `app/utils/physics.ts` |
