"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CharacterActor } from "../../lib/CharacterActor";
import {
  CHARACTER_MODEL_YAW_OFFSET,
  PLAYER_VISUAL_Y_OFFSET,
  WORLD_UP,
} from "../../utils/constants";
import type { AuthoritativePlayerState } from "../../multiplayer/state/multiplayerTypes";

function RemotePlayerActor({
  player,
}: {
  player: AuthoritativePlayerState;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const planarSpeedRef = useRef(player.planarSpeed);
  const targetPositionRef = useRef(new THREE.Vector3(player.x, player.y, player.z));
  const targetYawRef = useRef(player.yaw);

  const currentTargetQuaternion = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    targetPositionRef.current.set(player.x, player.y, player.z);
    targetYawRef.current = player.yaw;
    planarSpeedRef.current = player.planarSpeed;
  }, [player.planarSpeed, player.x, player.y, player.yaw, player.z]);

  useFrame((_, deltaSeconds) => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const positionBlend = 1 - Math.exp(-14 * deltaSeconds);
    root.position.lerp(targetPositionRef.current, positionBlend);

    currentTargetQuaternion.setFromAxisAngle(
      WORLD_UP,
      targetYawRef.current + CHARACTER_MODEL_YAW_OFFSET,
    );
    const rotationBlend = 1 - Math.exp(-16 * deltaSeconds);
    root.quaternion.slerp(currentTargetQuaternion, rotationBlend);
  });

  return (
    <group ref={rootRef} position={[player.x, player.y, player.z]}>
      <group position={[0, PLAYER_VISUAL_Y_OFFSET, 0]}>
        <CharacterActor
          motionState={player.motionState}
          planarSpeedRef={planarSpeedRef}
        />
      </group>
      <Html position={[0, 1.9, 0]} center transform distanceFactor={15}>
        <div className="rounded-full border border-cyan-200/55 bg-black/55 px-2 py-1 text-[10px] font-semibold tracking-wide text-cyan-100 shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          {player.displayName}
        </div>
      </Html>
    </group>
  );
}

export function RemotePlayersLayer({
  players,
}: {
  players: readonly AuthoritativePlayerState[];
}) {
  return (
    <>
      {players.map((player) => (
        <RemotePlayerActor key={player.identity} player={player} />
      ))}
    </>
  );
}
