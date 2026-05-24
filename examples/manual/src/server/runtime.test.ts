import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebSocket } from "ws";
import type { RuntimeConfig } from "./config";
import { EpisodeRuntime, type StartEpisodeLoop } from "./runtime";

const config: RuntimeConfig = {
  target: "127.0.0.1:50051",
  webHost: "127.0.0.1",
  webPort: 8765,
  maxSpeed: 20,
  accel: 80,
  controlPeriodS: 0.02,
  maxTimeS: 120,
  leftKey: "j",
  rightKey: "l"
};

function createLoopHarness() {
  const runs: Parameters<StartEpisodeLoop>[] = [];
  const closes: string[] = [];
  const startLoop: StartEpisodeLoop = (...args) => {
    runs.push(args);
    return {
      close: (reason = "manual_restart") => {
        closes.push(reason);
      }
    };
  };
  return { closes, runs, startLoop };
}

describe("EpisodeRuntime", () => {
  it("restarts an episode and resets control state", () => {
    const harness = createLoopHarness();
    const runtime = new EpisodeRuntime(config, harness.startLoop);
    runtime.state.leftSpeed = 10;
    runtime.state.rightSpeed = 12;
    runtime.state.leftKeyPressed = true;
    runtime.state.rightKeyPressed = true;

    runtime.restart();

    assert.equal(harness.runs.length, 1);
    assert.deepEqual(runtime.state, {
      leftSpeed: 0,
      rightSpeed: 0,
      leftKeyPressed: false,
      rightKeyPressed: false
    });
    assert.equal(harness.runs[0][3].stop, false);
    assert.deepEqual(runtime.snapshot(), { status: "starting" });
  });

  it("records finished reason and ignores later control input", () => {
    const harness = createLoopHarness();
    const runtime = new EpisodeRuntime(config, harness.startLoop);

    runtime.restart();
    harness.runs[0][4].onStatus?.("running");
    runtime.applyControl(true, true);
    harness.runs[0][4].onStatus?.("finished", "time_limit");
    runtime.applyControl(true, false);

    assert.deepEqual(runtime.snapshot(), { status: "finished", reason: "time_limit" });
    assert.deepEqual(runtime.state, {
      leftSpeed: 0,
      rightSpeed: 0,
      leftKeyPressed: false,
      rightKeyPressed: false
    });
  });

  it("clears terminal reason on restart and ignores stale callbacks", () => {
    const harness = createLoopHarness();
    const runtime = new EpisodeRuntime(config, harness.startLoop);
    const clientMessages: string[] = [];
    const client = {
      OPEN: 1,
      readyState: 1,
      send(message: string) {
        clientMessages.push(message);
      }
    } as unknown as WebSocket;

    runtime.addClient(client);
    runtime.restart();
    harness.runs[0][4].onStatus?.("finished", "time_limit");
    runtime.restart();
    harness.runs[0][4].onStatus?.("error", "stale_error");

    assert.equal(harness.closes.length, 0);
    assert.deepEqual(runtime.snapshot(), { status: "starting" });
  });
});
