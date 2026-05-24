import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManualConfig } from "../../protocol/types";
import { nextWheelTargets, type WheelTargets } from "../../vehicle/model";

type ControlPressedState = {
  leftPressed: boolean;
  rightPressed: boolean;
};

type UseDriveInputOptions = {
  config: ManualConfig | null;
  sendControl: (control: ControlPressedState, force?: boolean) => void;
  requestStop: () => void;
};

export function useDriveInput({ config, sendControl, requestStop }: UseDriveInputOptions) {
  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [targets, setTargets] = useState<WheelTargets>({ left: 0, right: 0 });
  const lastFrameRef = useRef(performance.now());
  const pressedRef = useRef(pressed);

  const controlPressed = useMemo(() => ({
    left: config ? pressed.has(config.leftKey) : false,
    right: config ? pressed.has(config.rightKey) : false
  }), [config, pressed]);

  const sendPressedState = useCallback((nextPressed: Set<string>, force = false) => {
    if (!config) return;
    sendControl({
      leftPressed: nextPressed.has(config.leftKey),
      rightPressed: nextPressed.has(config.rightKey)
    }, force);
  }, [config, sendControl]);

  const setPressedKey = useCallback((key: string, value: boolean) => {
    setPressed((current) => {
      const next = new Set(current);
      if (value) {
        next.add(key);
      } else {
        next.delete(key);
      }
      pressedRef.current = next;
      window.setTimeout(() => sendPressedState(next, true), 0);
      return next;
    });
  }, [sendPressedState]);

  useEffect(() => {
    pressedRef.current = pressed;
  }, [pressed]);

  useEffect(() => {
    if (!config) return;
    let animationId = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const active = pressedRef.current;
      setTargets((current) => nextWheelTargets(
        current,
        {
          leftKeyPressed: active.has(config.leftKey),
          rightKeyPressed: active.has(config.rightKey)
        },
        {
          accel: config.accel,
          maxSpeed: config.maxSpeed,
          dt
        }
      ));
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [config]);

  useEffect(() => {
    if (!config) return;
    const clearPressed = () => {
      const next = new Set<string>();
      setPressed(next);
      pressedRef.current = next;
      sendPressedState(next, true);
    };

    const keydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === config.leftKey || key === config.rightKey) {
        event.preventDefault();
        setPressedKey(key, true);
      }
      if (key === "q" || key === "escape") {
        requestStop();
      }
    };

    const keyup = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== config.leftKey && key !== config.rightKey) return;
      event.preventDefault();
      setPressedKey(key, false);
    };

    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clearPressed);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clearPressed);
    };
  }, [config, requestStop, sendPressedState, setPressedKey]);

  return {
    controlPressed,
    setPressedKey,
    targets
  };
}
