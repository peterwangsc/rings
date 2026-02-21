import * as THREE from "three";

type Boid = { pos: THREE.Vector3; vel: THREE.Vector3 };

const _sep = new THREE.Vector3();
const _ali = new THREE.Vector3();
const _coh = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export function stepBoidsCPU(
  boids: Boid[],
  dt: number,
  {
    neighborRadius = 3.5,
    separationRadius = 1.2,
    separationWeight = 1.2,
    alignmentWeight = 0.5,
    cohesionWeight = 0.35,
    maxSpeed = 4.5,
    minSpeed = 1.2,
  } = {},
) {
  const nr2 = neighborRadius * neighborRadius;
  const sr2 = separationRadius * separationRadius;

  for (let i = 0; i < boids.length; i++) {
    const a = boids[i];

    _sep.set(0, 0, 0);
    _ali.set(0, 0, 0);
    _coh.set(0, 0, 0);

    let count = 0;

    for (let j = 0; j < boids.length; j++) {
      if (i === j) continue;
      const b = boids[j];

      const d2 = a.pos.distanceToSquared(b.pos);
      if (d2 > nr2) continue;

      count++;

      // alignment
      _ali.add(b.vel);

      // cohesion
      _coh.add(b.pos);

      // separation
      if (d2 < sr2 && d2 > 1e-6) {
        _tmp
          .copy(a.pos)
          .sub(b.pos)
          .multiplyScalar(1 / d2);
        _sep.add(_tmp);
      }
    }

    if (count > 0) {
      _ali
        .multiplyScalar(1 / count)
        .sub(a.vel)
        .multiplyScalar(alignmentWeight);
      _coh
        .multiplyScalar(1 / count)
        .sub(a.pos)
        .multiplyScalar(cohesionWeight);
      _sep.multiplyScalar(separationWeight);

      a.vel.addScaledVector(_ali, dt);
      a.vel.addScaledVector(_coh, dt);
      a.vel.addScaledVector(_sep, dt);
    }

    // clamp speed
    const speed = a.vel.length();
    if (speed > maxSpeed) a.vel.setLength(maxSpeed);
    else if (speed < minSpeed) a.vel.setLength(minSpeed);

    a.pos.addScaledVector(a.vel, dt);
  }
}
