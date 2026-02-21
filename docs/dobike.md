My preferred strategy in your setup (R3F + Drei + Rapier) is:

Use a staged approach

Phase 1 (best balance of speed + quality):

Arcade bike controller on a single Rapier rigid body
• one chassis rigid body
• explicit colliders
• fake traction / steering / lean
• visual wheels only (or simple spin)

This gets you a playable bike fast and integrates cleanly with your mount/dismount system.

Phase 2 (my preferred “real” upgrade path):

Rapier’s DynamicRayCastVehicleController
• raycast wheels (no wheel rigid bodies needed)
• suspension + contact normals + slip/friction controls
• much easier than building wheel joints + suspension from scratch

Rapier exposes this directly in JS via World.createVehicleController(chassis) and the DynamicRayCastVehicleController API. The docs note it updates the chassis rigid body velocity and expects a dynamic (or kinematic-velocity-based) rigid body. ￼

⸻

Is there an npm package that makes it easier?

Yes, but with a caveat

The package I would use is still:
• @react-three/rapier (you already have it)

…and then I’d use Rapier’s built-in vehicle controller API under the hood.

Why: I don’t currently trust a single “drop-in motorcycle package” for your exact stack to be better than using Rapier’s native vehicle controller + your own game-specific tuning. I also don’t see a widely adopted, maintained R3F-specific motorcycle controller package emerging as the clear winner in the search results. The most reliable foundation is Rapier itself + @react-three/rapier. ￼

There are examples and demos around react-three-rapier and Rapier vehicles (including pmndrs demos and Three.js Rapier vehicle examples), which is a good sign for this path. ￼

⸻

What I’d recommend specifically for a motorbike

Cars and bikes are different. A bike needs:
• balance / lean behavior
• steer-to-yaw coupling
• speed-dependent steering limits
• stabilization help at low speed

So my preferred strategy is:

Hybrid “arcade-realistic” motorcycle

Use Rapier raycast vehicle mechanics for the chassis/wheel contact behavior or a simplified chassis controller, but customize bike-specific dynamics in your code:
• add lean torque
• auto-balance assist (especially below a speed threshold)
• counter-steer-ish feel (simplified)
• damping and angular stabilization
• fall-over state if tilt exceeds threshold

That’s usually much better than searching for a generic car package and trying to force it into a bike.

⸻

Decision summary

If you want something working quickly (and tunable):

Build your own arcade bike controller on top of @react-three/rapier.

If you want better wheel-ground behavior without full joint hell:

Use Rapier DynamicRayCastVehicleController (via the Rapier API in your R3F app).

What I would not do first:
• full wheel rigid bodies + suspension joints + tire model from scratch
It’s fun later, but it’s a time sink for a game feature that mainly needs to feel good.

⸻

Why this is the best fit for your current architecture

You already have:
• character possession / mount handoff
• R3F frame loop
• Rapier rigid bodies
• procedural terrain

Raycast vehicle controllers pair really well with that because they avoid a lot of wheel-joint complexity while still giving you proper ground contact queries (contact point, normal, in-contact state, slip/friction tuning, etc.). Rapier’s vehicle controller API exposes those wheel contact details directly. ￼

And for R3F, keeping the fast control loop in useFrame and mutating physics state is the right pattern. (This aligns with R3F’s performance guidance.) ￼

⸻

Practical package stack I’d use
• @react-three/fiber — rendering / frame loop
• @react-three/drei — helpers, camera rigs, debug conveniences
• @react-three/rapier — physics integration
• @dimforge/rapier3d-compat (indirectly via r3/rapier, or explicitly if needed) — access to vehicle controller API directly

If you want a “helper package,” I’d honestly write a small internal wrapper like:
• useMotorbikeController()
• useRapierRaycastBike()

instead of introducing an unproven dependency.

⸻

My preferred implementation path for you (concrete) 1. Arcade bike controller first
• throttle / brake / steer
• yaw torque
• lean torque
• upright stabilization
• speed caps
• drift/slip feel tuning 2. Mount/dismount integration
• possession handoff
• character pose on bike
• input routing to bike 3. Raycast wheel upgrade (Rapier vehicle controller)
• suspension tuning
• wheel friction/slip
• terrain contact handling on uneven chunks 4. Bike polish
• wheel spin visuals
• handlebar steer animation
• rider body lean animation
• crash/fall recovery

⸻

If you want, next step

I can give you a useMotorbikeController hook in R3F + Rapier with:
• an arcade version (single rigid body)
• and a Rapier raycast vehicle version scaffold (using DynamicRayCastVehicleController)
so you can A/B them in your current mount system.
