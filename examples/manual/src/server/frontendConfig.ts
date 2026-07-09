import type { ManualConfig } from "../protocol/types";
import { ANCHORS, buildOfficialTrack, buildReferencePath, FIELD_HEIGHT_M, FIELD_WIDTH_M } from "../scene/model";
import { SENSOR_LOCAL_POSITIONS } from "../vehicle/model";
import type { RuntimeConfig } from "./config";

export function buildFrontendConfig(config: RuntimeConfig): ManualConfig {
  return {
    maxSpeed: config.maxSpeed,
    accel: config.accel,
    leftKey: config.leftKey,
    rightKey: config.rightKey,
    wsUrl: `ws://${config.webHost}:${config.webPort}/ws`,
    viewerStateConnect: config.viewerStateConnect,
    scene: {
      field: {
        widthM: FIELD_WIDTH_M,
        heightM: FIELD_HEIGHT_M
      },
      anchors: ANCHORS,
      referencePath: buildReferencePath(),
      officialTrack: buildOfficialTrack()
    },
    vehicle: {
      sensorLocalPositions: SENSOR_LOCAL_POSITIONS
    }
  };
}
