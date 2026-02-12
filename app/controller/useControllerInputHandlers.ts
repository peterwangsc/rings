"use client";

import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import { updateLookAngles } from "../camera/cameraRig";
import { type EmoteState } from "../lib/CharacterActor";
import {
  CAMERA_MODE_TOGGLE_KEY,
  DEFAULT_INPUT_STATE,
  HAPPY_EMOTE_KEY,
  JUMP_INPUT_BUFFER_SECONDS,
  SAD_EMOTE_KEY,
} from "../utils/constants";
import type { CharacterInputState } from "./controllerTypes";

export function useControllerInputHandlers({
  camera,
  gl,
  onPointerLockChange,
  onToggleCameraMode,
  onToggleDefaultGait,
  inputStateRef,
  jumpIntentTimerRef,
  emoteRequestRef,
  activeEmoteRef,
  mobileJumpWasPressedRef,
  isPointerLockedRef,
  activeTouchPointerIdRef,
  activeTouchPositionRef,
  cameraYawRef,
  cameraPitchRef,
}: {
  camera: THREE.Camera;
  gl: THREE.WebGLRenderer;
  onPointerLockChange?: (isLocked: boolean) => void;
  onToggleCameraMode: () => void;
  onToggleDefaultGait: () => void;
  inputStateRef: MutableRefObject<CharacterInputState>;
  jumpIntentTimerRef: MutableRefObject<number>;
  emoteRequestRef: MutableRefObject<EmoteState | null>;
  activeEmoteRef: MutableRefObject<EmoteState | null>;
  mobileJumpWasPressedRef: MutableRefObject<boolean>;
  isPointerLockedRef: MutableRefObject<boolean>;
  activeTouchPointerIdRef: MutableRefObject<number | null>;
  activeTouchPositionRef: MutableRefObject<{ x: number; y: number } | null>;
  cameraYawRef: MutableRefObject<number>;
  cameraPitchRef: MutableRefObject<number>;
}) {
  useEffect(() => {
    const domElement = gl.domElement;
    camera.up.set(0, 1, 0);
    isPointerLockedRef.current = document.pointerLockElement === domElement;
    onPointerLockChange?.(isPointerLockedRef.current);
    const supportsPointerEvents = "PointerEvent" in window;

    const clearActiveTouchPointer = (pointerId?: number) => {
      if (
        pointerId !== undefined &&
        activeTouchPointerIdRef.current !== null &&
        activeTouchPointerIdRef.current !== pointerId
      ) {
        return;
      }
      const resolvedPointerId = pointerId ?? activeTouchPointerIdRef.current;
      if (
        supportsPointerEvents &&
        resolvedPointerId !== null &&
        domElement.hasPointerCapture(resolvedPointerId)
      ) {
        domElement.releasePointerCapture(resolvedPointerId);
      }
      activeTouchPointerIdRef.current = null;
      activeTouchPositionRef.current = null;
    };

    const resetInputState = () => {
      inputStateRef.current = { ...DEFAULT_INPUT_STATE };
      jumpIntentTimerRef.current = 0;
      emoteRequestRef.current = null;
      activeEmoteRef.current = null;
      mobileJumpWasPressedRef.current = false;
      clearActiveTouchPointer();
    };

    const setInputState = (code: string, isPressed: boolean) => {
      const input = inputStateRef.current;
      switch (code) {
        case "KeyW":
          input.forward = isPressed;
          break;
        case "KeyS":
          input.backward = isPressed;
          break;
        case "KeyA":
          input.left = isPressed;
          break;
        case "KeyD":
          input.right = isPressed;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          input.sprint = isPressed;
          break;
        case "Space":
          input.jump = isPressed;
          break;
        default:
          break;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === CAMERA_MODE_TOGGLE_KEY && !event.repeat) {
        onToggleCameraMode();
        return;
      }

      if (event.code === "CapsLock" && !event.repeat) {
        onToggleDefaultGait();
        return;
      }

      if (event.code === "Space" && !event.repeat) {
        jumpIntentTimerRef.current = JUMP_INPUT_BUFFER_SECONDS;
      }

      if (event.code === HAPPY_EMOTE_KEY && !event.repeat) {
        emoteRequestRef.current = "happy";
        return;
      }

      if (event.code === SAD_EMOTE_KEY && !event.repeat) {
        emoteRequestRef.current = "sad";
        return;
      }

      setInputState(event.code, true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setInputState(event.code, false);
    };

    const handlePointerLockChangeEvent = () => {
      isPointerLockedRef.current = document.pointerLockElement === domElement;
      onPointerLockChange?.(isPointerLockedRef.current);
      if (!isPointerLockedRef.current) {
        resetInputState();
      }
    };

    const applyLookDelta = (movementX: number, movementY: number) => {
      const nextAngles = updateLookAngles(
        cameraYawRef.current,
        cameraPitchRef.current,
        movementX,
        movementY,
      );
      cameraYawRef.current = nextAngles.yaw;
      cameraPitchRef.current = nextAngles.pitch;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isPointerLockedRef.current) {
        return;
      }

      applyLookDelta(event.movementX, event.movementY);
    };

    const requestPointerLock = () => {
      if (
        document.pointerLockElement !== domElement &&
        typeof domElement.requestPointerLock === "function"
      ) {
        domElement.requestPointerLock();
      }
    };

    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        event.preventDefault();
        if (activeTouchPointerIdRef.current === null) {
          activeTouchPointerIdRef.current = event.pointerId;
          activeTouchPositionRef.current = {
            x: event.clientX,
            y: event.clientY,
          };
          domElement.setPointerCapture(event.pointerId);
        }
        return;
      }
      if (event.button !== 0) {
        return;
      }
      requestPointerLock();
    };

    const handleCanvasPointerMove = (event: PointerEvent) => {
      if (
        event.pointerType !== "touch" ||
        activeTouchPointerIdRef.current !== event.pointerId ||
        activeTouchPositionRef.current === null
      ) {
        return;
      }

      const movementX = event.clientX - activeTouchPositionRef.current.x;
      const movementY = event.clientY - activeTouchPositionRef.current.y;
      activeTouchPositionRef.current.x = event.clientX;
      activeTouchPositionRef.current.y = event.clientY;

      if (movementX === 0 && movementY === 0) {
        return;
      }

      event.preventDefault();
      applyLookDelta(movementX, movementY);
    };

    const handleCanvasTouchPointerEnd = (event: PointerEvent) => {
      clearActiveTouchPointer(event.pointerId);
    };

    const handleCanvasLostPointerCapture = (event: PointerEvent) => {
      clearActiveTouchPointer(event.pointerId);
    };

    const findTouchByIdentifier = (touchList: TouchList, identifier: number) => {
      for (let index = 0; index < touchList.length; index += 1) {
        const touch = touchList.item(index);
        if (touch?.identifier === identifier) {
          return touch;
        }
      }
      return null;
    };

    const handleCanvasTouchStart = (event: TouchEvent) => {
      if (activeTouchPointerIdRef.current !== null) {
        return;
      }
      const touch = event.changedTouches.item(0);
      if (!touch) {
        return;
      }
      activeTouchPointerIdRef.current = touch.identifier;
      activeTouchPositionRef.current = { x: touch.clientX, y: touch.clientY };
      event.preventDefault();
    };

    const handleCanvasTouchMove = (event: TouchEvent) => {
      if (
        activeTouchPointerIdRef.current === null ||
        activeTouchPositionRef.current === null
      ) {
        return;
      }
      const touch =
        findTouchByIdentifier(event.touches, activeTouchPointerIdRef.current) ??
        findTouchByIdentifier(
          event.changedTouches,
          activeTouchPointerIdRef.current,
        );
      if (!touch) {
        return;
      }
      const movementX = touch.clientX - activeTouchPositionRef.current.x;
      const movementY = touch.clientY - activeTouchPositionRef.current.y;
      activeTouchPositionRef.current.x = touch.clientX;
      activeTouchPositionRef.current.y = touch.clientY;
      if (movementX === 0 && movementY === 0) {
        return;
      }
      event.preventDefault();
      applyLookDelta(movementX, movementY);
    };

    const handleCanvasTouchEndOrCancel = (event: TouchEvent) => {
      if (activeTouchPointerIdRef.current === null) {
        return;
      }
      const touch = findTouchByIdentifier(
        event.changedTouches,
        activeTouchPointerIdRef.current,
      );
      if (!touch) {
        return;
      }
      clearActiveTouchPointer();
    };

    if (supportsPointerEvents) {
      domElement.addEventListener("pointerdown", handleCanvasPointerDown);
      domElement.addEventListener("pointermove", handleCanvasPointerMove);
      domElement.addEventListener("pointerup", handleCanvasTouchPointerEnd);
      domElement.addEventListener("pointercancel", handleCanvasTouchPointerEnd);
      domElement.addEventListener(
        "lostpointercapture",
        handleCanvasLostPointerCapture,
      );
    } else {
      domElement.addEventListener("click", requestPointerLock);
      domElement.addEventListener("touchstart", handleCanvasTouchStart, {
        passive: false,
      });
      domElement.addEventListener("touchmove", handleCanvasTouchMove, {
        passive: false,
      });
      domElement.addEventListener("touchend", handleCanvasTouchEndOrCancel);
      domElement.addEventListener("touchcancel", handleCanvasTouchEndOrCancel);
    }

    document.addEventListener("pointerlockchange", handlePointerLockChangeEvent);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetInputState);

    return () => {
      if (supportsPointerEvents) {
        domElement.removeEventListener("pointerdown", handleCanvasPointerDown);
        domElement.removeEventListener("pointermove", handleCanvasPointerMove);
        domElement.removeEventListener("pointerup", handleCanvasTouchPointerEnd);
        domElement.removeEventListener(
          "pointercancel",
          handleCanvasTouchPointerEnd,
        );
        domElement.removeEventListener(
          "lostpointercapture",
          handleCanvasLostPointerCapture,
        );
      } else {
        domElement.removeEventListener("click", requestPointerLock);
        domElement.removeEventListener("touchstart", handleCanvasTouchStart);
        domElement.removeEventListener("touchmove", handleCanvasTouchMove);
        domElement.removeEventListener("touchend", handleCanvasTouchEndOrCancel);
        domElement.removeEventListener(
          "touchcancel",
          handleCanvasTouchEndOrCancel,
        );
      }
      document.removeEventListener(
        "pointerlockchange",
        handlePointerLockChangeEvent,
      );
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", resetInputState);
      isPointerLockedRef.current = false;
      onPointerLockChange?.(false);
      resetInputState();
    };
  }, [
    activeEmoteRef,
    activeTouchPointerIdRef,
    activeTouchPositionRef,
    camera,
    cameraPitchRef,
    cameraYawRef,
    emoteRequestRef,
    gl,
    inputStateRef,
    isPointerLockedRef,
    jumpIntentTimerRef,
    mobileJumpWasPressedRef,
    onPointerLockChange,
    onToggleCameraMode,
    onToggleDefaultGait,
  ]);
}
