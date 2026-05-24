import type { Point, Pose } from "../geometry/types";
import { VEHICLE_LENGTH_M, VEHICLE_WIDTH_M } from "./model";

export type ProjectPoint = (point: Point) => Point;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

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

  const length = VEHICLE_LENGTH_M * scale;
  const width = VEHICLE_WIDTH_M * scale;
  const left = -0.5 * length;
  const right = 0.5 * length;
  const top = -0.5 * width;
  const bottom = 0.5 * width;
  const corner = Math.max(6, 0.14 * width);
  const noseInset = 0.22 * length;
  const wheelLength = 0.43 * length;
  const wheelWidth = 0.22 * width;
  const wheelX = left + 0.42 * length;
  const wheelRadius = Math.max(5, 0.45 * wheelWidth);

  ctx.shadowColor = "rgba(15, 23, 42, 0.22)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#111315";
  roundedRect(ctx, wheelX - 0.5 * wheelLength, top - wheelWidth * 0.82, wheelLength, wheelWidth, wheelRadius);
  ctx.fill();
  roundedRect(ctx, wheelX - 0.5 * wheelLength, bottom - wheelWidth * 0.18, wheelLength, wheelWidth, wheelRadius);
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = Math.max(1.2, scale * 0.005);
  roundedRect(ctx, wheelX - 0.5 * wheelLength + 3, top - wheelWidth * 0.82 + 3, wheelLength - 6, wheelWidth - 6, wheelRadius * 0.75);
  ctx.stroke();
  roundedRect(ctx, wheelX - 0.5 * wheelLength + 3, bottom - wheelWidth * 0.18 + 3, wheelLength - 6, wheelWidth - 6, wheelRadius * 0.75);
  ctx.stroke();

  ctx.fillStyle = "#111315";
  roundedRect(ctx, left - 0.13 * width, -0.19 * width, 0.12 * width, 0.38 * width, Math.max(3, 0.05 * width));
  ctx.fill();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = Math.max(1, scale * 0.003);
  roundedRect(ctx, left - 0.1 * width, -0.12 * width, 0.06 * width, 0.24 * width, Math.max(2, 0.03 * width));
  ctx.stroke();

  ctx.shadowColor = "rgba(15, 23, 42, 0.28)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#111315";
  ctx.strokeStyle = "#050607";
  ctx.lineWidth = Math.max(2, scale * 0.006);
  ctx.beginPath();
  ctx.moveTo(left + corner, top);
  ctx.lineTo(right - noseInset, top);
  ctx.quadraticCurveTo(right, top, right, 0);
  ctx.quadraticCurveTo(right, bottom, right - noseInset, bottom);
  ctx.lineTo(left + corner, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - corner);
  ctx.lineTo(left, top + corner);
  ctx.quadraticCurveTo(left, top, left + corner, top);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = "transparent";

  ctx.fillStyle = "#f8fafc";
  const screwRadius = Math.max(1.5, 0.018 * width);
  for (const screw of [
    { x: left + 0.1 * length, y: top + 0.16 * width },
    { x: right - 0.28 * length, y: top + 0.16 * width },
    { x: left + 0.1 * length, y: bottom - 0.16 * width },
    { x: right - 0.28 * length, y: bottom - 0.16 * width }
  ]) {
    ctx.beginPath();
    ctx.arc(screw.x, screw.y, screwRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(right - 0.22 * length, 0);
  ctx.lineTo(right - 0.34 * length, -0.13 * width);
  ctx.lineTo(right - 0.34 * length, 0.13 * width);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#111315";
  ctx.lineWidth = Math.max(5, 0.07 * width);
  ctx.beginPath();
  ctx.ellipse(right + 0.04 * width, 0, 0.25 * width, 0.68 * width, 0, -0.36 * Math.PI, 0.36 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = Math.max(1.2, 0.018 * width);
  ctx.beginPath();
  ctx.ellipse(right + 0.04 * width, 0, 0.25 * width, 0.68 * width, 0, -0.35 * Math.PI, 0.35 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

export function drawVehicleSensors(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  sensorLocalPositions: Point[],
  darkness: number[],
  project: ProjectPoint,
  scale: number
) {
  const cosYaw = Math.cos(pose.yawRad);
  const sinYaw = Math.sin(pose.yawRad);
  const visualForwardOffsetM = VEHICLE_LENGTH_M * 0.32;
  const radius = Math.max(1.4, Math.min(2.1, scale * 0.0048));

  for (const [index, sensor] of sensorLocalPositions.entries()) {
    const value = Math.max(0, Math.min(1, darkness[index] ?? 0));
    const visualLocal = {
      x: Math.min(sensor.x, visualForwardOffsetM),
      y: sensor.y
    };
    const world = {
      x: pose.xM + visualLocal.x * cosYaw - visualLocal.y * sinYaw,
      y: pose.yM + visualLocal.x * sinYaw + visualLocal.y * cosYaw
    };
    const screen = project(world);
    const channel = Math.round(168 + value * 87);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${channel}, ${channel}, ${channel})`;
    ctx.fill();
    ctx.strokeStyle = value > 0.55 ? "#ffffff" : "#8c949e";
    ctx.lineWidth = value > 0.55 ? 1.1 : 0.7;
    ctx.stroke();
  }
}
