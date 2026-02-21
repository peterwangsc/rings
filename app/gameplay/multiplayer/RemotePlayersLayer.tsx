"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CharacterActor } from "../../lib/CharacterActor";
import {
  CHARACTER_MODEL_YAW_OFFSET,
  PLAYER_VISUAL_Y_OFFSET,
  WORLD_UP,
} from "../../utils/constants";
import type { AuthoritativePlayerState, ChatMessageEvent } from "../../multiplayer/state/multiplayerTypes";

function RemotePlayerActor({
  player,
  chatMessage,
}: {
  player: AuthoritativePlayerState;
  /** Latest chat message event (with expiry), or null if none. */
  chatMessage: ChatMessageEvent | null;
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

  // Manages active chat text with expiry. Uses setTimeout for all setState calls
  // to comply with react-hooks/set-state-in-effect (no direct setState in effect body).
  const [activeChatText, setActiveChatText] = useState<string | null>(null);
  useEffect(() => {
    if (!chatMessage) {
      const id = window.setTimeout(() => setActiveChatText(null), 0);
      return () => window.clearTimeout(id);
    }
    const remaining = chatMessage.expiresAtMs - Date.now();
    const text = chatMessage.messageText;
    const showId = window.setTimeout(() => setActiveChatText(text), 0);
    if (remaining <= 0) return () => window.clearTimeout(showId);
    const expireId = window.setTimeout(() => setActiveChatText(null), remaining);
    return () => {
      window.clearTimeout(showId);
      window.clearTimeout(expireId);
    };
  }, [chatMessage]);

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

  const activeChatMessage = activeChatText;

  return (
    <group ref={rootRef} position={[player.x, player.y, player.z]}>
      <group position={[0, PLAYER_VISUAL_Y_OFFSET, 0]}>
        <CharacterActor
          motionState={player.motionState}
          planarSpeedRef={planarSpeedRef}
        />
      </group>
      <Html
        position={[-0.12, 1.12, -0.2]}
        center
        transform
        distanceFactor={15}
      >
        <div
          className={
            activeChatMessage
              ? "pointer-events-none max-w-[7.5rem] truncate rounded-sm border border-cyan-100/55 bg-black/60 px-1 py-0 text-[6px] font-semibold tracking-tight text-cyan-50 shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
              : "pointer-events-none rounded-sm border border-cyan-200/45 bg-black/50 px-1 py-0 text-[6px] font-semibold uppercase tracking-tight text-cyan-100 shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
          }
          title={activeChatMessage ?? player.displayName}
        >
          {activeChatMessage ?? player.displayName}
        </div>
      </Html>
    </group>
  );
}

export function RemotePlayersLayer({
  players,
  chatMessages,
}: {
  players: readonly AuthoritativePlayerState[];
  chatMessages: readonly ChatMessageEvent[];
}) {
  // Build a map from identity → latest ChatMessageEvent (pure — no Date.now())
  const chatByIdentity = useMemo(() => {
    const next = new Map<string, ChatMessageEvent>();
    for (const message of chatMessages) {
      next.set(message.ownerIdentity, message);
    }
    return next;
  }, [chatMessages]);

  return (
    <>
      {players.map((player) => (
        <RemotePlayerActor
          key={player.identity}
          player={player}
          chatMessage={chatByIdentity.get(player.identity) ?? null}
        />
      ))}
    </>
  );
}
