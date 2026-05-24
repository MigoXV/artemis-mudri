import type http from "node:http";
import type { ManualConfig } from "../../protocol/types";
import type { EpisodeRuntime } from "../runtime";

export function createHttpHandler(frontendConfig: ManualConfig, runtime: EpisodeRuntime) {
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
      runtime.stop();
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  };
}
