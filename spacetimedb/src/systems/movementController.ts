const MAX_TICK_SECONDS = 0.2;

export type PlanarPose = {
  x: number;
  z: number;
  yaw: number;
};

export type PlanarControllerInput = {
  moveForward: number;
  moveRight: number;
  lookYaw: number;
  moveSpeed: number;
};

export type KeyboardLikeControllerInput = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  lookYaw: number;
  moveSpeed: number;
};

function clampAxis(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function normalizeYaw(yaw: number) {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

function resolveDigitalAxis(positive: boolean, negative: boolean) {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

export function toPlanarControllerInput(
  input: KeyboardLikeControllerInput,
): PlanarControllerInput {
  return {
    moveForward: resolveDigitalAxis(input.forward, input.backward),
    moveRight: resolveDigitalAxis(input.right, input.left),
    lookYaw: input.lookYaw,
    moveSpeed: input.moveSpeed,
  };
}

export function stepPlanarControllerMovement(
  pose: PlanarPose,
  input: PlanarControllerInput,
  deltaSeconds: number,
): PlanarPose {
  const dt = Math.max(0, Math.min(MAX_TICK_SECONDS, deltaSeconds));
  if (dt <= 0) {
    return {
      x: pose.x,
      z: pose.z,
      yaw: normalizeYaw(input.lookYaw),
    };
  }

  const yaw = normalizeYaw(input.lookYaw);
  const forwardInput = clampAxis(input.moveForward);
  const rightInput = clampAxis(input.moveRight);

  const forwardX = Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = Math.sin(yaw);

  let moveX = forwardX * forwardInput + rightX * rightInput;
  let moveZ = forwardZ * forwardInput + rightZ * rightInput;
  const moveMagnitude = Math.hypot(moveX, moveZ);

  if (moveMagnitude > 1) {
    const inverse = 1 / moveMagnitude;
    moveX *= inverse;
    moveZ *= inverse;
  }

  const step = Math.max(0, input.moveSpeed) * dt;

  return {
    x: pose.x + moveX * step,
    z: pose.z + moveZ * step,
    yaw,
  };
}
