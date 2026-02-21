"use client";

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { stepBoidsCPU } from "../utils/boideStep";

type BirdState = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
};

type Props = {
  count?: number;
  bounds?: number;
};

const _obj = new THREE.Object3D();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _toCenter = new THREE.Vector3();

const FLOCK_MIN_SPEED = 1.2;
const FLOCK_MAX_SPEED = 3.8;

function hash01(seed: number) {
  const hashed = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function createBirdStates(count: number, bounds: number): BirdState[] {
  const birds: BirdState[] = [];
  for (let i = 0; i < count; i++) {
    const seed = i * 19.371;
    const pos = new THREE.Vector3(
      (hash01(seed + 0.11) - 0.5) * bounds,
      hash01(seed + 0.57) * bounds * 0.5 + 4,
      (hash01(seed + 1.03) - 0.5) * bounds,
    );
    const vel = new THREE.Vector3(
      (hash01(seed + 1.71) - 0.5) * 2,
      (hash01(seed + 2.29) - 0.5) * 0.5,
      (hash01(seed + 2.83) - 0.5) * 2,
    );
    if (vel.lengthSq() < 1e-6) vel.set(0, 1, 0);
    vel
      .normalize()
      .multiplyScalar(FLOCK_MIN_SPEED + hash01(seed + 3.47) * 1.8);
    birds.push({ pos, vel });
  }
  return birds;
}

export function BirdFlock({ count = 192, bounds = 48 }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const birdsRef = useRef<BirdState[]>(createBirdStates(count, bounds));

  useEffect(() => {
    birdsRef.current = createBirdStates(count, bounds);
  }, [count, bounds]);

  // Per-instance attributes for flap variation
  const { geometry, material } = useMemo(() => {
    const geometry = createBirdGeometry();

    const phase = new Float32Array(count);
    const flapSpeed = new Float32Array(count);
    const birdScale = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const seed = i * 7.913;
      phase[i] = hash01(seed + 0.13) * Math.PI * 2;
      flapSpeed[i] = 6 + hash01(seed + 0.71) * 6;
      birdScale[i] = 0.7 + hash01(seed + 1.19) * 0.8;
    }

    geometry.setAttribute(
      "aPhase",
      new THREE.InstancedBufferAttribute(phase, 1),
    );
    geometry.setAttribute(
      "aFlapSpeed",
      new THREE.InstancedBufferAttribute(flapSpeed, 1),
    );
    geometry.setAttribute(
      "aBirdScale",
      new THREE.InstancedBufferAttribute(birdScale, 1),
    );

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform float uTime;

        attribute float aPhase;
        attribute float aFlapSpeed;
        attribute float aBirdScale;

        varying float vWingMask;
        varying float vShade;

        void main() {
          vec3 p = position;

          // wing vertices have |x| > 0.001 in our custom geometry
          float wingMask = step(0.001, abs(p.x));
          vWingMask = wingMask;

          // flap angle based on time + per-instance phase
          float flap = sin(uTime * aFlapSpeed + aPhase);

          // Rotate wings around body along z-axis-ish by moving y
          // (cheap fake flap)
          p.y += wingMask * flap * 0.08 * sign(p.x);

          // Per-instance bird size (local)
          p *= aBirdScale;

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // simple shading hint for fragment
          vShade = 0.5 + 0.5 * flap;
        }
      `,
      fragmentShader: `
        varying float vWingMask;
        varying float vShade;

        void main() {
          vec3 body = vec3(0.07, 0.07, 0.08);
          vec3 wing = vec3(0.03, 0.03, 0.035);
          vec3 col = mix(body, wing, vWingMask);
          col *= mix(0.85, 1.05, vShade);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });

    return { geometry, material };
  }, [count]);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const birds = birdsRef.current;
    const shaderMaterial = mesh.material;
    const clampedDt = Math.min(dt, 1 / 20);
    const confinementRadius = bounds * 0.5;
    const confinementRadiusSq = confinementRadius * confinementRadius;
    const minAltitude = -bounds * 0.18;
    const maxAltitude = bounds * 0.2;

    // Update shader time
    if (shaderMaterial instanceof THREE.ShaderMaterial) {
      const uniform = shaderMaterial.uniforms.uTime;
      if (uniform) {
        (uniform as THREE.IUniform<number>).value += clampedDt;
      }
    }

    // Local boid rules in flock-local space.
    stepBoidsCPU(birds, clampedDt, {
      neighborRadius: 4.2,
      separationRadius: 1.35,
      separationWeight: 1.18,
      alignmentWeight: 0.54,
      cohesionWeight: 0.38,
      minSpeed: FLOCK_MIN_SPEED,
      maxSpeed: FLOCK_MAX_SPEED,
    });

    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];

      // Soft confinement in XZ so the flock stays cohesive without collapsing
      // into an origin ring.
      const horizontalDistSq = b.pos.x * b.pos.x + b.pos.z * b.pos.z;
      if (horizontalDistSq > confinementRadiusSq) {
        const horizontalDist = Math.sqrt(horizontalDistSq);
        const overflow = horizontalDist - confinementRadius;
        const invDist = 1 / Math.max(horizontalDist, 1e-6);
        _toCenter.set(-b.pos.x * invDist, 0, -b.pos.z * invDist);
        b.vel.addScaledVector(_toCenter, overflow * 1.6 * clampedDt);
        b.pos.addScaledVector(_toCenter, overflow * 0.12);
      }

      // Keep altitude in a broad band; local group transform decides world height.
      if (b.pos.y < minAltitude) b.vel.y += (minAltitude - b.pos.y) * 1.35 * clampedDt;
      else if (b.pos.y > maxAltitude) b.vel.y += (maxAltitude - b.pos.y) * 1.35 * clampedDt;

      const speed = b.vel.length();
      if (speed > FLOCK_MAX_SPEED) b.vel.setLength(FLOCK_MAX_SPEED);
      else if (speed < FLOCK_MIN_SPEED) b.vel.setLength(FLOCK_MIN_SPEED);

      // Orient instance to velocity
      _forward.copy(b.vel).normalize();
      _quat.setFromUnitVectors(_up, _forward); // bird "up axis" -> velocity
      _obj.position.copy(b.pos);
      _obj.quaternion.copy(_quat);

      // stretch slightly with speed for silhouette variation
      const s = THREE.MathUtils.mapLinear(
        speed,
        FLOCK_MIN_SPEED,
        FLOCK_MAX_SPEED,
        0.9,
        1.12,
      );
      _obj.scale.setScalar(s);

      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      frustumCulled={false}
    />
  );
}

/**
 * Tiny bird mesh: 2 triangles wings + 1 small body triangle
 * Local forward is +Y (so we can orient from UP->velocity above).
 */
function createBirdGeometry(): THREE.InstancedBufferGeometry {
  const base = new THREE.BufferGeometry();

  // 3 triangles (9 vertices):
  // body triangle near center + left wing tri + right wing tri
  const vertices = new Float32Array([
    // body
    0.0, 0.08, 0.0, -0.015, 0.0, 0.0, 0.015, 0.0, 0.0,

    // left wing
    -0.01, 0.02, 0.0, -0.2, -0.04, 0.0, -0.03, -0.01, 0.0,

    // right wing
    0.01, 0.02, 0.0, 0.2, -0.04, 0.0, 0.03, -0.01, 0.0,
  ]);

  base.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  base.computeVertexNormals();

  // Convert to InstancedBufferGeometry so we can attach instanced attrs
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  if (base.attributes.normal) geo.attributes.normal = base.attributes.normal;
  return geo;
}
