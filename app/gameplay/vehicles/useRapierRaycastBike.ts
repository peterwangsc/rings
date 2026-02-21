"use client";

import { useEffect, useRef } from "react";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import type { DynamicRayCastVehicleController } from "@dimforge/rapier3d-compat";
import * as THREE from "three";

export type BikeInput = {
  throttle: number; // -1..1
  steer: number; // -1..1
  brake: number; // 0..1
  handbrake: boolean;
};

const SUSPENSION_DIRECTION = { x: 0, y: -1, z: 0 } as const;
const AXLE_CS = { x: 1, y: 0, z: 0 } as const;

// Wheel layout in chassis local space
// Forward axis is +Z, up is +Y
const WHEEL_SPECS = [
  {
    isFront: true,
    connection: { x: 0, y: 0.55, z: 0.72 },
    radius: 0.34,
    suspensionRest: 0.22,
  },
  {
    isFront: false,
    connection: { x: 0, y: 0.55, z: -0.68 },
    radius: 0.36,
    suspensionRest: 0.22,
  },
] as const;

const ENGINE_FORCE_REAR = 90;
const ENGINE_FORCE_FRONT = 10;
const BRAKE_FORCE = 4.5;
const HANDBRAKE_FORCE = 10;
const MAX_STEER_LOW_SPEED = 0.45; // radians
const MAX_STEER_HIGH_SPEED = 0.14; // radians
const STEER_SMOOTHING = 10.0;
const SPEED_FOR_STEER_REDUCTION = 18; // m/s
const SUSPENSION_STIFFNESS = 24;
const SUSPENSION_COMPRESSION = 2.8;
const SUSPENSION_RELAXATION = 3.5;
const MAX_SUSPENSION_TRAVEL = 0.22;
const MAX_SUSPENSION_FORCE = 140;
const FRICTION_SLIP = 2.2;
const SIDE_FRICTION_STIFFNESS = 1.2;
const UPRIGHT_TORQUE = 16;
const UPRIGHT_DAMPING = 4;
const LOW_SPEED_BALANCE_ASSIST = 1.0;
const BALANCE_LOW_SPEED_THRESHOLD = 8; // m/s

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

// Reusable scratch objects to avoid per-frame allocations
const scratchQ = new THREE.Quaternion();
const scratchChassisUp = new THREE.Vector3();
const scratchWorldUp = new THREE.Vector3(0, 1, 0);
const scratchCorrectionAxis = new THREE.Vector3();

type RaycastCollider = {
  handle: number;
};

