# Linux VPS Worker（M12-V 开发候选）

Windows A → HTTPS Relay → 独立 Linux Worker → 已批准 CLI → Relay → A。Relay 不执行模型。Local 不需要下列任何服务。Windows B 的接收方式不变。Windows 用户只在现有“跨设备处理”里选择 `Linux VPS` 和它发布的助手；不填写 Linux 路径或 Profile JSON。

## 首次部署：优先 Claude Code + GLM

需要 Linux x64/arm64、Docker Engine + Compose v2、域名/有效 HTTPS、至少约 1 GiB Worker 内存及构建空间。部署人员使用下列命令；普通 Windows 用户使用 GUI。先克隆并 checkout 本 PR 验证过的完整 SHA；不要在已有运行目录盲目拉取或覆盖 secrets。新 VPS 从仓库根进入 `deploy/relay`：

```sh
printf 'RELAY_DOMAIN=relay.example.com\nWORKER_DEVICE=vps-worker\nWORKER_LABEL=Linux VPS\n' > .env
export SOURCE_SHA=$(git rev-parse HEAD)
dc() { docker compose -f compose.yaml -f compose.worker.yaml "$@"; }
dc build relay worker
mkdir -p secrets worker-secrets workspace
dc run --rm --no-deps --user 0 relay node /app/relay-devices.mjs /run/shot2agent init pc-a pc-b
dc run --rm --no-deps --user 0 relay node /app/relay-devices.mjs /run/shot2agent add-worker vps-worker
sudo install -m 600 -o 1000 -g 1000 secrets/vps-worker.token worker-secrets/worker.token
sudo chown 1000:1000 worker-secrets
sudo chmod 700 worker-secrets
```

已有 Relay：备份后只做 `add-worker`，保持原 owner（默认 `personal`）和已有 pc-a/pc-b 身份。不要重跑 `init`。已有 HTTPS 反代则继续原反代，只启动 relay/worker；不要再抢占 80/443。独立 Worker 不能读取 `secrets/devices.json`，只能读取复制给它的单个 worker Token。Relay 没有额外管理 Token；完整设备注册表是部署管理材料，绝不能挂入 Worker。

通过安全管理通道在 VPS 准备 GLM key 文件，然后执行（文件内容不在命令参数中）：

```sh
sudo install -m 600 -o 1000 -g 1000 /secure/location/glm-token worker-secrets/agent-secret
dc run --rm --no-deps worker node dist/apps/cli/src/linux-worker.js discover
dc run --rm --no-deps worker node dist/apps/cli/src/linux-worker.js approve claude-compatible-endpoint /usr/local/bin/claude vps-glm
dc run --rm --no-deps worker node dist/apps/cli/src/linux-worker.js doctor
dc up -d
dc ps
dc logs --tail 30 worker
```

默认固定国内 BigModel Anthropic 端点和 `glm-5.3-flash`，三个模型别名全绑定同一模型；没有自动换模型或 Provider。国际账号可在 **approve 命令前**用 `dc run -e SHOT2AGENT_GLM_ENDPOINT=https://api.z.ai/api/anthropic ...` 明确指定。两个地区的 key 不可假定通用。批准/doctor 只执行版本、help、策略和路径检查，输出 `NO_MODEL_REQUEST`，不证明登录或识图。真实任务可能计费；只在 Windows 确认后提交。密钥不进入审批 JSON、镜像或日志。

在 A 的设置填有效 Relay HTTPS、A 的 `pc-a.token`，保存、刷新电脑。选择 `Linux VPS` 下的 `vps-glm`，新任务位置选 Remote，然后提交合成截图。A 的历史收到结果后，原有复制文本、复制文件、保存、通知和输入此结果继续使用同一结果。旧任务绑定精确版本；更改选择只影响新提交。不要重复执行结果不确定的任务。

## 程序、批准与权限

镜像固定 Claude Code 2.1.306、Codex CLI 0.164.0；版本变化需要重新构建和显式批准。`discover` 解析 npm/native 符号链接、校验实际程序与能力；Codex npm 安装绑定真正的 native ELF，非 launcher。`approve` 追加不可变版本（最多 32），保留旧任务所需的旧记录，新任务只显示每个 id 的最后版本。若升级替换旧二进制，应先清空旧队列或保留其旧绝对路径；过期批准拒绝，不迁移旧任务。批准必须在 Worker 停止后执行；共享状态锁会拒绝并行修改。

