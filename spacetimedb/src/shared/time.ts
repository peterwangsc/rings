export function nowMs(ctx: { timestamp: { toMillis(): bigint } }) {
  return Number(ctx.timestamp.toMillis());
}

export function getConnectionIdHex(connectionId: { toHexString(): string } | null) {
  return connectionId ? connectionId.toHexString() : null;
}
