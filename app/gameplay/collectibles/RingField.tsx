"use client";

import { useMemo } from "react";
import { RING_HOVER_HEIGHT, RING_PLACEMENTS } from "../../utils/constants";
import { sampleTerrainHeight } from "../../utils/terrain";
import { Ring } from "./Ring";

interface RingFieldProps {
  readonly collectedIds: ReadonlySet<string>;
  readonly onCollect: (id: string) => void;
}

export function RingField({ collectedIds, onCollect }: RingFieldProps) {
  const placements = useMemo(
    () =>
      RING_PLACEMENTS.map((xz, index) => ({
        id: `ring-${index}`,
        position: [
          xz[0],
          sampleTerrainHeight(xz[0], xz[1]) + RING_HOVER_HEIGHT,
          xz[1],
        ] as const,
      })),
    [],
  );

  return (
    <>
      {placements
        .filter((ring) => !collectedIds.has(ring.id))
        .map((ring) => (
          <Ring
            key={ring.id}
            id={ring.id}
            position={ring.position}
            onCollect={onCollect}
          />
        ))}
    </>
  );
}
