Absolutely — this is the right direction.

For your setup (R3F + @react-three/rapier), I’d build a small wrapper hook around Rapier’s DynamicRayCastVehicleController and keep the rest of your game logic (mount/dismount, rider pose, camera) independent.

Rapier’s World exposes createVehicleController(chassis) and the controller supports wheel setup (addWheel) plus per-wheel tuning/inputs (setWheelEngineForce, setWheelBrake, setWheelSteering, suspension/friction settings), then updateVehicle(dt, ...) each step. It directly updates the chassis body’s velocity. ￼

@react-three/rapier also gives you direct world access via advanced hooks like useRapier, which is exactly what we need here. ￼

⸻

High-level strategy for a bike (with raycast vehicle)

Even though Rapier’s raycast vehicle API is very car-shaped, you can still use it for a bike if you:
• use 2 wheels (front/rear)
• keep a single chassis rigid body
• add balance assist / lean torque in your own code
• treat wheel meshes as visuals only (the raycast controller is the “real” wheel contact)

That gives you suspension/contact behavior without wheel rigid-body joint complexity.

⸻

1. Minimal chassis + visual skeleton component

This is the physics body the vehicle controller will drive.

// MotorbikeChassis.tsx
"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { RigidBody, CuboidCollider, RapierRigidBody } from "@react-three/rapier";
import \* as THREE from "three";

export type MotorbikeChassisApi = {
rb: RapierRigidBody | null;
visual: THREE.Group | null;
};

type Props = {
position?: [number, number, number];
children?: React.ReactNode; // your bike mesh / dae / gltf visual
};

export const MotorbikeChassis = forwardRef<MotorbikeChassisApi, Props>(
function MotorbikeChassis({ position = [0, 2, 0], children }, ref) {
const rbRef = useRef<RapierRigidBody>(null);
const visualRef = useRef<THREE.Group>(null);

    useImperativeHandle(ref, () => ({
      rb: rbRef.current,
      visual: visualRef.current,
    }));

    return (
      <RigidBody
        ref={rbRef}
        type="dynamic"
        colliders={false}
        position={position}
        canSleep={false}
        linearDamping={0.25}
        angularDamping={1.8}
      >
        {/* Chassis collider(s): keep these simple and centered */}
        <CuboidCollider args={[0.28, 0.35, 0.9]} position={[0, 0.75, 0]} />
        <CuboidCollider args={[0.18, 0.2, 0.3]} position={[0, 1.0, 0.45]} />

        <group ref={visualRef}>
          {children}
        </group>
      </RigidBody>
    );

}
);

A centered rigid body / collider setup is recommended in r3/rapier docs because off-center bodies can behave unexpectedly during simulation/interpolation. ￼

⸻

2. A useRapierRaycastBike hook (core)

This hook:
• creates the Rapier vehicle controller
• adds two wheels
• applies throttle/brake/steer each frame
• updates wheel visuals (optional)
• adds bike-specific stabilization (upright assist + lean feel)

// useRapierRaycastBike.ts
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import \* as THREE from "three";

type BikeInput = {
throttle: number; // -1..1
steer: number; // -1..1
brake: number; // 0..1
handbrake: boolean;
};

type WheelSpec = {
connection: [number, number, number]; // chassis local position
radius: number;
suspensionRest: number;
isFront: boolean;
};

type Options = {
chassisRef: React.RefObject<RapierRigidBody | null>;
visualRootRef?: React.RefObject<THREE.Object3D | null>;
wheelVisuals?: {
front?: React.RefObject<THREE.Object3D | null>;
rear?: React.RefObject<THREE.Object3D | null>;
};
inputRef: React.MutableRefObject<BikeInput>;
enabledRef: React.MutableRefObject<boolean>;
};

type InternalWheel = WheelSpec & { index: number };

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

