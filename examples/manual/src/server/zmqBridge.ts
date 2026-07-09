import type { WebSocket } from "ws";
import { Request } from "zeromq";
import type { ObservationSnapshot, RuntimeStatus, ServerMessage, SimulationEventSnapshot } from "../protocol/types";
import { nextWheelTargets } from "../vehicle/model";
import type { RuntimeConfig } from "./config";
import type { ControlState, StopFlag } from "./state";

type ActiveLoop = {
  close: (reason?: string) => void;
};

type LoopCallbacks = {
  onObservation?: (observation: ObservationSnapshot) => void;
  onStatus?: (status: RuntimeStatus, reason?: string) => void;
};

type ZmqSocket = {
  connect: (target: string) => void;
  send: (message: string) => Promise<void>;
  receive: () => Promise<Array<Buffer | Uint8Array | string>>;
  close: () => void;
};

type ZmqRequestFactory = () => ZmqSocket;

type WireResponse =
  | {
      type: "started";
      observation: WireObservation;
    }
  | {
      type: "observation";
      observation: WireObservation;
    }
  | {
      type: "finished";
      finished: {
        reason?: string;
      };
    }
  | {
      type: "error";
      error: string;
    };

type WireObservation = {
  sequence_id: number;
  sim_time_s: number;
  pose: {
    x_m: number;
    y_m: number;
    yaw_rad: number;
  };
  line_sensor_darkness?: number[];
  line_sensor?: {
    darkness?: number[];
    world_sensor_positions?: number[][];
  };
  imu?: {
    yaw_deg?: number;
    yaw_rate_deg_s?: number;
  };
  path_progress?: {
    progress_m?: number;
    remaining_distance_m?: number;
    reached_goal?: boolean;
  };
  oracle?: {
    cross_track_error_m?: number;
    heading_error_rad?: number;
    progress_m?: number;
    remaining_distance_m?: number;
  };
  kinematics?: {
    longitudinal_velocity_m_s?: number;
    yaw_rate_rad_s?: number;
  };
  step_trace?: {
    events?: WireSimulationEvent[];
  };
};

type WireSimulationEvent = {
  event_id?: number;
  step_id?: number;
  namespace?: string;
  type?: string;
  severity?: string;
  metrics?: Record<string, number>;
  labels?: Record<string, string>;
};

export function startZmqEpisodeLoop(
  config: RuntimeConfig,
  state: ControlState,
  clients: Set<WebSocket>,
  stopFlag: StopFlag,
  callbacks: LoopCallbacks
): ActiveLoop {
  return startZmqEpisodeLoopWithFactory(config, state, clients, stopFlag, callbacks, createZmqRequestSocket);
}

