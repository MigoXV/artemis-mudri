import http from "node:http";
import { runtimeConfig } from "./config";
import { buildFrontendConfig } from "./frontendConfig";
import { createHttpHandler } from "./http/handler";
import { EpisodeRuntime } from "./runtime";
import { createManualWebSocketServer } from "./ws/handler";

function main() {
  const config = runtimeConfig();
  const frontendConfig = buildFrontendConfig(config);
  const runtime = new EpisodeRuntime(config);

  const server = http.createServer(createHttpHandler(frontendConfig, runtime));
  createManualWebSocketServer(server, runtime);

  server.listen(config.webPort, config.webHost, () => {
    console.log(`Manual backend listening on http://${config.webHost}:${config.webPort}`);
    console.log(`React dev server should be available at http://127.0.0.1:5173`);
    console.log(`Connecting gRPC target ${config.target}`);
  });
}

main();
