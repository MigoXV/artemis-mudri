import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const PROTO_ROOT = path.join(REPO_ROOT, "src");
export const VEHICLE_PROTO = path.join(PROTO_ROOT, "artemis_mudri/protos/simulation/v1/vehicle_simulation.proto");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export type RuntimeConfig = {
  target: string;
  webHost: string;
  webPort: number;
  maxSpeed: number;
  accel: number;
  controlPeriodS: number;
  maxTimeS: number;
  leftKey: string;
  rightKey: string;
};

function envNumber(name: string, defaultValue: number) {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function runtimeConfig(): RuntimeConfig {
  return {
    target: process.env.ARTEMIS_MANUAL_TARGET ?? "127.0.0.1:50051",
    webHost: process.env.ARTEMIS_MANUAL_WEB_HOST ?? "127.0.0.1",
    webPort: envNumber("ARTEMIS_MANUAL_WEB_PORT", 8765),
    maxSpeed: envNumber("ARTEMIS_MANUAL_MAX_SPEED", 20),
    accel: envNumber("ARTEMIS_MANUAL_ACCEL", 80),
    controlPeriodS: envNumber("ARTEMIS_MANUAL_CONTROL_PERIOD", 0.02),
    maxTimeS: envNumber("ARTEMIS_MANUAL_MAX_TIME", 2400),
    leftKey: (process.env.ARTEMIS_MANUAL_LEFT_KEY ?? "j").trim().toLowerCase(),
    rightKey: (process.env.ARTEMIS_MANUAL_RIGHT_KEY ?? "l").trim().toLowerCase()
  };
}
