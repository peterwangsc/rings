import { RING_DROP_HOVER_HEIGHT, type RingDropSource } from '../shared/constants';
import { sampleTerrainHeight } from '../shared/terrain';

type RingDropInsertContext = {
  newUuidV4(): { toString(): string };
  db: {
    ringDropState: {
      insert(row: {
        ringId: string;
        x: number;
        y: number;
        z: number;
        source: string;
        collected: boolean;
        collectedBy: string | undefined;
        collectedAtMs: number | undefined;
        spawnedAtMs: number;
      }): void;
    };
  };
};

export function insertDropRing(
  ctx: RingDropInsertContext,
  timestampMs: number,
  source: RingDropSource,
  x: number,
  z: number,
) {
  const terrainY = sampleTerrainHeight(x, z) + RING_DROP_HOVER_HEIGHT;
  ctx.db.ringDropState.insert({
    ringId: `${source}-${timestampMs}-${ctx.newUuidV4().toString()}`,
    x,
    y: terrainY,
    z,
    source,
    collected: false,
    collectedBy: undefined,
    collectedAtMs: undefined,
    spawnedAtMs: timestampMs,
  });
}
