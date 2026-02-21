"use client";

import { useLoader } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  MOTORBIKE_MOUNT_DISTANCE,
  MOTORBIKE_TEXTURE_PATH,
} from "../../utils/constants";
import type {
  MotorbikeDriverInput,
  MotorbikeMountableApi,
} from "./motorbikeTypes";
import { useRapierRaycastBike } from "./useRapierRaycastBike";
import type { BikeInput } from "./useRapierRaycastBike";

interface MotorbikeMountableProps {
  readonly url: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

const scratchSeatPosition = new THREE.Vector3();

type MappedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
};

function applyBaseColorTexture(
  material: THREE.Material,
  texture: THREE.Texture,
) {
  const mappedMaterial = material as MappedMaterial;
  if (!("map" in mappedMaterial)) {
    return;
  }
  mappedMaterial.map = texture;
  if (mappedMaterial.color) {
    mappedMaterial.color.setRGB(1, 1, 1);
  }
  mappedMaterial.needsUpdate = true;
}

export const MotorbikeMountable = forwardRef<
  MotorbikeMountableApi,
  MotorbikeMountableProps
>(function MotorbikeMountable({ url, position, rotation }, ref) {
  const { rapier } = useRapier();

  // Chassis rigid body ref — populated via callback ref
  const chassisRbRef = useRef<RapierRigidBody | null>(null);

  // Anchor objects (world positions tracked via Three.js scene graph inside RigidBody)
  const seatMount = useMemo(() => new THREE.Object3D(), []);
  const dismountLeft = useMemo(() => new THREE.Object3D(), []);
  const dismountRight = useMemo(() => new THREE.Object3D(), []);

  // Physics input/enable refs fed into the vehicle controller hook
  const bikeInputRef = useRef<BikeInput>({
    throttle: 0,
    steer: 0,
    brake: 0,
    handbrake: false,
  });
  const enabledRef = useRef(false);

  const fbx = useLoader(FBXLoader, url);
  const loadedMainTexture = useLoader(
    THREE.TextureLoader,
    MOTORBIKE_TEXTURE_PATH,
  );
  const bikeTexture = useMemo(() => {
    const texture = loadedMainTexture.clone();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [loadedMainTexture]);
  useEffect(() => () => bikeTexture.dispose(), [bikeTexture]);

  const model = useMemo(() => {
    const cloned = fbx.clone(true);
    cloned.traverse((child) => {
      if (child instanceof THREE.Light || child instanceof THREE.Camera) {
        child.visible = false;
        return;
      }
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (Array.isArray(child.material)) {
          for (const material of child.material) {
            applyBaseColorTexture(material, bikeTexture);
          }
          return;
        }
        applyBaseColorTexture(child.material, bikeTexture);
      }
    });
    return cloned;
  }, [bikeTexture, fbx]);

  // Drives the chassis via Rapier's DynamicRayCastVehicleController
  useRapierRaycastBike({
    chassisRef: chassisRbRef,
    inputRef: bikeInputRef,
    enabledRef,
  });

  // Callback ref: store the chassis rigid body once the RigidBody mounts
  const onChassisRef = useCallback((rb: RapierRigidBody | null) => {
    chassisRbRef.current = rb;
  }, []);

  const initialQuaternion = useMemo(
    () =>
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotation[0], rotation[1], rotation[2]),
      ),
    [rotation],
  );

  useImperativeHandle(
    ref,
    (): MotorbikeMountableApi => ({
      getSeatMountWorld(outPosition, outQuaternion) {
        seatMount.getWorldPosition(outPosition);
        seatMount.getWorldQuaternion(outQuaternion);
      },
      getDismountWorld(side, outPosition, outQuaternion) {
        const dismountAnchor = side === "left" ? dismountLeft : dismountRight;
        dismountAnchor.getWorldPosition(outPosition);
        dismountAnchor.getWorldQuaternion(outQuaternion);
        return true;
      },
      canMountFrom(worldPosition) {
        if (enabledRef.current) {
          return false;
        }
        seatMount.getWorldPosition(scratchSeatPosition);
        return (
          scratchSeatPosition.distanceToSquared(worldPosition) <=
          MOTORBIKE_MOUNT_DISTANCE * MOTORBIKE_MOUNT_DISTANCE
        );
      },
      setPossessed(active) {
        enabledRef.current = active;
        const rb = chassisRbRef.current;
        if (!rb) return;
        if (active) {
          bikeInputRef.current.throttle = 0;
          bikeInputRef.current.steer = 0;
          bikeInputRef.current.brake = 1;
          bikeInputRef.current.handbrake = false;
          rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
          rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
          rb.setBodyType(rapier.RigidBodyType.Dynamic, true);
          rb.wakeUp();
        } else {
          bikeInputRef.current.throttle = 0;
          bikeInputRef.current.steer = 0;
          bikeInputRef.current.brake = 0;
          bikeInputRef.current.handbrake = false;
          // Zero velocity before freezing so the bike doesn't drift on dismount
          rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
          rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
          rb.setBodyType(rapier.RigidBodyType.Fixed, true);
        }
      },
      getChassisLinvel(out) {
        const rb = chassisRbRef.current;
        if (!rb) {
          out.x = 0;
          out.y = 0;
          out.z = 0;
          return;
        }
        const v = rb.linvel();
        out.x = v.x;
        out.y = v.y;
        out.z = v.z;
      },
      // No-op: bike drives itself via physics
      setMountedTransform() {},
      // No-op: bike stays at physics position; setPossessed(false) freezes it
      setParkedTransform() {},
      setDriverInput(input: MotorbikeDriverInput) {
        bikeInputRef.current.throttle = input.throttle;
        bikeInputRef.current.steer = input.steer;
        bikeInputRef.current.brake = input.brake;
        bikeInputRef.current.handbrake = input.handbrake;
      },
    }),
    [dismountLeft, dismountRight, seatMount, rapier],
  );

  return (
    <RigidBody
      ref={onChassisRef}
      type="fixed"
      colliders={false}
      position={position}
      quaternion={[
        initialQuaternion.x,
        initialQuaternion.y,
        initialQuaternion.z,
        initialQuaternion.w,
      ]}
      canSleep={false}
      linearDamping={0.3}
      angularDamping={2.0}
    >
      {/* Chassis colliders — narrow and centered for stable raycast vehicle */}
      <CuboidCollider args={[0.28, 0.35, 0.9]} position={[0, 0.75, 0]} />
      <CuboidCollider args={[0.18, 0.2, 0.3]} position={[0, 1.0, 0.45]} />

      {/* Anchor objects — world positions auto-tracked via scene graph */}
      <primitive object={seatMount} position={[0, 0.95, -0.02]} />
      <primitive object={dismountLeft} position={[-0.95, 1.0, -0.15]} />
      <primitive object={dismountRight} position={[0.95, 1.0, -0.15]} />

      {/* Bike mesh */}
      <primitive scale={0.004} object={model} />
    </RigidBody>
  );
});
