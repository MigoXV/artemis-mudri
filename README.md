# Artemis MuJoCo 仿真服务

本项目提供自动行驶小车的 MuJoCo 仿真服务。主包只保留赛道、硬件观测、平面车辆推进、仿真统计和 gRPC 服务；小车固件控制器与客户端逻辑位于 sibling 项目 `../artemis-vicon`。

## 功能内容

- 根据赛场几何提供单条内置默认路线。
- 通过 gRPC 双向流发送 8 路循迹、MS901M 风格 Yaw、编码器、运动学和路径真值观测。
- 服务端接收后左/后右目标速度动作，并只负责推进仿真状态。
- 服务端按控制周期模拟执行器一阶响应、编码器累计和后双驱平面车辆运动。
- 支持无界面仿真和可选 MuJoCo 交互式查看器。
- 提供 proto 生成脚本、主包服务测试和 MuJoCo episode 测试。

## 项目结构

项目按功能模块组织，依赖方向保持为 `commands -> servicer -> simulation -> vehicle/track`：

- `artemis_mudri.commands.app`：标准 Typer CLI 入口，用于启动仿真服务。
- `artemis_mudri.servicer`：gRPC 服务和 proto 消息转换。
- `artemis_mudri.simulation`：仿真 episode、统计结果和 MuJoCo 实现。
- `artemis_mudri.vehicle`：8 路传感器、车辆状态、编码器和后双驱命令。
- `artemis_mudri.track`：赛场布局、锚点、路径采样、参考路径和默认路线。
- `artemis_mudri.protos.simulation.v1`：仿真通信协议定义及其生成的 gRPC/Protobuf 代码。

小车客户端示例和控制器已拆分到 sibling 项目 `../artemis-vicon`，本仓库不再包含客户端 examples。

## 安装

项目使用 Poetry 管理依赖和虚拟环境：

```bash
poetry install
```

## 生成 Proto 代码

```bash
bash scripts/run_grpcio_tools.sh
```

脚本会使用 Poetry 环境运行 `grpcio-tools`，并生成 `*_pb2.py`、`*_pb2.pyi`、`*_pb2_grpc.py` 和 `*_pb2_grpc.pyi`。

## 运行

启动仿真服务：

```bash
poetry run python -m artemis_mudri.commands.app serve --host 127.0.0.1 --port 50051 --no-render
```

如果需要启用现实噪声，可以通过 YAML 配置启动：

```bash
poetry run python -m artemis_mudri.commands.app serve \
  --host 127.0.0.1 \
  --port 50051 \
  --noise-config examples/configs/noise/weak.yaml
```

然后在 `../artemis-vicon` 中启动客户端，例如：

```bash
poetry run python -m artemis_vicon.commands.app --target 127.0.0.1:50051
```

## 手动目标速度 Demo

仓库内提供一个全栈 TypeScript 手动控制示例，位于 `examples/manual`。该示例包含 Node gRPC/WebSocket 后端和 React 浏览器控制台，默认使用页面内的 `j` 左转、`l` 右转，同时按住 `j` 和 `l` 直行；松开后归零，按 `q` 或 `Esc` 停止。控制台会在浏览器中绘制 2D 顶视图，包括赛场、参考轨迹、车辆位姿、车头方向、传感器位置、传感器黑度和历史轨迹。

先启动仿真服务，可按需打开 MuJoCo viewer：

```bash
poetry run python -m artemis_mudri.commands.app serve --host 127.0.0.1 --port 50051 --no-render
```

再启动手动控制台：

```bash
cd examples/manual
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动 Node 后端和 Vite 前端。浏览器打开终端输出的 Vite 地址，通常是：

```bash
http://127.0.0.1:5173
```

如果需要改 gRPC 目标或按键，可以通过环境变量配置：

```bash
ARTEMIS_MANUAL_TARGET=127.0.0.1:50051 ARTEMIS_MANUAL_LEFT_KEY=u ARTEMIS_MANUAL_RIGHT_KEY=o pnpm dev
```

生产构建检查：

```bash
pnpm run typecheck
pnpm run build
```

## 远程状态可视化 Demo

主程序支持通过 ZeroMQ PUB/SUB 额外发布 MuJoCo `qpos/qvel` 状态，`examples/remote_viewer/` 只提供本地订阅 viewer。服务器端仍由主仿真服务负责推进 episode，本地端加载主包内置的默认场景预设并用 passive viewer 渲染，适合通过 SSH 隧道在轻薄本上查看服务器仿真状态。

默认场景预设包含赛场、锚点、参考轨迹和车辆模型。渲染客户端不应自行拼装赛道或路线；如需扩展新赛道，应先在主包中增加新的场景预设，再让服务端和 viewer 同时选择该预设。

服务器上启动仿真服务，并打开状态发布端口：

```bash
poetry run python -m artemis_mudri.commands.app serve \
  --host 127.0.0.1 \
  --port 50051 \
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

viewer 默认连接 `tcp://127.0.0.1:5555`，服务端示例命令也只监听本机地址，不会监听公网端口。两端必须使用同一仓库版本和同一模型生成逻辑；`qpos/qvel` 的下标含义完全依赖 MuJoCo 模型结构。

## 配置

仿真服务常用环境变量：

- `ARTEMIS_SIM_HOST`：gRPC 服务监听地址。
- `ARTEMIS_SIM_PORT`：gRPC 服务监听端口。
- `ARTEMIS_RENDER`：是否启动 MuJoCo viewer。
- `ARTEMIS_SIM_MAX_WORKERS`：gRPC server 线程池大小。
- `ARTEMIS_NOISE_CONFIG`：噪声 YAML 配置路径。
- `ARTEMIS_VIEWER_STATE_BIND`：可选 ZeroMQ PUB 监听地址，用于发布 MuJoCo `qpos/qvel` 给远程 viewer。

客户端可在 `StartEpisodeRequest` 中传入控制周期和初始位姿；未指定时按 20ms 控制 tick 与路线默认起点运行。

## 事件协议

服务端只把路径 checkpoint 等训练事实写入新版事件流。客户端应从每帧
`ObservationFrame.step_trace.events` 读取当前 step 新触发的事件，并从
`EpisodeFinished.summary.events` 读取完整 episode 事件日志。

事件使用半结构化 `SimulationEvent` 表达：路径 checkpoint 的
`namespace` 为 `path`，`type` 为 `checkpoint`，`severity` 为
`EVENT_SEVERITY_INFO`。路径事件名称放在 `labels["name"]`，事件发生时间和路径索引分别放在
`metrics["timestamp_s"]` 与 `metrics["path_index"]`。

为保持本轮不修改 proto，`PathProgressFrame.completed_event_count` 和
`PathProgressFrame.completed_events` 字段仍存在于协议定义中，但服务端已停止填充，客户端不应再读取这些旧兼容字段。

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