export function useRapierRaycastBike({
  chassisRef,
  inputRef,
  enabledRef,
}: {
  chassisRef: React.RefObject<RapierRigidBody | null>;
  inputRef: React.MutableRefObject<BikeInput>;
  enabledRef: React.MutableRefObject<boolean>;
}) {
  const { world, rapier } = useRapier();
  const vehicleRef = useRef<DynamicRayCastVehicleController | null>(null);
  const smoothedSteerRef = useRef(0);
  const chassisColliderHandlesRef = useRef(new Set<number>());
  const wheelRayFilterPredicateRef = useRef((collider: RaycastCollider) => {
    return !chassisColliderHandlesRef.current.has(collider.handle);
  });

  // Cleanup vehicle controller on unmount
  useEffect(() => {
    return () => {
      const vehicle = vehicleRef.current;
      if (vehicle) {
        try {
          world.removeVehicleController(vehicle);
        } catch {}
        vehicleRef.current = null;
      }
    };
  }, [world]);

  useBeforePhysicsStep((world) => {
    const rb = chassisRef.current;
    if (!rb) return;
    const chassisColliderHandles = chassisColliderHandlesRef.current;
    chassisColliderHandles.clear();
    const chassisColliderCount = rb.numColliders();
    for (let i = 0; i < chassisColliderCount; i++) {
      const colliderHandle = rb.collider(i);
      if (typeof colliderHandle === "number") {
        chassisColliderHandles.add(colliderHandle);
      }
    }

    // Lazily create the vehicle controller once the chassis rigid body is available
    if (!vehicleRef.current) {
      const vehicle = world.createVehicleController(rb);
      vehicle.indexUpAxis = 1; // Y up
      vehicle.setIndexForwardAxis = 2; // Z forward

      for (let i = 0; i < WHEEL_SPECS.length; i++) {
        const w = WHEEL_SPECS[i];
        vehicle.addWheel(
          w.connection,
          SUSPENSION_DIRECTION,
          AXLE_CS,
          w.suspensionRest,
          w.radius,
        );
        vehicle.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
        vehicle.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
        vehicle.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
        vehicle.setWheelMaxSuspensionTravel(i, MAX_SUSPENSION_TRAVEL);
        vehicle.setWheelMaxSuspensionForce(i, MAX_SUSPENSION_FORCE);
        vehicle.setWheelFrictionSlip(i, FRICTION_SLIP);
        vehicle.setWheelSideFrictionStiffness(i, SIDE_FRICTION_STIFFNESS);
      }

      vehicleRef.current = vehicle;
    }

    const vehicle = vehicleRef.current;
    const dt = world.timestep;
    const enabled = enabledRef.current;
    const input = inputRef.current;

    const throttle = enabled ? clamp(input.throttle, -1, 1) : 0;
    const brake = enabled ? clamp(input.brake, 0, 1) : 0;
    const steer = enabled ? clamp(input.steer, -1, 1) : 0;
    const handbrake = enabled && input.handbrake;

    const speed = Math.abs(vehicle.currentVehicleSpeed());
    const steerT = clamp(speed / SPEED_FOR_STEER_REDUCTION, 0, 1);
    const maxSteer = lerp(MAX_STEER_LOW_SPEED, MAX_STEER_HIGH_SPEED, steerT);
    const targetSteer = steer * maxSteer;
    smoothedSteerRef.current = lerp(
      smoothedSteerRef.current,
      targetSteer,
      clamp(dt * STEER_SMOOTHING, 0, 1),
    );

    // Reset all wheel forces each step
    for (let i = 0; i < 2; i++) {
      vehicle.setWheelEngineForce(i, 0);
      vehicle.setWheelBrake(i, 0);
      vehicle.setWheelSteering(i, 0);
    }

    // Front wheel (0): steer + small front drive
    vehicle.setWheelSteering(0, smoothedSteerRef.current);
    vehicle.setWheelEngineForce(0, throttle * ENGINE_FORCE_FRONT);
    // Rear wheel (1): main drive
    vehicle.setWheelEngineForce(1, throttle * ENGINE_FORCE_REAR);

    if (brake > 0) {
      vehicle.setWheelBrake(0, brake * BRAKE_FORCE);
      vehicle.setWheelBrake(1, brake * BRAKE_FORCE);
    }

    if (handbrake) {
      vehicle.setWheelBrake(1, HANDBRAKE_FORCE);
    }

    vehicle.updateVehicle(
      dt,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      wheelRayFilterPredicateRef.current,
    );

    // Balance assist: apply torque to keep chassis upright (essential for 2-wheel stability)
    const rot = rb.rotation();
    const angvel = rb.angvel();
    scratchQ.set(rot.x, rot.y, rot.z, rot.w);
    scratchChassisUp.set(0, 1, 0).applyQuaternion(scratchQ);
    scratchCorrectionAxis.crossVectors(scratchChassisUp, scratchWorldUp);
    const tiltMag = scratchCorrectionAxis.length();

    if (tiltMag > 1e-5) {
      scratchCorrectionAxis.normalize();
      const lowSpeedBoost =
        1 + clamp(1 - speed / BALANCE_LOW_SPEED_THRESHOLD, 0, 1) * LOW_SPEED_BALANCE_ASSIST;
      rb.applyTorqueImpulse(
        {
          x:
            scratchCorrectionAxis.x * UPRIGHT_TORQUE * lowSpeedBoost * dt -
            angvel.x * UPRIGHT_DAMPING * dt,
          y: 0,
          z:
            scratchCorrectionAxis.z * UPRIGHT_TORQUE * lowSpeedBoost * dt -
            angvel.z * UPRIGHT_DAMPING * dt,
        },
        true,
      );
    }
  });

  return {
    getSpeed: () => vehicleRef.current?.currentVehicleSpeed() ?? 0,
  };
}
