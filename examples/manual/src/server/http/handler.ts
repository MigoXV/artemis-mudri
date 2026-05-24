import type http from "node:http";
import type { ManualConfig } from "../../protocol/types";
import type { StopFlag } from "../state";

export function createHttpHandler(frontendConfig: ManualConfig, stopFlag: StopFlag) {
  return (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (request.method === "GET" && request.url === "/config.json") {
      const body = JSON.stringify(frontendConfig);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      });
      response.end(body);
      return;
    }
    if (request.method === "POST" && request.url === "/stop") {
      stopFlag.stop = true;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  };
}
