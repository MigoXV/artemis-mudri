import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebSocket } from "ws";
import type { RuntimeConfig } from "./config";
import { EpisodeRuntime, type StartEpisodeLoop, type StartViewerStateLoop } from "./runtime";

const config: RuntimeConfig = {
  target: "tcp://127.0.0.1:5556",
  viewerStateConnect: "tcp://127.0.0.1:5555",
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

function createStateLoopHarness() {
  const runs: Parameters<StartViewerStateLoop>[] = [];
  const startLoop: StartViewerStateLoop = (...args) => {
    runs.push(args);
    return {
      close: () => undefined
    };
  };
  return { runs, startLoop };
}

describe("EpisodeRuntime", () => {
  it("does not start a control loop when sending an initial snapshot", () => {
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
    runtime.sendCurrentSnapshot(client);

    assert.equal(harness.runs.length, 0);
    assert.deepEqual(JSON.parse(clientMessages[0]), { type: "status", status: "idle" });
  });

  it("starts manual control on the first non-empty control input", () => {
    const harness = createLoopHarness();
    const runtime = new EpisodeRuntime(config, harness.startLoop);

    runtime.applyControl(false, false);
    assert.equal(harness.runs.length, 0);

    runtime.applyControl(true, false);

    assert.equal(harness.runs.length, 1);
    assert.deepEqual(runtime.snapshot(), { status: "starting" });
    assert.equal(runtime.state.leftKeyPressed, true);
    assert.equal(runtime.state.rightKeyPressed, false);
  });

  it("stores viewer state observations for later websocket snapshots", () => {
    const controlHarness = createLoopHarness();
    const stateHarness = createStateLoopHarness();
    const runtime = new EpisodeRuntime(config, controlHarness.startLoop, stateHarness.startLoop);
    const clientMessages: string[] = [];
    const client = {
      OPEN: 1,
      readyState: 1,
      send(message: string) {
        clientMessages.push(message);
      }
    } as unknown as WebSocket;

    runtime.startViewerStateStream();
    stateHarness.runs[0][2].onObservation?.({
      sequenceId: 3,
      simTimeS: 0.06,
      pose: { xM: 1, yM: 2, yawRad: 0.3 },
      lineSensorDarkness: [],
      sensorWorldPositions: [],
      yawDeg: 17.2,
      yawRateDegS: 0,
      progressM: 0,
      remainingDistanceM: 0,
      completedEvents: [],
      reachedGoal: false,
      crossTrackErrorM: 0,
      headingErrorRad: 0,
      longitudinalVelocityMS: 0.4,
      yawRateRadS: 0,
      simulationEvents: []
    });

    runtime.addClient(client);
    runtime.sendCurrentSnapshot(client);

    assert.equal(stateHarness.runs.length, 1);
    assert.deepEqual(JSON.parse(clientMessages[0]), { type: "status", status: "idle" });
    assert.equal(JSON.parse(clientMessages[1]).observation.sequenceId, 3);
  });

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

  it("records finished reason and starts a new loop on later control input", () => {
    const harness = createLoopHarness();
    const runtime = new EpisodeRuntime(config, harness.startLoop);

    runtime.restart();
    harness.runs[0][4].onStatus?.("running");
    runtime.applyControl(true, true);
    harness.runs[0][4].onStatus?.("finished", "time_limit");
    runtime.applyControl(false, false);

    assert.deepEqual(runtime.snapshot(), { status: "finished", reason: "time_limit" });
    assert.deepEqual(runtime.state, {
      leftSpeed: 0,
      rightSpeed: 0,
      leftKeyPressed: false,
      rightKeyPressed: false
    });

    runtime.applyControl(true, false);

    assert.equal(harness.runs.length, 2);
    assert.deepEqual(runtime.snapshot(), { status: "starting" });
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
