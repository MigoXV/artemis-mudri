import { useEffect, useState } from "react";
import type { ManualConfig } from "../../protocol/types";

async function loadConfig(): Promise<ManualConfig> {
  const response = await fetch("/config.json");
  if (!response.ok) {
    throw new Error(`配置加载失败：${response.status}`);
  }
  return response.json() as Promise<ManualConfig>;
}

export function useManualConfig() {
  const [config, setConfig] = useState<ManualConfig | null>(null);
  const [status, setStatus] = useState("正在加载控制配置...");

  useEffect(() => {
    loadConfig()
      .then((loaded) => {
        setConfig(loaded);
        setStatus(`页面获得焦点后，按住 ${loaded.leftKey.toUpperCase()} / ${loaded.rightKey.toUpperCase()} 或按住按钮控制速度。`);
      })
      .catch((error) => setStatus(String(error)));
  }, []);

  return { config, status, setStatus };
}
