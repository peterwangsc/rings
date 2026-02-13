"use client";

import { useFrame } from "@react-three/fiber";
import type { ReactThreeFiber } from "@react-three/fiber";
import { forwardRef, useMemo, useState } from "react";
import { Vector3 } from "three";
import { ThreeSkyObject } from "./ThreeSkyObject";

export type InfiniteSkyFollowMode = "camera" | "none";

type PrimitiveSkyProps = Omit<
  ReactThreeFiber.ThreeElements["primitive"],
  "object" | "scale"
>;

export type InfiniteSkyProps = PrimitiveSkyProps & {
  distance?: number;
  sunPosition?: ReactThreeFiber.Vector3;
  inclination?: number;
  azimuth?: number;
  mieCoefficient?: number;
  mieDirectionalG?: number;
  sunsetFalloffPower?: number;
  rayleigh?: number;
  turbidity?: number;
  cameraOffsetY?: number;
  follow?: InfiniteSkyFollowMode;
};

export function calcPosFromAngles(
  inclination: number,
  azimuth: number,
  vector = new Vector3(),
): Vector3 {
  const theta = Math.PI * (inclination - 0.5);
  const phi = 2 * Math.PI * (azimuth - 0.5);

  vector.x = Math.cos(phi);
  vector.y = Math.sin(theta);
  vector.z = Math.sin(phi);

  return vector;
}

export const InfiniteSky = forwardRef<ThreeSkyObject, InfiniteSkyProps>(
  function InfiniteSky(
    {
      inclination = 0.6,
      azimuth = 0.1,
      distance = 1000,
      mieCoefficient = 0.005,
      mieDirectionalG = 0.8,
      sunsetFalloffPower = 3.4,
      rayleigh = 0.5,
      turbidity = 10,
      cameraOffsetY = 0,
      sunPosition = calcPosFromAngles(inclination, azimuth),
      follow = "camera",
      ...props
    },
    ref,
  ) {
    const scale = useMemo(() => new Vector3().setScalar(distance), [distance]);
    const [sky] = useState(() => new ThreeSkyObject());

    useFrame((state) => {
      if (follow !== "camera") {
        return;
      }

      sky.position.copy(state.camera.position);
    });

    return (
      <primitive
        object={sky}
        ref={ref}
        material-uniforms-mieCoefficient-value={mieCoefficient}
        material-uniforms-mieDirectionalG-value={mieDirectionalG}
        material-uniforms-sunsetFalloffPower-value={sunsetFalloffPower}
        material-uniforms-rayleigh-value={rayleigh}
        material-uniforms-sunPosition-value={sunPosition}
        material-uniforms-turbidity-value={turbidity}
        material-uniforms-cameraOffsetY-value={cameraOffsetY}
        scale={scale}
        renderOrder={-10}
        frustumCulled={false}
        material-depthWrite={false}
        material-depthTest={false}
        {...props}
      />
    );
  },
);

InfiniteSky.displayName = "InfiniteSky";
