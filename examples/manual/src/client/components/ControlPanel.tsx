import type { ManualConfig, ObservationSnapshot } from "../../protocol/types";
import type { WheelTargets } from "../../vehicle/model";

type ControlPanelProps = {
  config: ManualConfig;
  status: string;
  controlPressed: {
    left: boolean;
    right: boolean;
  };
  targets: WheelTargets;
  observation: ObservationSnapshot | null;
  setPressedKey: (key: string, value: boolean) => void;
};

function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export function ControlPanel({
  config,
  status,
  controlPressed,
  targets,
  observation,
  setPressedKey
}: ControlPanelProps) {
  return (
    <aside className="control-panel">
      <header>
        <h1>Artemis 手动操控台</h1>
        <div className="status-line">{status}</div>
      </header>
      <div className="drive-buttons">
        <button
          className={controlPressed.left ? "active" : ""}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setPressedKey(config.leftKey, true);
          }}
          onPointerUp={() => setPressedKey(config.leftKey, false)}
          onPointerCancel={() => setPressedKey(config.leftKey, false)}
        >
          <span>左转</span>
          <strong>{config.leftKey.toUpperCase()}</strong>
        </button>
        <button
          className={controlPressed.right ? "active" : ""}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setPressedKey(config.rightKey, true);
          }}
          onPointerUp={() => setPressedKey(config.rightKey, false)}
          onPointerCancel={() => setPressedKey(config.rightKey, false)}
        >
          <span>右转</span>
          <strong>{config.rightKey.toUpperCase()}</strong>
        </button>
      </div>
      <div className="meter">
        <span>左轮目标</span>
        <progress value={targets.left} max={config.maxSpeed} />
        <strong>{formatNumber(targets.left)}</strong>
      </div>
      <div className="meter">
        <span>右轮目标</span>
        <progress value={targets.right} max={config.maxSpeed} />
        <strong>{formatNumber(targets.right)}</strong>
      </div>
      <div className="telemetry-grid">
        <div><span>时间</span><strong>{formatNumber(observation?.simTimeS ?? 0)} s</strong></div>
        <div><span>航向</span><strong>{formatNumber(observation?.yawDeg ?? 0, 1)}°</strong></div>
        <div><span>进度</span><strong>{formatNumber(observation?.progressM ?? 0)} m</strong></div>
        <div><span>剩余</span><strong>{formatNumber(observation?.remainingDistanceM ?? 0)} m</strong></div>
        <div><span>横向误差</span><strong>{formatNumber(observation?.crossTrackErrorM ?? 0, 3)} m</strong></div>
        <div><span>纵向速度</span><strong>{formatNumber(observation?.longitudinalVelocityMS ?? 0, 3)} m/s</strong></div>
      </div>
    </aside>
  );
}
