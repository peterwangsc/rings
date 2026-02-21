import type * as THREE from "three";

export interface MotorbikeDriverInput {
  throttle: number;
  steer: number;
  brake: number;
  handbrake: boolean;
}

export interface MotorbikeMountableApi {
  getSeatMountWorld(
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion,
  ): void;
  getDismountWorld(
    side: "left" | "right",
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion,
  ): boolean;
  canMountFrom(worldPosition: THREE.Vector3): boolean;
  setPossessed(active: boolean): void;
  /** Returns the chassis rigid body's linear velocity for controller animation/yaw use. */
  getChassisLinvel(out: { x: number; y: number; z: number }): void;
  /** No-op in the physics version — bike drives itself. */
  setMountedTransform(
    worldPosition: THREE.Vector3,
    worldQuaternion: THREE.Quaternion,
  ): void;
  setParkedTransform(
    worldPosition: THREE.Vector3,
    worldQuaternion: THREE.Quaternion,
  ): void;
  setDriverInput(input: MotorbikeDriverInput): void;
}
