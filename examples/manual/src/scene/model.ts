import type { Point } from "../geometry/types";

export const FIELD_WIDTH_M = 2.2;
export const FIELD_HEIGHT_M = 1.2;
const ARC_RADIUS_M = 0.4;
const ROUTE_RESOLUTION_M = 0.02;
const TRACK_RESOLUTION_M = 0.03;

export const ANCHORS: Record<string, Point> = {
  A: { x: 0.6, y: 1.0 },
  B: { x: 1.6, y: 1.0 },
  C: { x: 1.6, y: 0.2 },
  D: { x: 0.6, y: 0.2 }
};

const CENTERS: Record<string, Point> = {
  left_center: { x: 0.6, y: 0.6 },
  right_center: { x: 1.6, y: 0.6 }
};

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function sampleLine(start: Point, end: Point, resolution: number): Point[] {
  const steps = Math.max(1, Math.ceil(distance(start, end) / resolution));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    };
  });
}

function sampleArc(
  center: Point,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  resolution: number
): Point[] {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;
  const arcLength = Math.abs(endRad - startRad) * radius;
  const steps = Math.max(1, Math.ceil(arcLength / resolution));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const angle = startRad + (endRad - startRad) * t;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle)
    };
  });
}

function concatSegments(segments: Point[][]): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    points.push(...(points.length ? segment.slice(1) : segment));
  }
  return points;
}

export function buildReferencePath(): Point[] {
  return concatSegments([
    sampleLine(ANCHORS.A, ANCHORS.C, ROUTE_RESOLUTION_M),
    sampleArc(CENTERS.right_center, ARC_RADIUS_M, -90, 90, ROUTE_RESOLUTION_M),
    sampleLine(ANCHORS.B, ANCHORS.D, ROUTE_RESOLUTION_M),
    sampleArc(CENTERS.left_center, ARC_RADIUS_M, -90, -270, ROUTE_RESOLUTION_M)
  ]);
}

export function buildOfficialTrack(): Point[][] {
  return [
    sampleArc(CENTERS.left_center, ARC_RADIUS_M, 90, 270, TRACK_RESOLUTION_M),
    sampleArc(CENTERS.right_center, ARC_RADIUS_M, 90, -90, TRACK_RESOLUTION_M)
  ];
}
