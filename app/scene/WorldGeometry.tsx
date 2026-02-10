import { CuboidCollider, MeshCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  GRASS_FIELD_COLOR,
  GRASS_PATCH_COLOR,
  GROUND_HALF_EXTENT,
  GROUND_MESH_SEGMENTS,
  ROCK_FORMATIONS,
  ROCK_MATERIAL_COLOR,
} from "../utils/constants";
import { createProceduralRockGeometry } from "../utils/rockGeometry";
import { createRockMaterial } from "../utils/shaders";

const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;

export function WorldGeometry() {
  const rockNoiseTexture = useMemo(() => {
    const texture = new THREE.TextureLoader().load(SIMPLEX_NOISE_TEXTURE_PATH);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = SIMPLEX_NOISE_TEXTURE_ANISOTROPY;
    texture.needsUpdate = true;
    return texture;
  }, []);

  const { material: rockMaterial } = useMemo(
    () => createRockMaterial(ROCK_MATERIAL_COLOR, rockNoiseTexture),
    [rockNoiseTexture],
  );
  const rockGeometries = useMemo(
    () => ROCK_FORMATIONS.map((_, index) => createProceduralRockGeometry(index)),
    [],
  );
  useEffect(() => {
    return () => {
      rockMaterial.dispose();
      rockNoiseTexture.dispose();
      rockGeometries.forEach((geometry) => geometry.dispose());
    };
  }, [rockGeometries, rockMaterial, rockNoiseTexture]);

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <MeshCollider type="trimesh">
          <mesh position={[0, 0, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
            <planeGeometry
              args={[
                GROUND_HALF_EXTENT * 2,
                GROUND_HALF_EXTENT * 2,
                GROUND_MESH_SEGMENTS,
                GROUND_MESH_SEGMENTS,
              ]}
            />
            <meshStandardMaterial
              color={GRASS_FIELD_COLOR}
              roughness={0.94}
              metalness={0.02}
            />
          </mesh>
        </MeshCollider>
      </RigidBody>

      <mesh
        position={[0, 0.01, 0]}
        rotation={[-Math.PI * 0.5, 0, 0]}
        receiveShadow
      >
        <circleGeometry args={[GROUND_HALF_EXTENT * 1.75, 96]} />
        <meshStandardMaterial color={GRASS_PATCH_COLOR} roughness={1} metalness={0} />
      </mesh>

      {ROCK_FORMATIONS.map((rock, index) => (
        <RigidBody
          key={`rock-${index}`}
          type="fixed"
          colliders={false}
          position={rock.position}
        >
          <CuboidCollider args={[rock.collider[0], rock.collider[1], rock.collider[2]]} />
          <mesh
            castShadow
            receiveShadow
            scale={rock.scale}
            material={rockMaterial}
            geometry={rockGeometries[index]}
          />
        </RigidBody>
      ))}
    </>
  );
}
