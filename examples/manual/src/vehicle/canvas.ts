import type { Point, Pose } from "../geometry/types";
import { VEHICLE_LENGTH_M, VEHICLE_WIDTH_M } from "./model";

export type ProjectPoint = (point: Point) => Point;

export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  project: ProjectPoint,
  scale: number
) {
  const center = project({ x: pose.xM, y: pose.yM });
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(-pose.yawRad);

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(
    -0.5 * VEHICLE_LENGTH_M * scale,
    -0.5 * VEHICLE_WIDTH_M * scale,
    VEHICLE_LENGTH_M * scale,
    VEHICLE_WIDTH_M * scale,
    8
  );
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#d9480f";
  ctx.beginPath();
  ctx.moveTo(0.5 * VEHICLE_LENGTH_M * scale + 10, 0);
  ctx.lineTo(0.5 * VEHICLE_LENGTH_M * scale - 8, -8);
  ctx.lineTo(0.5 * VEHICLE_LENGTH_M * scale - 8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawVehicleSensors(
  ctx: CanvasRenderingContext2D,
  sensorPositions: Point[],
  darkness: number[],
  project: ProjectPoint
) {
  for (const [index, sensor] of sensorPositions.entries()) {
    const value = Math.max(0, Math.min(1, darkness[index] ?? 0));
    const screen = project(sensor);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 4 + value * 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(31, 122, 92, ${0.25 + value * 0.75})`;
    ctx.fill();
    ctx.strokeStyle = "#145840";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