Linux 的 UID、程序 digest、路径、工作区和 credentialFile 参与指纹。不能复制 Windows Profile 或 Windows Credential Manager 数据过来。订阅 Claude 使用 **Linux 自己登录生成的** `.credentials.json` 替代 `agent-secret`，批准 provider 改成 `claude`；只接受 CLI 报告的个人 Pro/Max，托管策略存在时拒绝。Codex 使用 **Linux 自己登录生成的** `auth.json`，批准 provider 改成 `codex`；doctor 还执行 `codex sandbox linux -- /usr/bin/true`，不调用模型。Docker/内核不允许该 sandbox 时，明确报 `LINUX_CODEX_SANDBOX_UNAVAILABLE`；不得改为 danger-full-access。需要 Codex 时可在允许非特权 sandbox 的独立 Linux 用户环境运行同一入口；这项平台能力必须现场通过 doctor。

每次执行建立独立临时 HOME/认证副本、最小环境；工作区只读挂载。CLI 不继承 Relay Token、宿主 API key、Node 注入变量或个人配置。Claude 工具为空、MCP/会话持久化禁用、固定隔离 settings。CLI 的不支持版本/能力、托管配置、凭据权限不符均拒绝。GLM 不依赖 Claude 个人账号登录。

## 运行、恢复、升级与回退

服务以 UID/GID 1000 运行，无 root/privileged/Docker socket/宿主根挂载，无 Worker published port。backend 为 internal 网络，另一个 egress 网络仅供访问模型。内部 HTTP 只允许明确匹配的 `http://relay:3100/`（或显式私网 IPv4）；Windows URL 校验仍强制 HTTPS（开发 loopback 例外保留），请求不跟随重定向。不要把这个选项用于公网地址。

Worker 持久卷 `/data` 保存批准、PID/启动身份、单个待结算结果和 fencing proof；Relay 持有任务核心与历史。`/scratch` 为 256 MiB tmpfs，容器 1 CPU/1 GiB/128 PID、只读根、cap_drop ALL、no-new-privileges，日志 2×5 MiB。最大 60 MiB 输入及 base64 有内存开销；资源不足会拒绝/终止并显示明确失败或不确定状态，不自动重新请求。

```sh
dc stop worker                    # SIGTERM：停止领取，取消并确认当前进程树
dc logs --tail 40 worker
dc restart worker                 # 无需模型请求的重连；已有可能开始的任务不重跑
```

开始前先持久化 attempt reservation，再向 Relay start，最后才给 CLI 输入。CLI 进程组身份在 stdin 前 fsync；重启先核对 boot/PID/starttime 并终止遗留组，再领取。开始过却没结果的任务补交 `execution_unknown`；已有完整结果只补交结果，不执行 Agent。租约过期/陈旧 fencing 仍由既有 Relay 核心判定。状态/进程日志损坏时停止，不删除状态来“修复”。认证失败停止接收；网络中断退避重连，不切 Local。

升级前先停止 Worker 与 Relay，备份两个完整数据卷、`secrets`、`worker-secrets`、`.env` 和旧镜像 ID（私密备份，0600）；[Relay 备份步骤](README.md#一致备份与恢复)同样适用于 worker-data。保留旧卷与旧镜像，构建新 SHA，运行 doctor 后启动。失败时停新服务、恢复原镜像与对应完整卷；不要 `down -v`，不要让两份 Worker 使用同一身份并行处理。远程未确定任务仍需人工审阅，回退不是重跑许可。

轮换先 `dc stop worker`，使用 `relay-devices.mjs ... rotate vps-worker`，重新 install 新 worker.token，再启动。GLM key 原路径替换后重启即可（端点/模型/程序变化另行批准）；撤销临时 key 后停止该测试 Worker。Worker 设备 Token 只能 role=worker，使用 pc-a 或别的身份会启动拒绝。

## 可重复自动验收

从仓库根运行：

```sh
docker build -f deploy/relay/Dockerfile -t shot2agent-relay:m12-test .
docker build --build-arg SOURCE_SHA=$(git rev-parse HEAD) -f deploy/relay/Dockerfile.worker -t shot2agent-worker:m12-test .
node scripts/linux-worker-container.mjs shot2agent-worker:m12-test shot2agent-relay:m12-test
```

自动测试用独立 project/卷、临时 Token、Fake/mock CLI，包含完整回传、容器重启、SIGKILL 后不重跑、进程树、凭据/网络/资源隔离，finally 只删除自己创建的测试资源。它不使用真实账号。最小实际 VPS 与已授权真实 GLM 记录、尚未覆盖边界见 [M12 验证](../../docs/M12_V_VALIDATION.md)。
