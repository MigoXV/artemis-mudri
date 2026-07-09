import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebSocket } from "ws";
import type { RuntimeConfig } from "./config";
import { resetControlState, type ControlState, type StopFlag } from "./state";
import { mapObservation, startZmqEpisodeLoopWithFactory } from "./zmqBridge";

const config: RuntimeConfig = {
  target: "tcp://127.0.0.1:5556",
  viewerStateConnect: "tcp://127.0.0.1:5555",
  webHost: "127.0.0.1",
  webPort: 8765,
  maxSpeed: 20,
  accel: 80,
  controlPeriodS: 0.001,
  maxTimeS: 120,
  leftKey: "j",
  rightKey: "l"
};

describe("ZMQ manual bridge", () => {
  it("maps JSON wire observations to manual console snapshots", () => {
    const snapshot = mapObservation({
      sequence_id: 7,
      sim_time_s: 0.14,
      pose: { x_m: 1.2, y_m: 0.4, yaw_rad: 0.2 },
      line_sensor_darkness: [0, 1],
      line_sensor: {
        world_sensor_positions: [[1, 2], [3, 4]]
      },
      imu: {
        yaw_deg: 11.5,
        yaw_rate_deg_s: 2.5
      },
      path_progress: {
        progress_m: 0.8,
        remaining_distance_m: 2.4,
        reached_goal: false
      },
      oracle: {
        cross_track_error_m: -0.03,
        heading_error_rad: 0.12
      },
      kinematics: {
        longitudinal_velocity_m_s: 0.5,
        yaw_rate_rad_s: 0.04
      },
      step_trace: {
        events: [{
          event_id: 3,
          step_id: 7,
          namespace: "path",
          type: "checkpoint",
          severity: "info",
          labels: { name: "checkpoint_a" },
          metrics: { path_index: 90, progress_m: 0.8 }
        }]
      }
    });

    assert.equal(snapshot.sequenceId, 7);
    assert.deepEqual(snapshot.pose, { xM: 1.2, yM: 0.4, yawRad: 0.2 });
    assert.deepEqual(snapshot.lineSensorDarkness, [0, 1]);
    assert.deepEqual(snapshot.sensorWorldPositions, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    assert.deepEqual(snapshot.completedEvents, ["checkpoint_a"]);
    assert.deepEqual(snapshot.simulationEvents, [{
      eventId: 3,
      stepId: 7,
      namespace: "path",
      type: "checkpoint",
      severity: "info",
      name: "checkpoint_a",
      labels: { name: "checkpoint_a" },
      metrics: { path_index: 90, progress_m: 0.8 }
    }]);
    assert.equal(snapshot.crossTrackErrorM, -0.03);
  });

  it("keeps unknown sparse simulation events renderable", () => {
    const snapshot = mapObservation({
      sequence_id: 8,
      sim_time_s: 0.16,
      pose: { x_m: 0, y_m: 0, yaw_rad: 0 },
      step_trace: {
        events: [{
          type: "reward_component",
          metrics: { reward: 1.25 }
        }]
      }
    });

    assert.deepEqual(snapshot.completedEvents, ["reward_component"]);
    assert.deepEqual(snapshot.simulationEvents, [{
      eventId: 0,
      stepId: 0,
      namespace: "simulation",
      type: "reward_component",
      severity: "info",
      name: "reward_component",
      labels: {},
      metrics: { reward: 1.25 }
    }]);
  });

  it("runs start, step and terminal responses through the request socket", async () => {
    const socket = new FakeSocket([
      {
        type: "started",
        observation: observation(0)
      },
      {
        type: "observation",
        observation: observation(1)
      },
      {
        type: "finished",
        finished: { reason: "time_limit" }
      }
    ]);
    const state: ControlState = {
      leftSpeed: 0,
      rightSpeed: 0,
      leftKeyPressed: true,
      rightKeyPressed: true
    };
    const stopFlag: StopFlag = { stop: false };
    const statuses: string[] = [];
    const observations: number[] = [];

    startZmqEpisodeLoopWithFactory(
      config,
      state,
      new Set<WebSocket>(),
      stopFlag,
      {
        onObservation: (nextObservation) => observations.push(nextObservation.sequenceId),
        onStatus: (status, reason) => statuses.push(reason ? `${status}:${reason}` : status)
      },
      () => socket
    );

    await waitUntil(() => statuses.includes("finished:time_limit"));

    assert.equal(JSON.stringify(statuses), JSON.stringify(["running", "finished:time_limit"]));
    assert.equal(JSON.stringify(observations), JSON.stringify([]));
    assert.equal(socket.target, config.target);
    assert.deepEqual(socket.requests.map((request) => request.type), ["start", "step", "step"]);
    assert.equal(socket.requests[1].rear_left_target_speed, 0.08);
    assert.equal(socket.requests[1].rear_right_target_speed, 0.08);
    resetControlState(state);
  });
});

function observation(sequenceId: number) {
  return {
    sequence_id: sequenceId,
    sim_time_s: sequenceId * 0.001,
    pose: { x_m: 0, y_m: 0, yaw_rad: 0 },
    line_sensor: {
      darkness: [],
      world_sensor_positions: []
    },
    step_trace: {
      events: []
    }
  };
}

class FakeSocket {
  target = "";
  requests: Array<Record<string, unknown>> = [];
  constructor(private readonly replies: Array<Record<string, unknown>>) {
  }

  connect(target: string) {
    this.target = target;
  }

  async send(message: string) {
    this.requests.push(JSON.parse(message) as Record<string, unknown>);
  }

  async receive() {
    const reply = this.replies.shift();
    if (!reply) throw new Error("No fake reply available.");
    return [Buffer.from(JSON.stringify(reply))];
  }

  close() {
  }
}

async function waitUntil(condition: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition.");
}
