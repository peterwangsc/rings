import { useFrame } from "@react-three/fiber";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  PointLight,
  ShaderMaterial,
} from "three";

const TAU = Math.PI * 2;
const CAMPFIRE_RING_RADIUS = 0.42;
const CAMPFIRE_STONE_COUNT = 10;
const CAMPFIRE_COLLIDER_RADIUS = 0.55;
const FIRE_PARTICLE_COUNT = 72;
const SMOKE_PARTICLE_COUNT = 46;

type ParticleState = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  baseSize: number;
  cycle: number;
};

type ParticleSystem = {
  geometry: BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  positionAttribute: BufferAttribute;
  colorAttribute: BufferAttribute;
  sizeAttribute: BufferAttribute;
  alphaAttribute: BufferAttribute;
};

function hash1D(value: number) {
  const hashed = Math.sin(value * 12.9898) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function writeParticle(
  system: ParticleSystem,
  index: number,
  particle: ParticleState,
  color: Color,
  alpha: number,
  size: number,
) {
  const posIndex = index * 3;
  system.positions[posIndex] = particle.x;
  system.positions[posIndex + 1] = particle.y;
  system.positions[posIndex + 2] = particle.z;
  system.colors[posIndex] = color.r;
  system.colors[posIndex + 1] = color.g;
  system.colors[posIndex + 2] = color.b;
  system.alphas[index] = alpha;
  system.sizes[index] = size;
}

function resetFireParticle(particle: ParticleState, index: number) {
  const seedBase = index * 15.37 + particle.cycle * 47.29;
  const angle = hash1D(seedBase + 1.4) * TAU;
  const radius = hash1D(seedBase + 3.7) * 0.14;

  particle.x = Math.cos(angle) * radius;
  particle.z = Math.sin(angle) * radius;
  particle.y = 0.05 + hash1D(seedBase + 6.2) * 0.08;
  particle.vx = (hash1D(seedBase + 7.1) - 0.5) * 0.12;
  particle.vz = (hash1D(seedBase + 8.3) - 0.5) * 0.12;
  particle.vy = 0.88 + hash1D(seedBase + 10.4) * 1.05;
  particle.maxLife = 0.45 + hash1D(seedBase + 13.5) * 0.6;
  particle.life = particle.maxLife;
  particle.baseSize = 14 + hash1D(seedBase + 16.6) * 12;
  particle.cycle += 1;
}

function resetSmokeParticle(particle: ParticleState, index: number) {
  const seedBase = index * 11.11 + particle.cycle * 39.17;
  const angle = hash1D(seedBase + 0.9) * TAU;
  const radius = hash1D(seedBase + 2.4) * 0.12;

  particle.x = Math.cos(angle) * radius;
  particle.z = Math.sin(angle) * radius;
  particle.y = 0.22 + hash1D(seedBase + 4.7) * 0.06;
  particle.vx = (hash1D(seedBase + 6.8) - 0.5) * 0.08;
  particle.vz = (hash1D(seedBase + 9.1) - 0.5) * 0.08;
  particle.vy = 0.24 + hash1D(seedBase + 12.2) * 0.36;
  particle.maxLife = 1.9 + hash1D(seedBase + 13.8) * 1.8;
  particle.life = particle.maxLife;
  particle.baseSize = 16 + hash1D(seedBase + 17.3) * 14;
  particle.cycle += 1;
}

function createParticleSystem(count: number): ParticleSystem {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);

  const positionAttribute = new BufferAttribute(positions, 3);
  const colorAttribute = new BufferAttribute(colors, 3);
  const sizeAttribute = new BufferAttribute(sizes, 1);
  const alphaAttribute = new BufferAttribute(alphas, 1);
  positionAttribute.setUsage(DynamicDrawUsage);
  colorAttribute.setUsage(DynamicDrawUsage);
  sizeAttribute.setUsage(DynamicDrawUsage);
  alphaAttribute.setUsage(DynamicDrawUsage);

  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", colorAttribute);
  geometry.setAttribute("aSize", sizeAttribute);
  geometry.setAttribute("aAlpha", alphaAttribute);

  return {
    geometry,
    positions,
    colors,
    sizes,
    alphas,
    positionAttribute,
    colorAttribute,
    sizeAttribute,
    alphaAttribute,
  };
}

function createParticleStates(
  count: number,
  resetParticle: (particle: ParticleState, index: number) => void,
) {
  const particles: ParticleState[] = [];
  for (let index = 0; index < count; index++) {
    const particle: ParticleState = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 1,
      maxLife: 1,
      baseSize: 1,
      cycle: 0,
    };
    resetParticle(particle, index);
    particles.push(particle);
  }
  return particles;
}

