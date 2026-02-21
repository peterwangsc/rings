import { GOOMBA_SPAWNS } from './constants';
import { sampleTerrainHeight } from './terrain';

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
