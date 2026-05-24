import { useEffect, useRef } from "react";
import type { Point } from "../../geometry/types";
import type { ManualConfig, ObservationSnapshot } from "../../protocol/types";
import { drawVehicle, drawVehicleSensors } from "../../vehicle/canvas";

type SimulationCanvasProps = {
  config: ManualConfig;
  observation: ObservationSnapshot | null;
  history: Point[];
};

const FIELD_PADDING_PX = 36;

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  project: (point: Point) => Point,
  strokeStyle: string,
  lineWidth: number
) {
  if (points.length < 2) return;
  ctx.beginPath();
  const first = project(points[0]);
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const next = project(point);
    ctx.lineTo(next.x, next.y);
  }
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

export function SimulationCanvas({ config, observation, history }: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const field = config.scene.field;
    const scale = Math.min(
      (rect.width - FIELD_PADDING_PX * 2) / field.widthM,
      (rect.height - FIELD_PADDING_PX * 2) / field.heightM
    );
    const offsetX = (rect.width - field.widthM * scale) / 2;
    const offsetY = (rect.height - field.heightM * scale) / 2;
    const project = (point: Point): Point => ({
      x: offsetX + point.x * scale,
      y: offsetY + (field.heightM - point.y) * scale
    });

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const topLeft = project({ x: 0, y: field.heightM });
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#aeb8c2";
    ctx.lineWidth = 2;
    ctx.fillRect(topLeft.x, topLeft.y, field.widthM * scale, field.heightM * scale);
    ctx.strokeRect(topLeft.x, topLeft.y, field.widthM * scale, field.heightM * scale);

    for (const track of config.scene.officialTrack) {
      drawPolyline(ctx, track, project, "#14181f", 11);
    }
    drawPolyline(ctx, history, project, "#e67700", 3);

    for (const [name, point] of Object.entries(config.scene.anchors)) {
      const screen = project(point);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#1d64b7";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#17202a";
      ctx.font = "600 13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, screen.x, screen.y - 18);
    }

    if (observation) {
      drawVehicle(ctx, observation.pose, project, scale);
      drawVehicleSensors(
        ctx,
        observation.pose,
        config.vehicle.sensorLocalPositions,
        observation.lineSensorDarkness,
        project,
        scale
      );
    }
  }, [config, observation, history]);

  return <canvas className="robot-canvas" ref={canvasRef} />;
}
