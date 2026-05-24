import { useCallback, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { SimulationCanvas } from "./components/SimulationCanvas";
import { useDriveInput } from "./hooks/useDriveInput";
import { useManualConfig } from "./hooks/useManualConfig";
import { useManualSocket } from "./hooks/useManualSocket";
import type { Point } from "../geometry/types";
import type { ObservationSnapshot } from "../protocol/types";

const MAX_HISTORY_POINTS = 500;

export default function App() {
  const { config, status, setStatus } = useManualConfig();
  const [observation, setObservation] = useState<ObservationSnapshot | null>(null);
  const [history, setHistory] = useState<Point[]>([]);

  const handleObservation = useCallback((nextObservation: ObservationSnapshot) => {
    setObservation(nextObservation);
    setHistory((current) => {
      const next = [...current, { x: nextObservation.pose.xM, y: nextObservation.pose.yM }];
      return next.slice(Math.max(0, next.length - MAX_HISTORY_POINTS));
    });
  }, []);

  const { sendControl, requestStop } = useManualSocket({
    config,
    onObservation: handleObservation,
    onStatus: setStatus
  });
  const { controlPressed, setPressedKey, targets } = useDriveInput({
    config,
    requestStop,
    sendControl
  });

  if (!config) {
    return <main className="app-shell"><div className="loading">{status}</div></main>;
  }

  return (
    <main className="app-shell">
      <section className="viewer-surface">
        <SimulationCanvas config={config} observation={observation} history={history} />
      </section>
      <ControlPanel
        config={config}
        controlPressed={controlPressed}
        observation={observation}
        setPressedKey={setPressedKey}
        status={status}
        targets={targets}
      />
    </main>
  );
}
