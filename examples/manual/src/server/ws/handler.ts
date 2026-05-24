import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "../../protocol/types";
import type { ControlState, StopFlag } from "../state";

function resetControlState(state: ControlState) {
  state.leftKeyPressed = false;
  state.rightKeyPressed = false;
  state.leftSpeed = 0;
  state.rightSpeed = 0;
}

function applyClientMessage(message: ClientMessage, state: ControlState, stopFlag: StopFlag) {
  if (message.type === "stop") {
    resetControlState(state);
    stopFlag.stop = true;
    return;
  }
  state.leftKeyPressed = Boolean(message.leftPressed);
  state.rightKeyPressed = Boolean(message.rightPressed);
}

export function createManualWebSocketServer(
  server: http.Server,
  state: ControlState,
  stopFlag: StopFlag
): Set<WebSocket> {
  const clients = new Set<WebSocket>();
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("message", (rawMessage) => {
      const message = JSON.parse(String(rawMessage)) as ClientMessage;
      applyClientMessage(message, state, stopFlag);
    });
    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  return clients;
}
