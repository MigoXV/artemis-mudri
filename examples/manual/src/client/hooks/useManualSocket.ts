import { useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ManualConfig, ObservationSnapshot, RuntimeStatus, ServerMessage } from "../../protocol/types";

type ControlPressedState = {
  leftPressed: boolean;
  rightPressed: boolean;
};

type UseManualSocketOptions = {
  config: ManualConfig | null;
  onObservation: (observation: ObservationSnapshot) => void;
  onRuntimeStatus: (status: RuntimeStatus, reason?: string) => void;
  onStatus: (status: string) => void;
};

const CONTROL_SEND_INTERVAL_MS = 20;

export function useManualSocket({ config, onObservation, onRuntimeStatus, onStatus }: UseManualSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const lastSendRef = useRef(0);
  const lastControlRef = useRef<ControlPressedState>({ leftPressed: false, rightPressed: false });

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const sendControl = useCallback((control: ControlPressedState, force = false) => {
    lastControlRef.current = control;
    const now = performance.now();
    if (!force && now - lastSendRef.current < CONTROL_SEND_INTERVAL_MS) return;
    lastSendRef.current = now;
    sendMessage({ type: "control", ...control });
  }, [sendMessage]);

  const requestStop = useCallback(() => {
    if (!sendMessage({ type: "stop" })) {
      fetch("/stop", { method: "POST", keepalive: true });
    }
    onStatus("已请求停止");
  }, [onStatus, sendMessage]);

  useEffect(() => {
    if (!config) return;
    let stopped = false;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (stopped) return;
      const socket = new WebSocket(config.wsUrl);
      activeSocket = socket;
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        onStatus("WebSocket 已连接");
        sendControl(lastControlRef.current, true);
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "status") {
          onRuntimeStatus(message.status, message.reason);
          return;
        }
        if (message.type !== "observation") return;
        onObservation(message.observation);
      });
      socket.addEventListener("close", () => {
        if (stopped) return;
        onStatus("WebSocket 已断开，正在重连...");
        reconnectTimer = window.setTimeout(connect, 500);
      });
      socket.addEventListener("error", () => {
        onStatus("WebSocket 连接错误");
      });
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      activeSocket?.close();
    };
  }, [config, onObservation, onRuntimeStatus, onStatus, sendControl]);

  return { sendControl, requestStop };
}
