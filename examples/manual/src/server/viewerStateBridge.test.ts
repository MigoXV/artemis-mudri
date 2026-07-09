import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebSocket } from "ws";
import type { RuntimeConfig } from "./config";
import { mapViewerStateMessage, startViewerStateLoopWithFactory } from "./viewerStateBridge";

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

describe("viewer state bridge", () => {
  it("maps JSON viewer state messages to manual console snapshots", () => {
    const snapshot = mapViewerStateMessage({
      time: 1.25,
      sequence_id: 42,
      qpos: [1, 2, 0.5],
      qvel: [0.3, 0, 0.1],
      pose: { x_m: 1, y_m: 2, yaw_rad: Math.PI / 2 },
      kinematics: {
        longitudinal_velocity_m_s: 0.3,
        yaw_rate_rad_s: 0.1
      }
    });

    assert.equal(snapshot.sequenceId, 42);
    assert.equal(snapshot.simTimeS, 1.25);
    assert.deepEqual(snapshot.pose, { xM: 1, yM: 2, yawRad: Math.PI / 2 });
    assert.equal(snapshot.yawDeg, 90);
    assert.equal(snapshot.longitudinalVelocityMS, 0.3);
    assert.equal(snapshot.yawRateRadS, 0.1);
    assert.deepEqual(snapshot.lineSensorDarkness, []);
  });

  it("broadcasts state stream observations to websocket clients", async () => {
    const socket = new FakeSubscriber([{
      time: 0.02,
      sequence_id: 1,
      pose: { x_m: 0.1, y_m: 0.2, yaw_rad: 0.3 },
      kinematics: {
        longitudinal_velocity_m_s: 0.4,
        yaw_rate_rad_s: 0.5
      }
    }]);
    const clientMessages: string[] = [];
    const client = {
      OPEN: 1,
      readyState: 1,
      send(message: string) {
        clientMessages.push(message);
      }
    } as unknown as WebSocket;
    const observations: number[] = [];

    const loop = startViewerStateLoopWithFactory(
      config,
      new Set<WebSocket>([client]),
      {
        onObservation: (observation) => observations.push(observation.sequenceId)
      },
      () => socket
    );

    await waitUntil(() => clientMessages.length === 1);
    loop.close();

    assert.equal(socket.target, config.viewerStateConnect);
    assert.equal(socket.subscribed, true);
    assert.deepEqual(observations, [1]);
    const payload = JSON.parse(clientMessages[0]);
    assert.equal(payload.type, "observation");
    assert.equal(payload.observation.sequenceId, 1);
    assert.deepEqual(payload.observation.pose, { xM: 0.1, yM: 0.2, yawRad: 0.3 });
    assert.equal(payload.observation.longitudinalVelocityMS, 0.4);
    assert.equal(payload.observation.yawRateRadS, 0.5);
    assert.ok(Math.abs(payload.observation.yawDeg - 17.1887) < 0.0001);
    assert.ok(Math.abs(payload.observation.yawRateDegS - 28.6479) < 0.0001);
  });
});

class FakeSubscriber {
  target = "";
  subscribed = false;
  closed = false;

  constructor(private readonly replies: Array<Record<string, unknown>>) {}

  connect(target: string) {
    this.target = target;
  }

  subscribe() {
    this.subscribed = true;
  }

  async receive() {
    const reply = this.replies.shift();
    if (reply) return [Buffer.from(JSON.stringify(reply))];
    return new Promise<Array<Buffer>>(() => undefined);
  }

  close() {
    this.closed = true;
  }
}

async function waitUntil(condition: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition.");
}
