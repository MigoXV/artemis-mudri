# Artemis Mudri ZMQ 仿真服务

本项目提供自动行驶小车的 MuJoCo 仿真服务。主链路采用 **ZeroMQ REQ/REP + JSON**：服务端接收 `start`、`step`、`stop` 请求，并返回 `started`、`observation`、`finished` 或 `error` 响应。

gRPC/Protobuf 主链路已移除。当前主包保留赛道、车辆观测、平面车辆推进、仿真统计、ZMQ JSON 服务和远程 viewer 状态发布。

## 功能内容

- 根据赛场几何提供单条内置默认路线。
- 通过 ZMQ JSON 返回 8 路循迹、IMU、编码器、运动学、路径进度和 oracle 观测。
- 服务端接收后左/后右目标速度动作，并只负责推进仿真状态。
- 支持无界面仿真和可选 MuJoCo 交互式查看器。
- 可通过额外的 ZMQ PUB/SUB 通道发布 MuJoCo `qpos/qvel` 给远程 viewer。
- 提供 Poetry CLI、主包服务测试和 MuJoCo episode 测试。

## 项目结构

项目按功能模块组织，依赖方向保持为 `commands -> transport -> api -> runtime -> simulation -> vehicle/track`：

- `artemis_mudri.commands.app`：Typer CLI 入口，用于启动 ZMQ JSON 仿真服务。
- `artemis_mudri.transport`：只负责 ZMQ JSON request/reply 收发。
- `artemis_mudri.api`：解析 JSON 请求、调用 runtime，并把结果编码为公开 JSON 响应。
- `artemis_mudri.runtime`：管理单个仿真 episode 的生命周期。
- `artemis_mudri.simulation`：仿真 episode、统计结果和 MuJoCo 实现。
- `artemis_mudri.vehicle`：8 路传感器、车辆状态、编码器和后双驱命令。
- `artemis_mudri.track`：赛场布局、锚点、路径采样、参考路径和默认路线。

## 安装

项目使用 Poetry 管理依赖和虚拟环境：

```bash
poetry install
```

## 运行

启动 ZMQ JSON 仿真服务：

```bash
poetry run python -m artemis_mudri.commands.app \
  --bind tcp://0.0.0.0:5556 \
  --viewer-state-bind tcp://0.0.0.0:5555 \
  --no-render
```

如果需要启用现实噪声，可以通过 YAML 配置启动：

```bash
poetry run python -m artemis_mudri.commands.app \
  --bind tcp://127.0.0.1:5556 \
  --noise-config examples/configs/noise/weak.yaml
```

## ZMQ JSON 协议

控制面使用 REQ/REP。客户端每发送一个 JSON 请求，服务端返回一个 JSON 响应。

### start

```json
{
  "type": "start",
  "max_time_s": 120,
  "control_period_s": 0.02,
  "initial_pose": {"x_m": 0.0, "y_m": 0.0, "yaw_rad": 0.0},
  "initial_progress_index": 0,
  "random_seed": 0
}
```

`initial_pose`、`initial_progress_index`、`random_seed` 都是可选字段。响应：

```json
{
  "type": "started",
  "started": {"time_limit_s": 120, "control_period_s": 0.02},
  "observation": {"sequence_id": 0}
}
```

### step

```json
{
  "type": "step",
  "sequence_id": 0,
  "rear_left_target_speed": 7.0,
  "rear_right_target_speed": 7.0
}
```

未到时间上限时返回：

```json
{
  "type": "observation",
  "observation": {"sequence_id": 1}
}
```

达到时间上限或 viewer 关闭时返回 `finished`。

### stop

```json
{
  "type": "stop",
  "reason": "manual_stop"
}
```

响应：

```json
{
  "type": "finished",
  "finished": {
    "reason": "manual_stop",
    "summary": {},
    "final_step_trace": {}
  }
}
```

非法请求返回：

```json
{"type": "error", "error": "错误说明"}
```

## 最小客户端示例

