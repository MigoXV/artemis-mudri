import type { RuntimeStatus } from "../protocol/types";

export type ControlState = {
  leftSpeed: number;
  rightSpeed: number;
  leftKeyPressed: boolean;
  rightKeyPressed: boolean;
};

export type StopFlag = {
  stop: boolean;
};

export type EpisodeRuntimeSnapshot = {
  status: RuntimeStatus;
  reason?: string;
};

export function resetControlState(state: ControlState) {
  state.leftKeyPressed = false;
  state.rightKeyPressed = false;
  state.leftSpeed = 0;
  state.rightSpeed = 0;
}
