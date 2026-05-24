import type { Point, Pose } from "../geometry/types";

export type WheelTargets = {
  left: number;
  right: number;
};

export type ManualInputState = {
  leftKeyPressed: boolean;
  rightKeyPressed: boolean;
};

export type ManualControlConfig = {
  accel: number;
  maxSpeed: number;
  dt: number;
};

export const VEHICLE_LENGTH_M = 0.18;
export const VEHICLE_WIDTH_M = 0.11;

export const SENSOR_LOCAL_POSITIONS: Point[] = [
  { x: 0.085, y: 0.04 },
  { x: 0.085, y: 0.03 },
  { x: 0.085, y: 0.02 },
  { x: 0.085, y: 0.01 },
  { x: 0.085, y: -0.01 },
  { x: 0.085, y: -0.02 },
  { x: 0.085, y: -0.03 },
  { x: 0.085, y: -0.04 }
];

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

export function nextWheelTargets(
  current: WheelTargets,
  input: ManualInputState,
  config: ManualControlConfig
): WheelTargets {
  if (input.leftKeyPressed && input.rightKeyPressed) {
    const speed = clamp(Math.max(current.left, current.right) + config.accel * config.dt, config.maxSpeed);
    return { left: speed, right: speed };
  }
  if (input.leftKeyPressed) {
    return {
      left: 0,
      right: clamp(current.right + config.accel * config.dt, config.maxSpeed)
    };
  }
  if (input.rightKeyPressed) {
    return {
      left: clamp(current.left + config.accel * config.dt, config.maxSpeed),
      right: 0
    };
  }
  return { left: 0, right: 0 };
}

export function sensorWorldPositions(pose: Pose, sensorLocalPositions: Point[] = SENSOR_LOCAL_POSITIONS): Point[] {
  const cosYaw = Math.cos(pose.yawRad);
  const sinYaw = Math.sin(pose.yawRad);
  return sensorLocalPositions.map((sensor) => ({
    x: pose.xM + sensor.x * cosYaw - sensor.y * sinYaw,
    y: pose.yM + sensor.x * sinYaw + sensor.y * cosYaw
  }));
}
