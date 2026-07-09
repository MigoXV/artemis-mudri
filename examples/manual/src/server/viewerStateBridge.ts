import type { WebSocket } from "ws";
import { Subscriber } from "zeromq";
import type { ObservationSnapshot } from "../protocol/types";
import type { RuntimeConfig } from "./config";

type ActiveLoop = {
  close: () => void;
};

type StateCallbacks = {
  onObservation?: (observation: ObservationSnapshot) => void;
  onError?: (reason: string) => void;
};

type SubscriberSocket = {
  connect: (target: string) => void;
  subscribe: () => void;
  receive: () => Promise<Array<Buffer | Uint8Array | string>>;
  close: () => void;
};

type SubscriberFactory = () => SubscriberSocket;

type ViewerStateMessage = {
  time: number;
  sequence_id: number;
  qpos?: number[];
  qvel?: number[];
  pose: {
    x_m: number;
    y_m: number;
    yaw_rad: number;
  };
  kinematics?: {
    longitudinal_velocity_m_s?: number;
    yaw_rate_rad_s?: number;
  };
};

export function startViewerStateLoop(
  config: RuntimeConfig,
  clients: Set<WebSocket>,
  callbacks: StateCallbacks
): ActiveLoop {
  return startViewerStateLoopWithFactory(config, clients, callbacks, createSubscriberSocket);
}

export function startViewerStateLoopWithFactory(
  config: RuntimeConfig,
  clients: Set<WebSocket>,
  callbacks: StateCallbacks,
  createSocket: SubscriberFactory
): ActiveLoop {
  const socket = createSocket();
  let closed = false;
  let socketClosed = false;

  const closeSocket = () => {
    if (socketClosed) return;
    socketClosed = true;
    socket.close();
  };

  socket.connect(config.viewerStateConnect);
  socket.subscribe();
  runViewerStateLoop(socket, clients, callbacks, () => closed)
    .catch((error: unknown) => {
      if (closed) return;
      callbacks.onError?.(error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      closeSocket();
    });

  return {
    close() {
      closed = true;
      closeSocket();
    }
  };
}

function createSubscriberSocket(): SubscriberSocket {
  return new Subscriber({ conflate: true });
}

async function runViewerStateLoop(
  socket: SubscriberSocket,
  clients: Set<WebSocket>,
  callbacks: StateCallbacks,
  isClosed: () => boolean
) {
  while (!isClosed()) {
    const [reply] = await socket.receive();
    if (isClosed()) return;
    const text = typeof reply === "string" ? reply : Buffer.from(reply).toString("utf8");
    const observation = mapViewerStateMessage(JSON.parse(text) as ViewerStateMessage);
    callbacks.onObservation?.(observation);
    broadcastObservation(observation, clients);
  }
}

export function mapViewerStateMessage(message: ViewerStateMessage): ObservationSnapshot {
  const yawRateRadS = message.kinematics?.yaw_rate_rad_s ?? 0;
  return {
    sequenceId: message.sequence_id,
    simTimeS: message.time,
    pose: {
      xM: message.pose.x_m,
      yM: message.pose.y_m,
      yawRad: message.pose.yaw_rad
    },
    lineSensorDarkness: [],
    sensorWorldPositions: [],
    yawDeg: normalizeDegrees(message.pose.yaw_rad * 180 / Math.PI),
    yawRateDegS: yawRateRadS * 180 / Math.PI,
    progressM: 0,
    remainingDistanceM: 0,
    completedEvents: [],
    simulationEvents: [],
    reachedGoal: false,
    crossTrackErrorM: 0,
    headingErrorRad: 0,
    longitudinalVelocityMS: message.kinematics?.longitudinal_velocity_m_s ?? 0,
    yawRateRadS
  };
}

function broadcastObservation(observation: ObservationSnapshot, clients: Set<WebSocket>) {
  const message = JSON.stringify({
    type: "observation",
    observation
  });
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}