export function useRapierRaycastBike({
chassisRef,
visualRootRef,
wheelVisuals,
inputRef,
enabledRef,
}: Options) {
const { world, rapier } = useRapier();

const vehicleRef = useRef<any>(null); // DynamicRayCastVehicleController
const wheelStateRef = useRef<InternalWheel[]>([]);
const smoothedSteerRef = useRef(0);
const wheelSpinRef = useRef({ front: 0, rear: 0 });

// Tune these aggressively for "game feel"
const config = useMemo(
() => ({
forwardAxis: 2, // Z forward in chassis local-space
upAxis: 1, // Y up
suspensionDirection: { x: 0, y: -1, z: 0 },
axle: { x: 1, y: 0, z: 0 },

      engineForceRear: 90,
      engineForceFront: 10, // tiny pull for stability; set 0 for RWD-only feel
      brakeForce: 4.5,
      handbrakeForce: 10,
      maxSteerAtLowSpeed: 0.45,  // radians
      maxSteerAtHighSpeed: 0.14, // radians
      steerSpeed: 10.0,          // smoothing
      speedForSteerReduction: 18,

      // Suspension / traction starter values
      suspensionStiffness: 24,
      suspensionCompression: 2.8,
      suspensionRelaxation: 3.5,
      maxSuspensionTravel: 0.22,
      maxSuspensionForce: 140,
      frictionSlip: 2.2,
      sideFrictionStiffness: 1.2,

      // Bike-specific stabilization (not from vehicle API)
      uprightTorque: 16,
      uprightDamping: 4,
      leanVisualFactor: 0.35,
      lowSpeedBalanceAssist: 1.0,
    }),
    []

);

useEffect(() => {
const rb = chassisRef.current;
if (!rb) return;

    // Create controller from Rapier world + chassis.
    // Rapier World.createVehicleController(chassis) returns a DynamicRayCastVehicleController.
    const vehicle = world.createVehicleController(rb.raw());
    vehicleRef.current = vehicle;

    // Axes (Rapier docs expose chassis local forward/up axis setters/getters)
    // NOTE: Depending on your rapier bindings version, forward-axis setter may be exposed
    // as `indexForwardAxis = ...` or the oddly named `setIndexForwardAxis = ...`.
    // The docs currently show `set setIndexForwardAxis(axis)`.
    try {
      vehicle.indexUpAxis = config.upAxis;
    } catch {}
    try {
      vehicle.indexForwardAxis = config.forwardAxis;
    } catch {
      try {
        vehicle.setIndexForwardAxis = config.forwardAxis;
      } catch {}
    }

    // Two-wheel bike layout (front / rear)
    const wheelSpecs: WheelSpec[] = [
      {
        isFront: true,
        connection: [0, 0.55, 0.72],
        radius: 0.34,
        suspensionRest: 0.22,
      },
      {
        isFront: false,
        connection: [0, 0.55, -0.68],
        radius: 0.36,
        suspensionRest: 0.22,
      },
    ];

    wheelStateRef.current = [];

    for (let i = 0; i < wheelSpecs.length; i++) {
      const w = wheelSpecs[i];

      vehicle.addWheel(
        { x: w.connection[0], y: w.connection[1], z: w.connection[2] },
        config.suspensionDirection,
        config.axle,
        w.suspensionRest,
        w.radius
      );

      vehicle.setWheelSuspensionStiffness(i, config.suspensionStiffness);
      vehicle.setWheelSuspensionCompression(i, config.suspensionCompression);
      vehicle.setWheelSuspensionRelaxation(i, config.suspensionRelaxation);
      vehicle.setWheelMaxSuspensionTravel(i, config.maxSuspensionTravel);
      vehicle.setWheelMaxSuspensionForce(i, config.maxSuspensionForce);
      vehicle.setWheelFrictionSlip(i, config.frictionSlip);
      vehicle.setWheelSideFrictionStiffness(i, config.sideFrictionStiffness);

      wheelStateRef.current.push({ ...w, index: i });
    }

    return () => {
      // remove from world on unmount
      if (vehicleRef.current) {
        try {
          world.removeVehicleController(vehicleRef.current);
        } catch {}
        try {
          vehicleRef.current.free?.();
        } catch {}
        vehicleRef.current = null;
      }
    };

}, [world, chassisRef, config]);

// Run this before the physics step so the chassis velocity update is part of the step.
useBeforePhysicsStep((\_, dt) => {
const vehicle = vehicleRef.current;
const rb = chassisRef.current;
if (!vehicle || !rb) return;

    const input = inputRef.current;
    const enabled = enabledRef.current;

    // Zero inputs when not possessed/active
    const throttle = enabled ? clamp(input.throttle, -1, 1) : 0;
    const brake = enabled ? clamp(input.brake, 0, 1) : 0;
    const steer = enabled ? clamp(input.steer, -1, 1) : 0;
    const handbrake = enabled ? !!input.handbrake : false;

    // Speed-based steering reduction
    const speed = Math.abs(vehicle.currentVehicleSpeed?.() ?? 0);
    const steerT = clamp(speed / config.speedForSteerReduction, 0, 1);
    const maxSteer = lerp(config.maxSteerAtLowSpeed, config.maxSteerAtHighSpeed, steerT);

    // Steering smoothing
    const targetSteer = steer * maxSteer;
    smoothedSteerRef.current = lerp(
      smoothedSteerRef.current,
      targetSteer,
      clamp(dt * config.steerSpeed, 0, 1)
    );

    // Reset wheel forces each step, then apply
    for (const w of wheelStateRef.current) {
      vehicle.setWheelEngineForce(w.index, 0);
      vehicle.setWheelBrake(w.index, 0);
      vehicle.setWheelSteering(w.index, 0);
    }

    for (const w of wheelStateRef.current) {
      if (w.isFront) {
        vehicle.setWheelSteering(w.index, smoothedSteerRef.current);

        // Optional tiny front drive helps stabilize some setups
        vehicle.setWheelEngineForce(w.index, throttle * config.engineForceFront);
      } else {
        vehicle.setWheelEngineForce(w.index, throttle * config.engineForceRear);
      }

      if (brake > 0) {
        vehicle.setWheelBrake(w.index, brake * config.brakeForce);
      }

      if (handbrake && !w.isFront) {
        vehicle.setWheelBrake(w.index, config.handbrakeForce);
      }
    }

    // Filter wheel rays so they don't hit your own bike colliders if needed.
    // You can pass query filter flags / groups / predicate to updateVehicle().
    // Rapier supports these optional filters on the vehicle raycasts.
    vehicle.updateVehicle(dt);

    // ---- Bike-specific stabilization (important) ----
    // Rapier's raycast vehicle gives you wheel contact + suspension, but bikes still need balance help.
    const rot = rb.rotation(); // quaternion
    const angvel = rb.angvel();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

    // Chassis local up in world-space
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Axis to rotate chassis-up toward world-up (cross product)
    const correctionAxis = new THREE.Vector3().crossVectors(up, worldUp);
    const tiltMag = correctionAxis.length();

    if (tiltMag > 1e-5) {
      correctionAxis.normalize();

      // Low-speed stronger balance assistance
      const lowSpeedBoost = 1 + clamp(1 - speed / 8, 0, 1) * config.lowSpeedBalanceAssist;

      rb.applyTorqueImpulse(
        {
          x:
            correctionAxis.x * config.uprightTorque * lowSpeedBoost * dt -
            angvel.x * config.uprightDamping * dt,
          y: 0, // let steering/yaw be mostly vehicle-driven
          z:
            correctionAxis.z * config.uprightTorque * lowSpeedBoost * dt -
            angvel.z * config.uprightDamping * dt,
        },
        true
      );
    }

    // ---- Optional visual wheel spin from speed ----
    const frontRadius = wheelStateRef.current[0]?.radius ?? 0.34;
    const rearRadius = wheelStateRef.current[1]?.radius ?? 0.36;

    wheelSpinRef.current.front += (speed / Math.max(0.001, frontRadius)) * dt;
    wheelSpinRef.current.rear += (speed / Math.max(0.001, rearRadius)) * dt;

    const frontWheel = wheelVisuals?.front?.current;
    const rearWheel = wheelVisuals?.rear?.current;

    if (frontWheel) {
      frontWheel.rotation.x = wheelSpinRef.current.front;
      frontWheel.rotation.y = smoothedSteerRef.current;
    }
    if (rearWheel) {
      rearWheel.rotation.x = wheelSpinRef.current.rear;
    }

    // ---- Optional visual chassis lean ----
    const visual = visualRootRef?.current;
    if (visual) {
      const targetLean = -smoothedSteerRef.current * clamp(speed / 8, 0, 1) * config.leanVisualFactor;
      visual.rotation.z = lerp(visual.rotation.z, targetLean, clamp(dt * 8, 0, 1));
    }

});

return {
getVehicle: () => vehicleRef.current,
getSpeed: () => vehicleRef.current?.currentVehicleSpeed?.() ?? 0,
};
}

