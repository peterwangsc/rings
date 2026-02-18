import type { Infer } from "spacetimedb";
import type { MotionState } from "../../lib/CharacterActor";
import {
  CastFireball as CastFireballContract,
  CollectRing as CollectRingContract,
  HitGoomba as HitGoombaContract,
  HitMysteryBox as HitMysteryBoxContract,
  SendChatMessage as SendChatMessageContract,
  UpsertPlayerState as UpsertPlayerStateContract,
} from "../spacetime/bindings";

export type UpsertPlayerStateCommand = Infer<typeof UpsertPlayerStateContract>;
export type CastFireballCommand = Infer<typeof CastFireballContract>;
export type CollectRingCommand = Infer<typeof CollectRingContract>;
export type HitGoombaCommand = Infer<typeof HitGoombaContract>;
export type HitMysteryBoxCommand = Infer<typeof HitMysteryBoxContract>;
export type SendChatMessageCommand = Infer<typeof SendChatMessageContract>;

export type LocalPlayerSnapshot = Omit<
  UpsertPlayerStateCommand,
  "displayName" | "motionState"
> & {
  motionState: MotionState;
};
