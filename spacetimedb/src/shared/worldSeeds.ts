import { GOOMBA_SPAWNS, RING_HOVER_HEIGHT, RING_PLACEMENTS } from './constants';
import { sampleTerrainHeight } from './terrain';

export const ringSeedData = RING_PLACEMENTS.map((ring, index) => ({
  ringId: `ring-${index}`,
  x: ring[0],
  y: sampleTerrainHeight(ring[0], ring[1]) + RING_HOVER_HEIGHT,
  z: ring[1],
}));

export const ringPositionById = new Map(
  ringSeedData.map((ring) => [ring.ringId, ring] as const),
);

export const goombaSeedData = GOOMBA_SPAWNS.map((spawn, index) => {
  const x = spawn[0];
  const z = spawn[1];
  const y = sampleTerrainHeight(x, z);
  return {
    goombaId: `goomba-${index}`,
    spawnX: x,
    spawnY: y,
    spawnZ: z,
  };
});
