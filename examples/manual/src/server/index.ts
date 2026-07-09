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
  runtime.startViewerStateStream();

  server.listen(config.webPort, config.webHost, () => {
    const vitePort = process.env.ARTEMIS_MANUAL_VITE_PORT ?? "5173";
    console.log(`Manual backend listening on http://${config.webHost}:${config.webPort}`);
    console.log(`React dev server should be available at http://127.0.0.1:${vitePort}`);
    console.log(`Manual console ZMQ bridge target is ${config.target}`);
    console.log(`Manual console viewer state source is ${config.viewerStateConnect}`);
  });
}

main();