Why useBeforePhysicsStep instead of useFrame?

Because updateVehicle(dt) modifies the chassis velocity, and you generally want that done as part of the physics step, not after it. @react-three/rapier explicitly exposes advanced physics-step hooks for this kind of control. ￼

⸻

3. Using the hook in a bike actor component

This is the glue to your possession system.

// MotorbikeActor.tsx
"use client";

import { useMemo, useRef } from "react";
import \* as THREE from "three";
import type { RapierRigidBody } from "@react-three/rapier";
import { MotorbikeChassis } from "./MotorbikeChassis";
import { useRapierRaycastBike } from "./useRapierRaycastBike";

type BikeInput = {
throttle: number;
steer: number;
brake: number;
handbrake: boolean;
};

export function MotorbikeActor({
bikeInputRef,
possessedRef,
}: {
bikeInputRef: React.MutableRefObject<BikeInput>;
possessedRef: React.MutableRefObject<boolean>;
}) {
const chassisRbRef = useRef<RapierRigidBody | null>(null);
const visualRootRef = useRef<THREE.Group>(null);
const frontWheelRef = useRef<THREE.Mesh>(null);
const rearWheelRef = useRef<THREE.Mesh>(null);

useRapierRaycastBike({
chassisRef: chassisRbRef as React.RefObject<RapierRigidBody | null>,
visualRootRef: visualRootRef as React.RefObject<THREE.Object3D | null>,
wheelVisuals: {
front: frontWheelRef as React.RefObject<THREE.Object3D | null>,
rear: rearWheelRef as React.RefObject<THREE.Object3D | null>,
},
inputRef: bikeInputRef,
enabledRef: possessedRef,
});

return (
<MotorbikeChassis
ref={(api) => {
chassisRbRef.current = api?.rb ?? null;
}}
position={[8, 2, 4]} >
<group ref={visualRootRef}>
{/_ Replace with your DAE visual. These are just placeholders. _/}
<mesh position={[0, 0.85, 0]}>
<boxGeometry args={[0.5, 0.25, 1.8]} />
<meshStandardMaterial color="#444" />
</mesh>

        <mesh ref={frontWheelRef} position={[0, 0.55, 0.72]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.34, 0.34, 0.08, 20]} />
          <meshStandardMaterial color="#111" />
        </mesh>

        <mesh ref={rearWheelRef} position={[0, 0.55, -0.68]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.36, 0.36, 0.11, 20]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>
    </MotorbikeChassis>

);
}

