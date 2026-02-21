import { useFrame } from "@react-three/fiber";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
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
const SHELL_PARTICLE_COUNT = 32;
const SMOKE_PARTICLE_COUNT = 40;
const SPARK_PARTICLE_COUNT = 18;

// Flame mesh geometry: tip height above base
const FLAME_HEIGHT = 0.38;
const FLAME_BASE_RADIUS = 0.14;
// Smoke spawns above flame tip
const SMOKE_SPAWN_Y = 0.52;

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

// Combustion shell: spawns on outer rim, drifts inward+upward
function resetShellParticle(particle: ParticleState, index: number) {
  const seedBase = index * 17.43 + particle.cycle * 53.11;
  const angle = hash1D(seedBase + 0.3) * TAU;
  const radius = 0.08 + hash1D(seedBase + 1.7) * 0.05;

  particle.x = Math.cos(angle) * radius;
  particle.z = Math.sin(angle) * radius;
  particle.y = 0.06 + hash1D(seedBase + 3.1) * 0.1;

  // Converge inward toward axis as they rise
  const inwardSpeed = 0.7 + hash1D(seedBase + 4.9) * 0.5;
  particle.vx = -particle.x * inwardSpeed;
  particle.vz = -particle.z * inwardSpeed;
  particle.vy = 0.55 + hash1D(seedBase + 6.8) * 0.85;

  particle.maxLife = 0.5 + hash1D(seedBase + 8.2) * 0.55;
  particle.life = particle.maxLife;
  particle.baseSize = 12 + hash1D(seedBase + 10.4) * 14;
  particle.cycle += 1;
}

// Smoke: spawns above flame tip, dark charcoal, expands and fades
function resetSmokeParticle(particle: ParticleState, index: number) {
  const seedBase = index * 11.11 + particle.cycle * 39.17;
  const angle = hash1D(seedBase + 0.9) * TAU;
  const radius = hash1D(seedBase + 2.4) * 0.06;

  particle.x = Math.cos(angle) * radius;
  particle.z = Math.sin(angle) * radius;
  particle.y = SMOKE_SPAWN_Y + hash1D(seedBase + 4.7) * 0.08;
  particle.vx = (hash1D(seedBase + 6.8) - 0.5) * 0.07;
  particle.vz = (hash1D(seedBase + 9.1) - 0.5) * 0.07;
  particle.vy = 0.22 + hash1D(seedBase + 12.2) * 0.32;
  particle.maxLife = 2.2 + hash1D(seedBase + 13.8) * 2.0;
  particle.life = particle.maxLife;
  particle.baseSize = 14 + hash1D(seedBase + 17.3) * 12;
  particle.cycle += 1;
}

// Sparks: shoot up with lateral spread, arc under gravity
function resetSparkParticle(particle: ParticleState, index: number) {
  const seedBase = index * 23.71 + particle.cycle * 61.43;
  const angle = hash1D(seedBase + 0.3) * TAU;
  const radius = hash1D(seedBase + 1.9) * 0.1;

  particle.x = Math.cos(angle) * radius;
  particle.z = Math.sin(angle) * radius;
  particle.y = 0.1 + hash1D(seedBase + 3.1) * 0.12;

  const lateralSpeed = 0.18 + hash1D(seedBase + 5.4) * 0.32;
  const sparkAngle = hash1D(seedBase + 7.2) * TAU;
  particle.vx = Math.cos(sparkAngle) * lateralSpeed;
  particle.vz = Math.sin(sparkAngle) * lateralSpeed;
  particle.vy = 1.1 + hash1D(seedBase + 9.8) * 1.4;
  particle.maxLife = 0.18 + hash1D(seedBase + 11.6) * 0.28;
  particle.life = particle.maxLife;
  particle.baseSize = 3 + hash1D(seedBase + 14.2) * 3;
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
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 1, maxLife: 1,
      baseSize: 1, cycle: 0,
    };
    resetParticle(particle, index);
    // Stagger initial lifetimes so they don't all pop at once
    particle.life = particle.maxLife * hash1D(index * 7.31 + 0.5);
    particles.push(particle);
  }
  return particles;
}

