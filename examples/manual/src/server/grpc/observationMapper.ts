import type { Pose } from "../../geometry/types";
import type { ObservationSnapshot } from "../../protocol/types";
import { sensorWorldPositions } from "../../vehicle/model";

function poseFromGrpc(pose: { x_m?: number; y_m?: number; yaw_rad?: number }): Pose {
  return {
    xM: Number(pose.x_m ?? 0),
    yM: Number(pose.y_m ?? 0),
    yawRad: Number(pose.yaw_rad ?? 0)
  };
}

export function observationSnapshot(observation: any): ObservationSnapshot {
  const pose = poseFromGrpc(observation.pose ?? {});
  return {
    sequenceId: Number(observation.sequence_id ?? 0),
    simTimeS: Number(observation.sim_time_s ?? 0),
    pose,
    lineSensorDarkness: (observation.line_sensor_darkness ?? []).map(Number),
    sensorWorldPositions: sensorWorldPositions(pose),
    yawDeg: Number(observation.imu?.yaw_deg ?? 0),
    yawRateDegS: Number(observation.imu?.yaw_rate_deg_s ?? 0),
    progressM: Number(observation.path_progress?.progress_m ?? 0),
    remainingDistanceM: Number(observation.path_progress?.remaining_distance_m ?? 0),
    completedEvents: observation.path_progress?.completed_events ?? [],
    reachedGoal: Boolean(observation.path_progress?.reached_goal ?? false),
    crossTrackErrorM: Number(observation.oracle?.cross_track_error_m ?? 0),
    headingErrorRad: Number(observation.oracle?.heading_error_rad ?? 0),
    longitudinalVelocityMS: Number(observation.kinematics?.longitudinal_velocity_m_s ?? 0),
    yawRateRadS: Number(observation.kinematics?.yaw_rate_rad_s ?? 0)
  };
}
