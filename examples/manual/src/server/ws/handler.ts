import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "../../protocol/types";
import type { EpisodeRuntime } from "../runtime";

function applyClientMessage(message: ClientMessage, runtime: EpisodeRuntime) {
  if (message.type === "stop") {
    runtime.stop();
    return;
  }
  runtime.applyControl(Boolean(message.leftPressed), Boolean(message.rightPressed));
}

export function createManualWebSocketServer(
  server: http.Server,
  runtime: EpisodeRuntime
): Set<WebSocket> {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    runtime.addClient(socket);
    runtime.sendCurrentSnapshot(socket);
    socket.on("message", (rawMessage) => {
      const message = JSON.parse(String(rawMessage)) as ClientMessage;
      applyClientMessage(message, runtime);
    });
    socket.on("close", () => {
      runtime.removeClient(socket);
    });
  });

  return runtime.clients;
}