function createParticleMaterial(blending: number) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending,
    vertexColors: true,
    uniforms: {},
    vertexShader: `
attribute float aSize;
attribute float aAlpha;
varying vec3 vParticleColor;
varying float vParticleAlpha;

void main() {
  vParticleColor = color;
  vParticleAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distanceScale = clamp(220.0 / max(1.0, -mvPosition.z), 0.0, 4.0);
  gl_PointSize = aSize * distanceScale;
  gl_Position = projectionMatrix * mvPosition;
}
`,
    fragmentShader: `
varying vec3 vParticleColor;
varying float vParticleAlpha;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float dist = length(centered);
  float softMask = smoothstep(0.52, 0.0, dist);
  float core = smoothstep(0.28, 0.0, dist);
  vec3 color = vParticleColor + core * 0.12;
  gl_FragColor = vec4(color, vParticleAlpha * softMask);
}
`,
  });
}

export function Campfire({ position }: { position: readonly [number, number, number] }) {
  const flameRef = useRef<Mesh>(null);
  const emberRef = useRef<Mesh>(null);
  const fireLightRef = useRef<PointLight>(null);
  const fireParticlesRef = useRef<ParticleState[]>(
    createParticleStates(FIRE_PARTICLE_COUNT, resetFireParticle),
  );
  const smokeParticlesRef = useRef<ParticleState[]>(
    createParticleStates(SMOKE_PARTICLE_COUNT, resetSmokeParticle),
  );

  const fireSystem = useMemo(
    () => createParticleSystem(FIRE_PARTICLE_COUNT),
    [],
  );
  const smokeSystem = useMemo(
    () => createParticleSystem(SMOKE_PARTICLE_COUNT),
    [],
  );
  const firePositionAttributeRef = useRef(fireSystem.positionAttribute);
  const fireColorAttributeRef = useRef(fireSystem.colorAttribute);
  const fireSizeAttributeRef = useRef(fireSystem.sizeAttribute);
  const fireAlphaAttributeRef = useRef(fireSystem.alphaAttribute);
  const smokePositionAttributeRef = useRef(smokeSystem.positionAttribute);
  const smokeColorAttributeRef = useRef(smokeSystem.colorAttribute);
  const smokeSizeAttributeRef = useRef(smokeSystem.sizeAttribute);
  const smokeAlphaAttributeRef = useRef(smokeSystem.alphaAttribute);

  const fireMaterial = useMemo(
    () => createParticleMaterial(AdditiveBlending),
    [],
  );
  const smokeMaterial = useMemo(
    () => createParticleMaterial(NormalBlending),
    [],
  );

  const fireColor = useMemo(() => new Color(), []);
  const smokeColor = useMemo(() => new Color(), []);
  const stones = useMemo(
    () =>
      Array.from({ length: CAMPFIRE_STONE_COUNT }, (_, index) => {
        const base = index * 4.31;
        const angle = (index / CAMPFIRE_STONE_COUNT) * TAU + (hash1D(base + 1.4) - 0.5) * 0.24;
        const radius = CAMPFIRE_RING_RADIUS + (hash1D(base + 2.7) - 0.5) * 0.08;
        const scale = 0.09 + hash1D(base + 5.8) * 0.08;
        return {
          position: [
            Math.cos(angle) * radius,
            0.04 + hash1D(base + 7.2) * 0.03,
            Math.sin(angle) * radius,
          ] as const,
          rotationY: hash1D(base + 9.3) * TAU,
          scale: [scale * 1.2, scale, scale * 1.1] as const,
        };
      }),
    [],
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.033);
    const elapsedTime = state.clock.getElapsedTime();

    if (flameRef.current) {
      const pulse = 1 + Math.sin(elapsedTime * 12.4) * 0.08 + Math.sin(elapsedTime * 17.1 + 0.8) * 0.06;
      flameRef.current.scale.set(1, pulse, 1);
    }
    if (emberRef.current) {
      const glow = 0.8 + Math.sin(elapsedTime * 6.8) * 0.16;
      const emberMaterial = emberRef.current.material;
      if (!Array.isArray(emberMaterial)) {
        (emberMaterial as MeshStandardMaterial).emissiveIntensity = glow;
      }
    }
    if (fireLightRef.current) {
      fireLightRef.current.intensity =
        1.5 + Math.sin(elapsedTime * 13.1) * 0.18 + Math.sin(elapsedTime * 19.3 + 0.3) * 0.14;
    }

    for (let index = 0; index < FIRE_PARTICLE_COUNT; index++) {
      const particle = fireParticlesRef.current[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        resetFireParticle(particle, index);
      }

      const lifeT = 1 - particle.life / particle.maxLife;
      particle.x += particle.vx * dt + Math.sin(elapsedTime * 4 + index * 0.4) * 0.02 * dt;
      particle.z += particle.vz * dt + Math.cos(elapsedTime * 4.6 + index * 0.51) * 0.02 * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 2.4);
      particle.vz *= Math.max(0, 1 - dt * 2.4);
      particle.vy += dt * 0.55;

      fireColor.setRGB(
        1,
        MathUtils.lerp(0.24, 0.9, 1 - lifeT),
        MathUtils.lerp(0.05, 0.3, Math.pow(1 - lifeT, 2)),
      );
      const alpha = Math.max(0, (1 - lifeT) * (1 - lifeT) * 0.95);
      const size = particle.baseSize * MathUtils.lerp(0.78, 1.22, lifeT);
      writeParticle(fireSystem, index, particle, fireColor, alpha, size);
    }

    for (let index = 0; index < SMOKE_PARTICLE_COUNT; index++) {
      const particle = smokeParticlesRef.current[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        resetSmokeParticle(particle, index);
      }

      const lifeT = 1 - particle.life / particle.maxLife;
      particle.x += particle.vx * dt + Math.sin(elapsedTime * 1.7 + index * 0.23) * 0.06 * dt;
      particle.z += particle.vz * dt + Math.cos(elapsedTime * 1.4 + index * 0.19) * 0.06 * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 0.8);
      particle.vz *= Math.max(0, 1 - dt * 0.8);
      particle.vy += dt * 0.09;

      const brightness = MathUtils.lerp(0.14, 0.44, lifeT);
      smokeColor.setRGB(brightness, brightness, brightness);
      const alpha = Math.max(0, (1 - lifeT) * 0.42);
      const size = particle.baseSize * MathUtils.lerp(0.82, 2.15, lifeT);
      writeParticle(smokeSystem, index, particle, smokeColor, alpha, size);
    }

    firePositionAttributeRef.current.needsUpdate = true;
    fireColorAttributeRef.current.needsUpdate = true;
    fireSizeAttributeRef.current.needsUpdate = true;
    fireAlphaAttributeRef.current.needsUpdate = true;
    smokePositionAttributeRef.current.needsUpdate = true;
    smokeColorAttributeRef.current.needsUpdate = true;
    smokeSizeAttributeRef.current.needsUpdate = true;
    smokeAlphaAttributeRef.current.needsUpdate = true;
  });

  useEffect(() => {
    return () => {
      fireSystem.geometry.dispose();
      smokeSystem.geometry.dispose();
      fireMaterial.dispose();
      smokeMaterial.dispose();
    };
  }, [fireMaterial, fireSystem.geometry, smokeMaterial, smokeSystem.geometry]);

  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      <CylinderCollider args={[0.18, CAMPFIRE_COLLIDER_RADIUS]} position={[0, 0.18, 0]} />

      {stones.map((stone, index) => (
        <mesh
          key={`campfire-stone-${index}`}
          castShadow
          receiveShadow
          position={stone.position}
          rotation={[0, stone.rotationY, 0]}
          scale={stone.scale}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#6F6B64" roughness={0.95} metalness={0.04} />
        </mesh>
      ))}

      <mesh castShadow position={[0.14, 0.12, 0]} rotation={[0.2, 0.95, 1.12]}>
        <cylinderGeometry args={[0.08, 0.11, 0.9, 12]} />
        <meshStandardMaterial color="#5A3E2A" roughness={0.93} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[-0.15, 0.12, 0.04]} rotation={[-0.2, -0.86, 1.06]}>
        <cylinderGeometry args={[0.08, 0.11, 0.9, 12]} />
        <meshStandardMaterial color="#64462F" roughness={0.93} metalness={0.02} />
      </mesh>

      <mesh ref={emberRef} position={[0, 0.02, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
        <circleGeometry args={[0.2, 16]} />
        <meshStandardMaterial
          color="#1E140C"
          emissive="#FF5A22"
          emissiveIntensity={0.8}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      <mesh ref={flameRef} position={[0, 0.23, 0]}>
        <coneGeometry args={[0.13, 0.35, 10, 1]} />
        <meshStandardMaterial
          color="#FFBF66"
          emissive="#FF7B31"
          emissiveIntensity={1.4}
          transparent
          opacity={0.88}
          roughness={0.22}
          metalness={0}
        />
      </mesh>
      <pointLight
        ref={fireLightRef}
        color="#FF9C4A"
        intensity={1.5}
        distance={5.5}
        decay={1.7}
        position={[0, 0.5, 0]}
      />

      <points geometry={smokeSystem.geometry} material={smokeMaterial} frustumCulled={false} />
      <points geometry={fireSystem.geometry} material={fireMaterial} frustumCulled={false} />
    </RigidBody>
  );
}