function createPointSpriteMaterial(blending: number) {
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
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = color;
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distScale = clamp(200.0 / max(1.0, -mvPosition.z), 0.0, 4.0);
  gl_PointSize = aSize * distScale;
  gl_Position = projectionMatrix * mvPosition;
}
`,
    fragmentShader: `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float dist = length(c);
  float mask = smoothstep(0.5, 0.0, dist);
  float core = smoothstep(0.25, 0.0, dist);
  gl_FragColor = vec4(vColor + core * 0.15, vAlpha * mask);
}
`,
  });
}

// Simplex noise (from FireballRenderLayer pattern) + fBM for vertex displacement
const SNOISE_GLSL = /* glsl */`
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289v3(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

function createFlameMeshMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: 2, // DoubleSide
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
${SNOISE_GLSL}

uniform float uTime;
varying float vHeightT;
varying float vNoiseMask;

void main() {
  // heightT: 0 at base, 1 at tip
  float heightT = clamp(position.y / ${FLAME_HEIGHT.toFixed(3)}, 0.0, 1.0);
  vHeightT = heightT;

  // Two noise octaves at different frequencies for organic turbulence
  float n1 = snoise(vec3(position.x * 8.0, position.y * 5.0 + uTime * 1.6, position.z * 8.0));
  float n2 = snoise(vec3(position.x * 14.0 + 3.7, position.y * 9.0 - uTime * 2.3, position.z * 14.0));
  float n = n1 * 0.65 + n2 * 0.35;
  vNoiseMask = n * 0.5 + 0.5;

  // Displacement grows stronger toward tip, pinches tip inward
  float dispStrength = heightT * heightT * 0.07;
  vec3 displaced = position + normal * n * dispStrength;

  // Pinch the tip: compress radius toward tip
  float radialScale = 1.0 - heightT * heightT * 0.35;
  displaced.x *= radialScale;
  displaced.z *= radialScale;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`,
    fragmentShader: /* glsl */`
varying float vHeightT;
varying float vNoiseMask;

void main() {
  // Bright throughout — flames are luminous at all heights when seen from a distance.
  // Soot darkening is a close-up detail the mesh can't convey at small screen size.
  vec3 baseColor = vec3(1.0,  0.72, 0.05); // hot yellow-orange at base
  vec3 midColor  = vec3(1.0,  0.38, 0.02); // orange mid
  vec3 tipColor  = vec3(0.95, 0.18, 0.01); // still bright red-orange at tip

  vec3 color;
  if (vHeightT < 0.55) {
    color = mix(baseColor, midColor, vHeightT / 0.55);
  } else {
    color = mix(midColor, tipColor, (vHeightT - 0.55) / 0.45);
  }

  // Noise adds subtle internal variation without darkening much
  color *= mix(0.92, 1.0, vNoiseMask);

  // Alpha: strong at base, holds well toward tip, only soft-clips at very tip via noise
  float alpha = mix(0.88, 0.55, vHeightT * vHeightT);
  alpha *= mix(0.75, 1.0, vNoiseMask);

  gl_FragColor = vec4(color, alpha);
}
`,
  });
}

export function Campfire({ position }: { position: readonly [number, number, number] }) {
  const flameMeshRef = useRef<Mesh>(null);
  const emberRef = useRef<Mesh>(null);
  const fireLightRef = useRef<PointLight>(null);

  const shellParticlesRef = useRef<ParticleState[]>(
    createParticleStates(SHELL_PARTICLE_COUNT, resetShellParticle),
  );
  const smokeParticlesRef = useRef<ParticleState[]>(
    createParticleStates(SMOKE_PARTICLE_COUNT, resetSmokeParticle),
  );
  const sparkParticlesRef = useRef<ParticleState[]>(
    createParticleStates(SPARK_PARTICLE_COUNT, resetSparkParticle),
  );

  const shellSystem = useMemo(() => createParticleSystem(SHELL_PARTICLE_COUNT), []);
  const smokeSystem = useMemo(() => createParticleSystem(SMOKE_PARTICLE_COUNT), []);
  const sparkSystem = useMemo(() => createParticleSystem(SPARK_PARTICLE_COUNT), []);

  const flameMaterial = useMemo(() => createFlameMeshMaterial(), []);
  const glowMaterial = useMemo(() => new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: 2,
    uniforms: {},
    vertexShader: `
varying float vHeightT;
void main() {
  vHeightT = clamp(position.y / ${(FLAME_HEIGHT * 1.3).toFixed(3)}, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: `
varying float vHeightT;
void main() {
  // Soft orange glow, bright at base, fades at tip — purely additive bloom
  vec3 color = mix(vec3(1.0, 0.45, 0.02), vec3(0.8, 0.18, 0.0), vHeightT);
  float alpha = (1.0 - vHeightT) * (1.0 - vHeightT) * 0.28;
  gl_FragColor = vec4(color, alpha);
}
`,
  }), []);
  const shellMaterial = useMemo(() => createPointSpriteMaterial(AdditiveBlending), []);
  const smokeMaterial = useMemo(() => {
    const mat = createPointSpriteMaterial(NormalBlending);
    mat.depthTest = true;
    return mat;
  }, []);
  const sparkMaterial = useMemo(() => createPointSpriteMaterial(AdditiveBlending), []);

  // Refs to mutable sub-objects so useFrame can update them without lint issues
  const uTimeRef = useRef(flameMaterial.uniforms.uTime);
  const shellPosRef = useRef(shellSystem.positionAttribute);
  const shellColRef = useRef(shellSystem.colorAttribute);
  const shellSzRef = useRef(shellSystem.sizeAttribute);
  const shellAlRef = useRef(shellSystem.alphaAttribute);
  const smokePosRef = useRef(smokeSystem.positionAttribute);
  const smokeColRef = useRef(smokeSystem.colorAttribute);
  const smokeSzRef = useRef(smokeSystem.sizeAttribute);
  const smokeAlRef = useRef(smokeSystem.alphaAttribute);
  const sparkPosRef = useRef(sparkSystem.positionAttribute);
  const sparkColRef = useRef(sparkSystem.colorAttribute);
  const sparkSzRef = useRef(sparkSystem.sizeAttribute);
  const sparkAlRef = useRef(sparkSystem.alphaAttribute);

  const flameGeometry = useMemo(() => {
    const geo = new ConeGeometry(FLAME_BASE_RADIUS, FLAME_HEIGHT, 12, 6);
    geo.translate(0, FLAME_HEIGHT / 2, 0);
    return geo;
  }, []);

  // Wider, taller softcore glow cone — gives the fire a readable halo at distance
  const glowGeometry = useMemo(() => {
    const geo = new ConeGeometry(FLAME_BASE_RADIUS * 2.2, FLAME_HEIGHT * 1.3, 10, 4);
    geo.translate(0, (FLAME_HEIGHT * 1.3) / 2, 0);
    return geo;
  }, []);

  const shellColor = useMemo(() => new Color(), []);
  const smokeColor = useMemo(() => new Color(), []);
  const sparkColor = useMemo(() => new Color(), []);

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
    const t = state.clock.getElapsedTime();

    // Animate flame mesh shader time uniform
    uTimeRef.current.value = t;

    // Subtle scale pulse on mesh (secondary motion on top of vertex noise)
    if (flameMeshRef.current) {
      const pulse = 1 + Math.sin(t * 11.3) * 0.04 + Math.sin(t * 17.7 + 0.6) * 0.03;
      flameMeshRef.current.scale.setScalar(pulse);
    }

    if (emberRef.current) {
      const glow = 0.75 + Math.sin(t * 6.8) * 0.18 + Math.sin(t * 11.2 + 1.1) * 0.07;
      const mat = emberRef.current.material;
      if (!Array.isArray(mat)) {
        (mat as MeshStandardMaterial).emissiveIntensity = glow;
      }
    }

    if (fireLightRef.current) {
      const intensity = 1.5 + Math.sin(t * 13.1) * 0.18 + Math.sin(t * 19.3 + 0.3) * 0.14;
      fireLightRef.current.intensity = intensity;
      // Hotter = more yellow, cooler = more orange-red
      const colorT = MathUtils.clamp((intensity - 1.1) / 0.7, 0, 1);
      fireLightRef.current.color.setRGB(
        1.0,
        MathUtils.lerp(0.42, 0.68, colorT),
        MathUtils.lerp(0.0, 0.14, colorT),
      );
    }

    // --- Combustion shell particles ---
    for (let i = 0; i < SHELL_PARTICLE_COUNT; i++) {
      const p = shellParticlesRef.current[i];
      p.life -= dt;
      if (p.life <= 0) resetShellParticle(p, i);

      const lifeT = 1 - p.life / p.maxLife;

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      // Inward pull weakens as particle approaches axis
      p.vx *= Math.max(0, 1 - dt * 1.8);
      p.vz *= Math.max(0, 1 - dt * 1.8);
      // Accelerate upward (buoyancy)
      p.vy += dt * 0.6;

      // Color: yellow-orange base -> deep orange -> dark red-brown soot at tip
      if (lifeT < 0.45) {
        const t0 = lifeT / 0.45;
        shellColor.setRGB(1.0, MathUtils.lerp(0.62, 0.30, t0), MathUtils.lerp(0.04, 0.02, t0));
      } else {
        const t1 = (lifeT - 0.45) / 0.55;
        shellColor.setRGB(
          MathUtils.lerp(0.92, 0.22, t1 * t1),
          MathUtils.lerp(0.30, 0.06, t1),
          MathUtils.lerp(0.02, 0.01, t1),
        );
      }

      // Alpha: stays fairly opaque until final 20% of life, then fades
      const alpha = lifeT < 0.8
        ? 0.78
        : MathUtils.lerp(0.78, 0, (lifeT - 0.8) / 0.2);
      const size = p.baseSize * MathUtils.lerp(1.0, 0.4, lifeT);
      writeParticle(shellSystem, i, p, shellColor, Math.max(0, alpha), size);
    }

    // --- Smoke particles ---
    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
      const p = smokeParticlesRef.current[i];
      p.life -= dt;
      if (p.life <= 0) resetSmokeParticle(p, i);

      const lifeT = 1 - p.life / p.maxLife;
      p.x += p.vx * dt + Math.sin(t * 1.7 + i * 0.23) * 0.05 * dt;
      p.z += p.vz * dt + Math.cos(t * 1.4 + i * 0.19) * 0.05 * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - dt * 0.7);
      p.vz *= Math.max(0, 1 - dt * 0.7);
      p.vy += dt * 0.06;

      // Dark charcoal near flame, lightens slightly as it disperses
      const brightness = MathUtils.lerp(0.07, 0.32, lifeT);
      smokeColor.setRGB(brightness, brightness * 0.96, brightness * 0.93);

      // Fade in fast (0→0.15 of life), hold, then fade out slowly
      const alpha = lifeT < 0.15
        ? MathUtils.lerp(0, 0.34, lifeT / 0.15)
        : MathUtils.lerp(0.34, 0, (lifeT - 0.15) / 0.85);
      const size = p.baseSize * MathUtils.lerp(0.7, 2.4, lifeT);
      writeParticle(smokeSystem, i, p, smokeColor, Math.max(0, alpha), size);
    }

    // --- Spark particles ---
    for (let i = 0; i < SPARK_PARTICLE_COUNT; i++) {
      const p = sparkParticlesRef.current[i];
      p.life -= dt;
      if (p.life <= 0) resetSparkParticle(p, i);

      const lifeT = 1 - p.life / p.maxLife;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      p.vy -= dt * 2.8;
      p.vx *= Math.max(0, 1 - dt * 1.2);
      p.vz *= Math.max(0, 1 - dt * 1.2);

      sparkColor.setRGB(
        1.0,
        MathUtils.lerp(0.95, 0.18, lifeT * lifeT),
        MathUtils.lerp(0.7, 0.0, lifeT),
      );
      const alpha = Math.max(0, (1 - lifeT) * (1 - lifeT) * 1.1);
      const size = p.baseSize * MathUtils.lerp(1.0, 0.2, lifeT);
      writeParticle(sparkSystem, i, p, sparkColor, alpha, size);
    }

    shellPosRef.current.needsUpdate = true;
    shellColRef.current.needsUpdate = true;
    shellSzRef.current.needsUpdate = true;
    shellAlRef.current.needsUpdate = true;
    smokePosRef.current.needsUpdate = true;
    smokeColRef.current.needsUpdate = true;
    smokeSzRef.current.needsUpdate = true;
    smokeAlRef.current.needsUpdate = true;
    sparkPosRef.current.needsUpdate = true;
    sparkColRef.current.needsUpdate = true;
    sparkSzRef.current.needsUpdate = true;
    sparkAlRef.current.needsUpdate = true;
  });

  useEffect(() => {
    return () => {
      shellSystem.geometry.dispose();
      smokeSystem.geometry.dispose();
      sparkSystem.geometry.dispose();
      flameMaterial.dispose();
      glowMaterial.dispose();
      shellMaterial.dispose();
      smokeMaterial.dispose();
      sparkMaterial.dispose();
      flameGeometry.dispose();
      glowGeometry.dispose();
    };
  }, [shellSystem, smokeSystem, sparkSystem, flameMaterial, glowMaterial, shellMaterial, smokeMaterial, sparkMaterial, flameGeometry, glowGeometry]);

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

      {/* Logs */}
      <mesh castShadow position={[0.14, 0.12, 0]} rotation={[0.2, 0.95, 1.12]}>
        <cylinderGeometry args={[0.08, 0.11, 0.9, 12]} />
        <meshStandardMaterial color="#5A3E2A" roughness={0.93} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[-0.15, 0.12, 0.04]} rotation={[-0.2, -0.86, 1.06]}>
        <cylinderGeometry args={[0.08, 0.11, 0.9, 12]} />
        <meshStandardMaterial color="#64462F" roughness={0.93} metalness={0.02} />
      </mesh>

      {/* Ember bed */}
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

      {/* Dynamic point light with color modulation */}
      <pointLight
        ref={fireLightRef}
        color="#FF9C4A"
        intensity={1.5}
        distance={5.5}
        decay={1.7}
        position={[0, 0.5, 0]}
      />

      {/* Smoke depth-tests against world geometry (players, trees, terrain occlude it) */}
      <points geometry={smokeSystem.geometry} material={smokeMaterial} frustumCulled={false} renderOrder={1} />
      {/* Flame always renders on top of smoke via higher renderOrder */}
      <mesh geometry={glowGeometry} material={glowMaterial} position={[0, 0.06, 0]} frustumCulled={false} renderOrder={2} />
      <mesh ref={flameMeshRef} geometry={flameGeometry} material={flameMaterial} position={[0, 0.06, 0]} frustumCulled={false} renderOrder={3} />
      <points geometry={shellSystem.geometry} material={shellMaterial} frustumCulled={false} renderOrder={3} />
      <points geometry={sparkSystem.geometry} material={sparkMaterial} frustumCulled={false} renderOrder={4} />
    </RigidBody>
  );
}
