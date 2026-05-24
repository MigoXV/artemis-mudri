import type { WebSocket } from "ws";
import type { ObservationSnapshot, ServerMessage } from "../../protocol/types";
import { nextWheelTargets } from "../../vehicle/model";
import type { RuntimeConfig } from "../config";
import type { ControlState, StopFlag } from "../state";
import { loadGrpcClient } from "./client";
import { observationSnapshot } from "./observationMapper";

function broadcast(clients: Set<WebSocket>, payload: ServerMessage) {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

export function startGrpcLoop(
  config: RuntimeConfig,
  state: ControlState,
  clients: Set<WebSocket>,
  stopFlag: StopFlag,
  callbacks: {
    onObservation?: (observation: ObservationSnapshot) => void;
    onStatus?: (status: "starting" | "running" | "finished" | "error", reason?: string) => void;
  } = {}
) {
  const client = loadGrpcClient(config.target);
  const stream = client.StreamEpisode();
  let sequenceId = 0;
  let closed = false;

  const finish = (reason: string) => {
    stopFlag.stop = true;
    callbacks.onStatus?.("finished", reason);
  };

  const close = (reason = "manual_restart") => {
    if (closed) return;
    closed = true;
    stopFlag.stop = true;
    try {
      stream.write({ stop: { reason } });
      stream.end();
    } catch (error) {
      console.error(`Failed to close gRPC stream: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const queueControl = () => {
    if (closed) return;
    const nextTargets = nextWheelTargets(
      {
        left: state.leftSpeed,
        right: state.rightSpeed
      },
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
    state.leftSpeed = nextTargets.left;
    state.rightSpeed = nextTargets.right;
    stream.write({
      control_command: {
        sequence_id: sequenceId,
        rear_left_target_speed: state.leftSpeed,
        rear_right_target_speed: state.rightSpeed
      }
    });
    sequenceId += 1;
  };

  stream.on("data", (response: any) => {
    if (closed) return;
    if (response.started) {
      console.log(`Episode started time_limit=${response.started.time_limit_s} control_period=${response.started.control_period_s}`);
      callbacks.onStatus?.("running");
      return;
    }
    if (response.observation) {
      const observation = observationSnapshot(response.observation);
      callbacks.onObservation?.(observation);
      broadcast(clients, {
        type: "observation",
        observation
      });
      if (stopFlag.stop) {
        stream.write({ stop: { reason: "manual_stop" } });
      } else {
        queueControl();
      }
      return;
    }
    if (response.finished) {
      console.log(`Episode finished reason=${response.finished.reason}`);
      finish(String(response.finished.reason || "finished"));
      closed = true;
      return;
    }
    if (response.error) {
      console.error(`Simulation error: ${response.error}`);
      stopFlag.stop = true;
      callbacks.onStatus?.("error", String(response.error));
      closed = true;
      stream.end();
    }
  });

  stream.on("error", (error: Error) => {
    console.error(`gRPC stream error: ${error.message}`);
    if (!closed) {
      stopFlag.stop = true;
      callbacks.onStatus?.("error", error.message);
      closed = true;
    }
  });
  stream.on("end", () => {
    closed = true;
  });
  callbacks.onStatus?.("starting");
  stream.write({
    start: {
      max_time_s: config.maxTimeS,
      control_period_s: config.controlPeriodS
    }
  });

  return { close };
}