⸻

4. Input routing from your existing possession system

This is the part that plugs into your “character takes control of bike” mechanic.

// somewhere in your possession/controller code
const bikeInputRef = useRef({
throttle: 0,
steer: 0,
brake: 0,
handbrake: false,
});

const possessedBikeRef = useRef(false);

// Example mapping from your unified input state:
function updateBikeInputsFromPlayerInput(input: {
forward: number; // -1..1
turn: number; // -1..1
brake: boolean;
}) {
bikeInputRef.current.throttle = input.forward; // or split accel/reverse
bikeInputRef.current.steer = input.turn;
bikeInputRef.current.brake = input.brake ? 1 : 0;
bikeInputRef.current.handbrake = false;
}

// Mount:
possessedBikeRef.current = true;

// Dismount:
possessedBikeRef.current = false;
bikeInputRef.current = { throttle: 0, steer: 0, brake: 1, handbrake: true };

⸻

5. Wheel-ray filtering (important in your terrain/chunk setup)

Rapier’s updateVehicle supports optional query filters (filterFlags, filterGroups, filterPredicate) for wheel raycasts. This is useful if:
• wheel rays hit sensors
• wheel rays hit bike’s own colliders
• wheel rays hit colliders you want excluded (triggers, pickups, etc.) ￼

Example pattern:

// Inside useBeforePhysicsStep, replace vehicle.updateVehicle(dt) with:
vehicle.updateVehicle(
dt,
undefined, // filterFlags (optional)
undefined, // filterGroups (optional)
(collider: any) => {
// Exclude sensor colliders if needed:
// if (collider.isSensor?.()) return false;

    // Exclude your own chassis colliders by handle if you cache them:
    // if (ownColliderHandles.has(collider.handle)) return false;

    return true;

}
);

⸻

6. A few practical tuning tips for bikes (the “feels good” list)

Start with exaggerated suspension damping

Bikes get jittery fast. Increase:
• setWheelSuspensionCompression
• setWheelSuspensionRelaxation
• setWheelMaxSuspensionForce

Rapier exposes all of these per wheel. ￼

Keep chassis collider narrow and centered

A wide/boxy collider can feel like the bike “catches” terrain edges and fights the wheel controller.

Use a low COM if needed

If the bike is too tippy:
• move collider(s) slightly lower
• add a small invisible ballast collider low in the chassis

Add crash/fall mode later

For now, keep strong upright assist. Later:
• reduce assist at high tilt
• transition to ragdoll/crash state when tilt exceeds threshold

⸻

7. Version/API gotchas (worth knowing)
   • The Rapier docs currently show a somewhat odd forward-axis setter name (setIndexForwardAxis as a setter accessor), so bindings/version differences can exist. The defensive try/fallback in the hook is intentional. ￼
   • DynamicRayCastVehicleController is in Rapier JS 3D docs and managed by the world (createVehicleController / removeVehicleController). ￼
   • @react-three/rapier gives the right hooks (useRapier, physics-step hooks) for integrating this cleanly in React. ￼

⸻

Next step I’d recommend for your exact game

I can give you a bike-specific version of this hook integrated with your mountable API from the previous design:
• setPossessed(active)
• setDriverInput(input)
• seat/grip/peg anchors
• rider pose lean synced to steering/suspension compression

That’ll make it drop directly into your current chunk/decorations architecture.
