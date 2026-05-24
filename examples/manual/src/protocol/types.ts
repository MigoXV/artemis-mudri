import type { Point, Pose } from "../geometry/types";

export type ManualConfig = {
  maxSpeed: number;
  accel: number;
  leftKey: string;
  rightKey: string;
  wsUrl: string;
  scene: {
    field: {
      widthM: number;
      heightM: number;
    };
    anchors: Record<string, Point>;
    referencePath: Point[];
    officialTrack: Point[][];
  };
  vehicle: {
    sensorLocalPositions: Point[];
  };
};

export type ObservationSnapshot = {
  sequenceId: number;
  simTimeS: number;
  pose: Pose;
  lineSensorDarkness: number[];
  sensorWorldPositions: Point[];
  yawDeg: number;
  yawRateDegS: number;
  progressM: number;
  remainingDistanceM: number;
  completedEvents: string[];
  reachedGoal: boolean;
  crossTrackErrorM: number;
  headingErrorRad: number;
  longitudinalVelocityMS: number;
  yawRateRadS: number;
};

export type ClientMessage =
  | {
      type: "control";
      leftPressed: boolean;
      rightPressed: boolean;
    }
  | {
      type: "stop";
    };

export type ServerMessage = {
  type: "observation";
  observation: ObservationSnapshot;
};