```python
import zmq

ctx = zmq.Context.instance()
socket = ctx.socket(zmq.REQ)
socket.connect("tcp://127.0.0.1:5556")

socket.send_json({"type": "start", "control_period_s": 0.02})
print(socket.recv_json())

socket.send_json({
    "type": "step",
    "sequence_id": 0,
    "rear_left_target_speed": 7.0,
    "rear_right_target_speed": 7.0,
})
print(socket.recv_json())

socket.send_json({"type": "stop", "reason": "demo_done"})
print(socket.recv_json())
```

## 手动控制台

`examples/manual` 提供浏览器手动控制台。它由 Node 后端通过 ZeroMQ REQ/REP 连接主仿真服务，再通过 WebSocket 把观察值推送给 React 前端。

先启动主仿真服务：

```bash
poetry run python -m artemis_mudri.commands.app serve \
  --bind tcp://0.0.0.0:5556 \
  --viewer-state-bind tcp://0.0.0.0:5555 \
  --no-render
```

再启动手动控制台：

```bash
cd examples/manual
pnpm install
pnpm dev
```

默认后端控制连接 `tcp://127.0.0.1:5556`，可通过 `ARTEMIS_MANUAL_TARGET` 指向其它 ZMQ 服务地址。画面状态默认订阅 `tcp://127.0.0.1:5555`，可通过 `ARTEMIS_MANUAL_VIEWER_STATE_CONNECT` 指向 `--viewer-state-bind` 的 PUB 地址。浏览器控制台默认使用 `J` / `L` 控制左右轮，`Q` 或 `Escape` 请求停止。

## 远程状态可视化 Demo

主程序支持通过 ZeroMQ PUB/SUB 额外发布 MuJoCo `qpos/qvel` 状态，`examples/remote_viewer/` 提供本地订阅 viewer。服务器端仍由主仿真服务负责推进 episode，本地端加载主包内置的默认场景预设并用 passive viewer 渲染。

服务器上启动仿真服务，并打开状态发布端口：

```bash
poetry run python -m artemis_mudri.commands.app serve \
  --bind tcp://127.0.0.1:5556 \
  --viewer-state-bind tcp://127.0.0.1:5555
```

本地机器打开 SSH 隧道：

```bash
ssh -N -L 5555:127.0.0.1:5555 user@server
```

本地机器运行 viewer：

```bash
poetry run python examples/remote_viewer/local_viewer.py
```

viewer 默认连接 `tcp://127.0.0.1:5555`。两端必须使用同一仓库版本和同一模型生成逻辑；`qpos/qvel` 的下标含义完全依赖 MuJoCo 模型结构。

## 配置

仿真服务常用环境变量：

- `ARTEMIS_ZMQ_BIND`：ZMQ JSON 服务监听地址，默认 `tcp://127.0.0.1:5556`。
- `ARTEMIS_RENDER`：是否启动 MuJoCo viewer。
- `ARTEMIS_NOISE_CONFIG`：噪声 YAML 配置路径。
- `ARTEMIS_VIEWER_STATE_BIND`：可选 ZeroMQ PUB 监听地址，用于发布 MuJoCo `qpos/qvel` 给远程 viewer。

### 噪声配置

仓库提供三档噪声配置：

- `examples/configs/noise/none.yaml`：关闭全部噪声。
- `examples/configs/noise/weak.yaml`：弱噪声，适合日常调试控制策略鲁棒性。
- `examples/configs/noise/strong.yaml`：强噪声，适合压力测试策略。

噪声配置覆盖初始位姿、巡线传感器、IMU、编码器和执行器。每个模块都有独立 `enabled` 开关；未通过 `--noise-config` 或 `ARTEMIS_NOISE_CONFIG` 指定 YAML 时，服务保持兼容默认行为。传入 `examples/configs/noise/none.yaml` 时会关闭全部噪声，包括旧默认的初始航向扰动。

最小配置示例：

```yaml
noise:
  preset: custom
  seed: null
  line_sensor:
    enabled: true
    darkness_std: 0.02
```

`seed: null` 表示服务端使用确定性默认 seed；需要固定某组噪声时，在 YAML 中显式设置 `seed`。

## 测试

```bash
poetry run python -m unittest discover -s tests -v
```
