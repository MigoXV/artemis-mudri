import { useCallback, useEffect, useState } from "react";
import { DriveControls, TelemetryPanel } from "./components/ControlPanel";
import { SimulationCanvas } from "./components/SimulationCanvas";
import { useDriveInput } from "./hooks/useDriveInput";
import { useManualConfig } from "./hooks/useManualConfig";
import { useManualSocket } from "./hooks/useManualSocket";
import type { Point } from "../geometry/types";
import type { ObservationSnapshot, RuntimeStatus, SimulationEventSnapshot } from "../protocol/types";
import type { WheelTargets } from "../vehicle/model";

const MAX_HISTORY_POINTS = 500;
const MAX_ACTIVITY_ITEMS = 20;
const MAX_SIMULATION_EVENT_ITEMS = 20;

type ActivityLogEntry = {
  id: number;
  time: string;
  message: string;
};

type SimulationEventLogEntry = SimulationEventSnapshot & {
  id: string;
  simTimeS: number;
  sequenceId: number;
};

function commandLabel(controlPressed: { left: boolean; right: boolean }) {
  if (controlPressed.left && controlPressed.right) return "前进";
  if (controlPressed.left) return "左转";
  if (controlPressed.right) return "右转";
  return "停止";
}

function runtimeLabel(runtimeStatus: RuntimeStatus) {
  if (runtimeStatus === "idle") return "监视中";
  if (runtimeStatus === "starting") return "正在连接";
  if (runtimeStatus === "running") return "手动控制中";
  if (runtimeStatus === "finished") return "手动控制已结束";
  return "数据异常";
}

function connectionLabel(status: string, observation: ObservationSnapshot | null) {
  if (status.includes("断开") || status.includes("错误")) return "连接异常";
  if (status.includes("连接") || observation) return "数据已连接";
  return "等待数据";
}

function formatWheelTargets(targets: WheelTargets) {
  return `${targets.left.toFixed(2)} / ${targets.right.toFixed(2)}`;
}

export default function App() {
  const { config, status, setStatus } = useManualConfig();
  const [observation, setObservation] = useState<ObservationSnapshot | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("idle");
  const [simulationEventLog, setSimulationEventLog] = useState<SimulationEventLogEntry[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>(() => [{
    id: Date.now(),
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    message: "正在加载手动控制台配置"
  }]);

  const appendActivity = useCallback((message: string) => {
    const now = Date.now();
    setActivityLog((current) => {
      if (current[0]?.message === message) return current;
      const next = [{
        id: now,
        time: new Date(now).toLocaleTimeString("zh-CN", { hour12: false }),
        message
      }, ...current];
      return next.slice(0, MAX_ACTIVITY_ITEMS);
    });
  }, []);

  useEffect(() => {
    if (!config) return;
    appendActivity(`控制台配置已加载：${config.wsUrl}`);
  }, [appendActivity, config]);

  const handleObservation = useCallback((nextObservation: ObservationSnapshot) => {
    setObservation(nextObservation);
    setHistory((current) => {
      const next = [...current, { x: nextObservation.pose.xM, y: nextObservation.pose.yM }];
      return next.slice(Math.max(0, next.length - MAX_HISTORY_POINTS));
    });
    if (nextObservation.simulationEvents.length > 0) {
      setSimulationEventLog((current) => {
        const known = new Set(current.map((event) => event.id));
        const incoming = nextObservation.simulationEvents
          .map((event, index) => ({
            ...event,
            id: `${event.eventId || "event"}:${nextObservation.sequenceId}:${index}:${event.name}`,
            simTimeS: nextObservation.simTimeS,
            sequenceId: nextObservation.sequenceId
          }))
          .filter((event) => !known.has(event.id));
        if (incoming.length === 0) return current;
        return [...incoming.reverse(), ...current].slice(0, MAX_SIMULATION_EVENT_ITEMS);
      });
    }
  }, []);

  const handleRuntimeStatus = useCallback((runtimeStatus: RuntimeStatus, reason?: string) => {
    setRuntimeStatus(runtimeStatus);
    if (runtimeStatus === "idle") {
      setStatus(reason ? `手动控制已释放：${reason}。继续订阅状态流。` : "正在订阅状态流；按控制键接管手动控制。");
      return;
    }
    if (runtimeStatus === "starting") {
      setObservation(null);
      setHistory([]);
      setSimulationEventLog([]);
      setStatus("正在接管手动控制并启动新的仿真 episode...");
      return;
    }
    if (runtimeStatus === "running") {
      setStatus("手动控制中，按住控制键或按钮控制小车。");
      return;
    }
    if (runtimeStatus === "finished") {
      setStatus(`手动控制已结束：${reason ?? "finished"}。按控制键可重新接管。`);
      return;
    }
    setStatus(`数据或控制连接错误：${reason ?? "unknown_error"}。`);
  }, [setStatus]);

  const { sendControl, requestStop } = useManualSocket({
    config,
    onObservation: handleObservation,
    onRuntimeStatus: handleRuntimeStatus,
    onStatus: setStatus,
    onActivity: appendActivity
  });
  const canControl = runtimeStatus === "idle" || runtimeStatus === "running" || runtimeStatus === "finished";
  const { controlPressed, feedback, setPressedKey, targets } = useDriveInput({
    config,
    enabled: canControl,
    onActivity: appendActivity,
    requestStop,
    sendControl
  });
  const statusDotClassName = `status-dot is-${runtimeStatus}`;
  const command = commandLabel(controlPressed);
  const controlActive = controlPressed.left || controlPressed.right;
  const inputLabel = feedback.source === "keyboard" ? "键盘" : feedback.source === "button" ? "按钮" : "已释放";

  if (!config) {
    return <main className="manual-workbench"><div className="loading">{status}</div></main>;
  }

  return (
    <main className="manual-workbench">
      <header className="manual-topbar">
        <div className="manual-title-block">
          <span className="manual-kicker">Artemis Mudri</span>
          <h1>手动操控台</h1>
        </div>
        <div className="manual-status-line">
          <span><i className={statusDotClassName} aria-hidden="true" />{runtimeLabel(runtimeStatus)}</span>
          <span>{connectionLabel(status, observation)}</span>
          <span>{controlActive ? `${inputLabel}接管` : "控制已释放"}</span>
          <span>{observation ? `${observation.simTimeS.toFixed(2)} s` : "--"}</span>
        </div>
      </header>

      <div className="manual-body">
        <section className="manual-main-pane">
          <div className="pane-header">
            <div>
              <h2>赛道视图</h2>
              <p>{observation ? "按真实轨迹比例适配当前视口" : "等待仿真观察值"}</p>
            </div>
          </div>
          <div className="viewer-surface">
            <SimulationCanvas config={config} observation={observation} history={history} />
            <div className="current-command-hud">
              <span>当前指令 <strong>{command}</strong></span>
              <span>输入 <strong>{inputLabel}</strong></span>
              <span>轮速 <strong>{formatWheelTargets(targets)}</strong></span>
            </div>
          </div>
        </section>
        <TelemetryPanel
          activityLog={activityLog}
          observation={observation}
          runtimeStatus={runtimeStatus}
          simulationEventLog={simulationEventLog}
        />
      </div>

      <DriveControls
        config={config}
        controlPressed={controlPressed}
        disabled={!canControl}
        disabledReason={canControl ? undefined : runtimeLabel(runtimeStatus)}
        requestStop={requestStop}
        setPressedKey={setPressedKey}
        targets={targets}
      />
    </main>
  );
}