export function startZmqEpisodeLoopWithFactory(
  config: RuntimeConfig,
  state: ControlState,
  clients: Set<WebSocket>,
  stopFlag: StopFlag,
  callbacks: LoopCallbacks,
  createSocket: ZmqRequestFactory
): ActiveLoop {
  const socket = createSocket();
  let closed = false;
  let closeReason = "manual_stop";

  socket.connect(config.target);
  runEpisodeLoop(socket, config, state, clients, stopFlag, callbacks, () => closed, () => closeReason)
    .catch((error: unknown) => {
      if (closed) return;
      stopFlag.stop = true;
      callbacks.onStatus?.("error", error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      socket.close();
    });

  return {
    close(reason = "manual_stop") {
      closeReason = reason;
      stopFlag.stop = true;
      closed = true;
    }
  };
}

function createZmqRequestSocket(): ZmqSocket {
  return new Request();
}

async function runEpisodeLoop(
  socket: ZmqSocket,
  config: RuntimeConfig,
  state: ControlState,
  clients: Set<WebSocket>,
  stopFlag: StopFlag,
  callbacks: LoopCallbacks,
  isClosed: () => boolean,
  closeReason: () => string
) {
  const started = await sendRequest(socket, {
    type: "start",
    max_time_s: config.maxTimeS,
    control_period_s: config.controlPeriodS
  });
  if (started.type === "error") {
    callbacks.onStatus?.("error", started.error);
    return;
  }
  if (started.type !== "started") {
    callbacks.onStatus?.("error", `Unexpected start response: ${started.type}`);
    return;
  }

  callbacks.onStatus?.("running");

  let sequenceId = started.observation.sequence_id;
  while (!stopFlag.stop && !isClosed()) {
    await sleep(Math.max(1, config.controlPeriodS * 1000));
    if (stopFlag.stop || isClosed()) break;
    const targets = nextWheelTargets(
      { left: state.leftSpeed, right: state.rightSpeed },
      {
        leftKeyPressed: state.leftKeyPressed,
        rightKeyPressed: state.rightKeyPressed
      },
      {
        accel: config.accel,
        maxSpeed: config.maxSpeed,
        dt: config.controlPeriodS
      }
    );
    state.leftSpeed = targets.left;
    state.rightSpeed = targets.right;

    const response = await sendRequest(socket, {
      type: "step",
      sequence_id: sequenceId,
      rear_left_target_speed: targets.left,
      rear_right_target_speed: targets.right
    });
    if (response.type === "error") {
      callbacks.onStatus?.("error", response.error);
      return;
    }
    if (response.type === "finished") {
      callbacks.onStatus?.("finished", response.finished.reason ?? "finished");
      return;
    }
    if (response.type !== "observation") {
      callbacks.onStatus?.("error", `Unexpected step response: ${response.type}`);
      return;
    }
    sequenceId = response.observation.sequence_id;
  }

  const response = await sendRequest(socket, { type: "stop", reason: closeReason() });
  if (response.type === "error") {
    callbacks.onStatus?.("error", response.error);
    return;
  }
  callbacks.onStatus?.("finished", response.type === "finished" ? response.finished.reason ?? closeReason() : closeReason());
}

async function sendRequest(socket: ZmqSocket, request: unknown): Promise<WireResponse> {
  await socket.send(JSON.stringify(request));
  const [reply] = await socket.receive();
  const text = typeof reply === "string" ? reply : Buffer.from(reply).toString("utf8");
  return JSON.parse(text) as WireResponse;
}

function publishObservation(
  wireObservation: WireObservation,
  clients: Set<WebSocket>,
  callbacks: LoopCallbacks
) {
  const observation = mapObservation(wireObservation);
  callbacks.onObservation?.(observation);
  const message = JSON.stringify({
    type: "observation",
    observation
  } satisfies ServerMessage);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

export function mapObservation(observation: WireObservation): ObservationSnapshot {
  const lineSensor = observation.line_sensor;
  const pathProgress = observation.path_progress;
  const oracle = observation.oracle;
  const kinematics = observation.kinematics;
  const simulationEvents = (observation.step_trace?.events ?? []).map(mapSimulationEvent);
  return {
    sequenceId: observation.sequence_id,
    simTimeS: observation.sim_time_s,
    pose: {
      xM: observation.pose.x_m,
      yM: observation.pose.y_m,
      yawRad: observation.pose.yaw_rad
    },
    lineSensorDarkness: observation.line_sensor_darkness ?? lineSensor?.darkness ?? [],
    sensorWorldPositions: (lineSensor?.world_sensor_positions ?? []).map(([x, y]) => ({ x, y })),
    yawDeg: observation.imu?.yaw_deg ?? 0,
    yawRateDegS: observation.imu?.yaw_rate_deg_s ?? 0,
    progressM: pathProgress?.progress_m ?? observation.oracle?.progress_m ?? 0,
    remainingDistanceM: pathProgress?.remaining_distance_m ?? observation.oracle?.remaining_distance_m ?? 0,
    completedEvents: simulationEvents.map((event) => event.name),
    simulationEvents,
    reachedGoal: pathProgress?.reached_goal ?? false,
    crossTrackErrorM: oracle?.cross_track_error_m ?? 0,
    headingErrorRad: oracle?.heading_error_rad ?? 0,
    longitudinalVelocityMS: kinematics?.longitudinal_velocity_m_s ?? 0,
    yawRateRadS: kinematics?.yaw_rate_rad_s ?? 0
  };
}

function mapSimulationEvent(event: WireSimulationEvent): SimulationEventSnapshot {
  const labels = event.labels ?? {};
  const type = event.type ?? "event";
  return {
    eventId: event.event_id ?? 0,
    stepId: event.step_id ?? 0,
    namespace: event.namespace ?? "simulation",
    type,
    severity: event.severity ?? "info",
    name: labels.name ?? type,
    metrics: event.metrics ?? {},
    labels
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
