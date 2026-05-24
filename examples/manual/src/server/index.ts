import http from "node:http";
import { runtimeConfig } from "./config";
import { buildFrontendConfig } from "./frontendConfig";
import { startGrpcLoop } from "./grpc/loop";
import { createHttpHandler } from "./http/handler";
import type { ControlState } from "./state";
import { createManualWebSocketServer } from "./ws/handler";

function main() {
  const config = runtimeConfig();
  const state: ControlState = {
    leftSpeed: 0,
    rightSpeed: 0,
    leftKeyPressed: false,
    rightKeyPressed: false
  };
  const stopFlag = { stop: false };
  const frontendConfig = buildFrontendConfig(config);

  const server = http.createServer(createHttpHandler(frontendConfig, stopFlag));
  const clients = createManualWebSocketServer(server, state, stopFlag);

  server.listen(config.webPort, config.webHost, () => {
    console.log(`Manual backend listening on http://${config.webHost}:${config.webPort}`);
    console.log(`React dev server should be available at http://127.0.0.1:5173`);
    console.log(`Connecting gRPC target ${config.target}`);
    startGrpcLoop(config, state, clients, stopFlag);
  });
}

main();
