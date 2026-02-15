"use client";

import { Camera, Flame } from "lucide-react";
import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MobileMoveInput } from "../controller/controllerTypes";

const MOBILE_JOYSTICK_RADIUS_PX = 44;
const MOBILE_JOYSTICK_DEADZONE = 0.08;

export function MobileControlsOverlay({
  moveInputRef,
  jumpPressedRef,
  fireballTriggerRef,
  onToggleCameraMode,
  isChatOpen,
}: {
  moveInputRef: MutableRefObject<MobileMoveInput>;
  jumpPressedRef: MutableRefObject<boolean>;
  fireballTriggerRef: MutableRefObject<number>;
  onToggleCameraMode: () => void;
  isChatOpen: boolean;
}) {
  const joystickPointerIdRef = useRef<number | null>(null);
  const jumpPointerIdRef = useRef<number | null>(null);
  const fireballPointerIdRef = useRef<number | null>(null);
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const [isJumpActive, setIsJumpActive] = useState(false);
  const [isFireballActive, setIsFireballActive] = useState(false);

  const setMoveInput = useCallback(
    (x: number, y: number) => {
      moveInputRef.current.x = x;
      moveInputRef.current.y = y;
    },
    [moveInputRef],
  );

  const updateJoystickFromPointer = useCallback(
    (clientX: number, clientY: number, element: HTMLDivElement) => {
      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width * 0.5;
      const centerY = bounds.top + bounds.height * 0.5;
      const deltaX = clientX - centerX;
      const deltaY = clientY - centerY;
      const distance = Math.hypot(deltaX, deltaY);
      const clampedDistance = Math.min(distance, MOBILE_JOYSTICK_RADIUS_PX);
      const distanceScale = distance > 0 ? clampedDistance / distance : 0;
      const clampedX = deltaX * distanceScale;
      const clampedY = deltaY * distanceScale;
      const normalizedX = clampedX / MOBILE_JOYSTICK_RADIUS_PX;
      const normalizedY = clampedY / MOBILE_JOYSTICK_RADIUS_PX;
      const normalizedMagnitude = Math.hypot(normalizedX, normalizedY);

      setJoystickOffset({ x: clampedX, y: clampedY });

      if (normalizedMagnitude < MOBILE_JOYSTICK_DEADZONE) {
        setMoveInput(0, 0);
        return;
      }

      const deadzoneAdjustedMagnitude =
        (normalizedMagnitude - MOBILE_JOYSTICK_DEADZONE) /
        (1 - MOBILE_JOYSTICK_DEADZONE);
      const directionalScale =
        normalizedMagnitude > 0
          ? deadzoneAdjustedMagnitude / normalizedMagnitude
          : 0;
      setMoveInput(
        normalizedX * directionalScale,
        normalizedY * directionalScale,
      );
    },
    [setMoveInput],
  );

  const releaseJoystick = useCallback(
    (element: HTMLDivElement, pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
      joystickPointerIdRef.current = null;
      setMoveInput(0, 0);
      setJoystickOffset({ x: 0, y: 0 });
      setIsJoystickActive(false);
    },
    [setMoveInput],
  );

  const releaseJumpButton = useCallback(
    (element: HTMLButtonElement, pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
      jumpPointerIdRef.current = null;
      jumpPressedRef.current = false;
      setIsJumpActive(false);
    },
    [jumpPressedRef],
  );

  const releaseFireballButton = useCallback(
    (element: HTMLButtonElement, pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
      fireballPointerIdRef.current = null;
      setIsFireballActive(false);
    },
    [],
  );

  const handleJoystickPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== null) {
        return;
      }
      joystickPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsJoystickActive(true);
      updateJoystickFromPointer(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      event.preventDefault();
    },
    [updateJoystickFromPointer],
  );

  const handleJoystickPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== event.pointerId) {
        return;
      }
      updateJoystickFromPointer(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      event.preventDefault();
    },
    [updateJoystickFromPointer],
  );

  const handleJoystickPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== event.pointerId) {
        return;
      }
      releaseJoystick(event.currentTarget, event.pointerId);
      event.preventDefault();
    },
    [releaseJoystick],
  );

  const handleJoystickLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (joystickPointerIdRef.current !== event.pointerId) {
        return;
      }
      joystickPointerIdRef.current = null;
      setMoveInput(0, 0);
      setJoystickOffset({ x: 0, y: 0 });
      setIsJoystickActive(false);
    },
    [setMoveInput],
  );

  const handleJumpPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (jumpPointerIdRef.current !== null) {
        return;
      }
      jumpPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      jumpPressedRef.current = true;
      setIsJumpActive(true);
      event.preventDefault();
    },
    [jumpPressedRef],
  );

  const handleJumpPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (jumpPointerIdRef.current !== event.pointerId) {
        return;
      }
      releaseJumpButton(event.currentTarget, event.pointerId);
      event.preventDefault();
    },
    [releaseJumpButton],
  );

  const handleJumpLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (jumpPointerIdRef.current !== event.pointerId) {
        return;
      }
      jumpPointerIdRef.current = null;
      jumpPressedRef.current = false;
      setIsJumpActive(false);
    },
    [jumpPressedRef],
  );

  const handleFireballPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (fireballPointerIdRef.current !== null) {
        return;
      }
      fireballPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsFireballActive(true);
      fireballTriggerRef.current += 1;
      event.preventDefault();
    },
    [fireballTriggerRef],
  );

  const handleFireballPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (fireballPointerIdRef.current !== event.pointerId) {
        return;
      }
      releaseFireballButton(event.currentTarget, event.pointerId);
      event.preventDefault();
    },
    [releaseFireballButton],
  );

  const handleFireballLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (fireballPointerIdRef.current !== event.pointerId) {
        return;
      }
      fireballPointerIdRef.current = null;
      setIsFireballActive(false);
    },
    [],
  );

  useEffect(() => {
    return () => {
      setMoveInput(0, 0);
      jumpPressedRef.current = false;
      joystickPointerIdRef.current = null;
      jumpPointerIdRef.current = null;
      fireballPointerIdRef.current = null;
    };
  }, [jumpPressedRef, setMoveInput]);

  if (isChatOpen) {
    return null;
  }

  return (
    <div className="ui-nonselectable mobile-game-controls pointer-events-none absolute inset-0 z-40 items-end justify-between px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-6">
      <div
        role="presentation"
        className="mobile-joystick pointer-events-auto touch-none select-none"
        onPointerDown={handleJoystickPointerDown}
        onPointerMove={handleJoystickPointerMove}
        onPointerUp={handleJoystickPointerUp}
        onPointerCancel={handleJoystickPointerUp}
        onLostPointerCapture={handleJoystickLostPointerCapture}
      >
        <div className="mobile-joystick__ring" />
        <div
          className={`mobile-joystick__thumb ${isJoystickActive ? "mobile-joystick__thumb--active" : ""}`}
          style={{
            transform: `translate3d(${joystickOffset.x}px, ${joystickOffset.y}px, 0)`,
          }}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          aria-label="Toggle view mode"
          className="mobile-view-toggle-button pointer-events-auto touch-none select-none"
          onClick={onToggleCameraMode}
        >
          <Camera
            aria-hidden="true"
            className="mobile-control-icon mobile-control-icon--camera"
          />
        </button>
        <div className="mobile-jump-cluster">
          <button
            type="button"
            aria-label="Fireball"
            className={`mobile-fireball-button pointer-events-auto touch-none select-none ${isFireballActive ? "mobile-fireball-button--active" : ""}`}
            onPointerDown={handleFireballPointerDown}
            onPointerUp={handleFireballPointerUp}
            onPointerCancel={handleFireballPointerUp}
            onLostPointerCapture={handleFireballLostPointerCapture}
          >
            <Flame
              aria-hidden="true"
              className="mobile-control-icon mobile-control-icon--fireball"
            />
          </button>
          <button
            type="button"
            aria-label="Jump"
            className={`mobile-jump-button mobile-jump-cluster__jump pointer-events-auto touch-none select-none ${isJumpActive ? "mobile-jump-button--active" : ""}`}
            onPointerDown={handleJumpPointerDown}
            onPointerUp={handleJumpPointerUp}
            onPointerCancel={handleJumpPointerUp}
            onLostPointerCapture={handleJumpLostPointerCapture}
          >
            <span className="mobile-jump-button__label">Jump</span>
          </button>
        </div>
      </div>
    </div>
  );
}
