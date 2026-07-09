import type { WebSocket } from "ws";
import type { ObservationSnapshot, RuntimeStatus, ServerMessage } from "../protocol/types";
import type { RuntimeConfig } from "./config";
import { resetControlState, type ControlState, type EpisodeRuntimeSnapshot, type StopFlag } from "./state";
import { startViewerStateLoop } from "./viewerStateBridge";
import { startZmqEpisodeLoop } from "./zmqBridge";

type ActiveLoop = {
  close: (reason?: string) => void;
};

type LoopCallbacks = {
  onObservation?: (observation: ObservationSnapshot) => void;
  onStatus?: (status: RuntimeStatus, reason?: string) => void;
};

export type StartEpisodeLoop = (
  config: RuntimeConfig,
  state: ControlState,
  clients: Set<WebSocket>,
  stopFlag: StopFlag,
  callbacks: LoopCallbacks
) => ActiveLoop;

export type StartViewerStateLoop = (
  config: RuntimeConfig,
  clients: Set<WebSocket>,
  callbacks: {
    onObservation?: (observation: ObservationSnapshot) => void;
    onError?: (reason: string) => void;
  }
) => ActiveLoop;

export class EpisodeRuntime {
  readonly clients = new Set<WebSocket>();
  readonly state: ControlState = {
    leftSpeed: 0,
    rightSpeed: 0,
    leftKeyPressed: false,
    rightKeyPressed: false
  };

  private stopFlag: StopFlag = { stop: false };
  private activeLoop: ActiveLoop | null = null;
  private stateLoop: ActiveLoop | null = null;
  private status: RuntimeStatus = "idle";
  private reason: string | undefined;
  private lastObservation: ObservationSnapshot | null = null;
  private runId = 0;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly startLoop: StartEpisodeLoop = startZmqEpisodeLoop,
    private readonly startStateLoop: StartViewerStateLoop = startViewerStateLoop
  ) {}

  snapshot(): EpisodeRuntimeSnapshot {
    return this.reason ? { status: this.status, reason: this.reason } : { status: this.status };
  }

  addClient(client: WebSocket) {
    this.clients.add(client);
  }

  removeClient(client: WebSocket) {
    this.clients.delete(client);
  }

  startViewerStateStream() {
    if (this.stateLoop !== null) return;
    this.stateLoop = this.startStateLoop(this.config, this.clients, {
      onObservation: (observation) => {
        this.lastObservation = observation;
      },
      onError: (reason) => {
        this.setStatus("error", reason);
      }
    });
  }

  restart() {
    const previousLoop = this.activeLoop;
    this.runId += 1;
    const runId = this.runId;
    previousLoop?.close("manual_restart");
    resetControlState(this.state);
    this.stopFlag = { stop: false };
    this.lastObservation = null;
    this.setStatus("starting");
    this.activeLoop = this.startLoop(this.config, this.state, this.clients, this.stopFlag, {
      onObservation: (observation) => {
        if (runId !== this.runId) return;
        this.lastObservation = observation;
      },
      onStatus: (status, reason) => {
        if (runId !== this.runId) return;
        this.setStatus(status, reason);
        if (status === "finished" || status === "error") {
          this.activeLoop = null;
        }
      }
    });
  }

  stop(reason = "manual_stop") {
    resetControlState(this.state);
    if (this.activeLoop === null) {
      this.broadcastStatus();
      return;
    }
    this.runId += 1;
    this.stopFlag.stop = true;
    this.activeLoop?.close(reason);
    this.activeLoop = null;
    this.setStatus("idle", reason);
  }

  applyControl(leftPressed: boolean, rightPressed: boolean) {
    const wantsControl = leftPressed || rightPressed;
    if (wantsControl && this.activeLoop === null && this.status !== "starting" && this.status !== "running") {
      this.restart();
    }
    if (this.status === "finished" || this.status === "error" || this.status === "idle") {
      this.broadcastStatus();
      return;
    }
    this.state.leftKeyPressed = leftPressed;
    this.state.rightKeyPressed = rightPressed;
  }

  broadcastStatus() {
    this.broadcast(this.statusMessage());
  }

  sendCurrentSnapshot(client: WebSocket) {
    client.send(JSON.stringify(this.statusMessage()));
    if (this.lastObservation) {
      client.send(JSON.stringify({
        type: "observation",
        observation: this.lastObservation
      } satisfies ServerMessage));
    }
  }

  private setStatus(status: RuntimeStatus, reason?: string) {
    if (status === "finished" || status === "error") {
      resetControlState(this.state);
    }
    this.status = status;
    this.reason = reason;
    this.broadcastStatus();
  }

  private statusMessage(): ServerMessage {
    return this.reason
      ? { type: "status", status: this.status, reason: this.reason }
      : { type: "status", status: this.status };
  }

  private broadcast(payload: ServerMessage) {
    const message = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }
}
