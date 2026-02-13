"use client";

import { Cloud, Clouds } from "@react-three/drei";
import { MeshBasicMaterial } from "three";

export function SceneCloudLayer() {
  return (
    <Clouds material={MeshBasicMaterial} frustumCulled={false} renderOrder={0}>
      <Cloud
        position={[-34, 29, -30]}
        speed={0.14}
        opacity={0.52}
        bounds={[18, 4, 1]}
        segments={10}
      />
      <Cloud
        position={[-12, 26, 24]}
        speed={0.18}
        opacity={0.58}
        bounds={[14, 3, 1]}
        segments={9}
      />
      <Cloud
        position={[8, 33, -6]}
        speed={0.1}
        opacity={0.45}
        bounds={[20, 5, 1]}
        segments={12}
      />
      <Cloud
        position={[24, 30, 18]}
        speed={0.16}
        opacity={0.5}
        bounds={[16, 4, 1]}
        segments={10}
      />
      <Cloud
        position={[36, 35, -28]}
        speed={0.21}
        opacity={0.42}
        bounds={[15, 3, 1]}
        segments={8}
      />
      <Cloud
        position={[-28, 34, 16]}
        speed={0.2}
        opacity={0.48}
        bounds={[12, 3, 1]}
        segments={8}
      />
      <Cloud
        position={[2, 28, 36]}
        speed={0.12}
        opacity={0.47}
        bounds={[18, 4, 1]}
        segments={11}
      />
      <Cloud
        position={[30, 27, -2]}
        speed={0.17}
        opacity={0.55}
        bounds={[13, 3, 1]}
        segments={9}
      />
    </Clouds>
  );
}
