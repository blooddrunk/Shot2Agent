# M12-V 验证记录

基线：2026-10-24 `git status` 干净，`git fetch origin --prune` 后 `origin/main=2c7f5ce6a15ad23f909e1f08ebf4a18c694c9567`，open PR 为空，#27 已合并。分支 `codex/m12-linux-worker`；候选 `1.1.0-dev.6`，不修改历史 Release/Tag，不正式发布 v1.1.0。

## 自动化与来源身份

首个全部适用 PR CI 通过的源码为 `4bd6d879114b1f50e4fa599288a03cf365b9c978`：[Node/GUI/两个 Compose 工作流](https://github.com/blooddrunk/Shot2Agent/actions/runs/40104642193)、[Windows Rust/native/ZIP/EXE](https://github.com/blooddrunk/Shot2Agent/actions/runs/40104642088)，均 SUCCESS。此后新增了 Linux 原生 CLI 对 loopback Mock 的独立 gate，以及 Linux GLM SDK 显式零重试；最终 HEAD 的新 gate 结果与 Artifact 身份在 [PR #28](https://github.com/blooddrunk/Shot2Agent/pull/28) 的最终交付记录核对，不能把旧 Artifact 冒称为新 HEAD。工作树与精确提交阶段分别执行：

| 命令 / 环境 | 实际结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile`，Windows Node v24.22.1 / pnpm 10.19.0 | exit 0，锁文件未变。 |
| `npm run check`，Windows | exit 0，283 tests / 274 PASS / 9 SKIPPED / 0 FAIL；lint、TS/Vue、编译、无 Relay Local smoke、合成 Gateway resource smoke PASS。后续最终代码重新执行。 |
| `npm run desktop:test-ui`，Windows | exit 0，40/40；后续新增 Linux VPS/GLM selector 断言需最终复验。 |
| `docker run ... node --experimental-strip-types --test packages/worker/test/linux.test.mjs`，VPS 非 root Debian Node 24 容器 | exit 0，7/7；版本/批准、4 MiB+ 多图、最小环境、进程取消/超时/异常/父进程退出后子进程清理、SQLite lock、fencing/重复补交/不重跑、残留进程恢复、损坏状态拒绝、桌面 controller→HTTP Relay→真实 Linux daemon→来源历史，以及 Windows Worker 兼容。 |
| 最终工作树 `npm run check` + `npm run desktop:test-ui` | Windows exit 0，284 tests / 274 PASS / 10 SKIPPED / 0 FAIL；Vue 40/40，包含 Linux VPS/GLM 的普通设备选择。当前后续 source-only 验证以 PR 最新 CI 为准。 |
| `4bd6d87` VPS `node --experimental-strip-types --test packages/local/test/codex-discovery.test.mjs packages/local/test/m5.test.mjs packages/worker/test/linux.test.mjs`（镜像内） | exit 0，47 tests / 30 PASS / 17 平台 SKIPPED；其中 Linux 专项 8/8。 |
| `4bd6d87` VPS `node scripts/linux-worker-container.mjs shot2agent-worker:4bd6d87 shot2agent-relay:437e62f` | exit 0，Fake restart、mock GLM 五图、SIGKILL 后 unknown、一次执行/attempt、独立 Token/卷/无端口/资源边界全部 PASS。两个镜像来源单独记录，不冒称 Relay 从新源码重新构建。 |
| 实际 Linux Claude Code 2.1.306 → loopback Mock，`docker run --rm --network none ... node /app/probe.mjs /usr/local/bin/claude success` 与 `refusal` | 各 exit 0；原生 CLI 收发真实 base64 图像与 Markdown marker；success exitCode=0、refusal exitCode=1，均 exactly 1 message request；`refusal` Mock 返回 500 且零重试。外层 probe exit 0 表示断言通过。全部使用合成 Token、无外部网络或付费模型。 |

测试只使用临时设备 Token、合成图片及 Fake/mock。已授权的真实 GLM 测试独立记录；Fake 不作为真实 provider 通过。M11-X 操作员报告的 A/B/C PASS 保留且不重复完整清单。

## 实际发现与修复

- 初次 lint 对标签控制字符正则报错，改用逐字符判断后 PASS。
- Linux 进程测试首轮 6/7：mock 的 orphan 场景没有 unref 子进程，父进程实际没有退出。修正 fixture 后 7/7，真实成功父进程退出后的存活子进程由生产 process-group barrier 清理。
- Compose 首轮 Worker 发现超时；镜像 `/data` 的初始 0755 不满足私有根 0700 合约，已改镜像权限；未降低生产校验。测试失败时新增有限服务日志采集，后续复验另记。
- Compose Worker-side probe 初次误读只有 Relay 才挂载的 devices.json 而 FAIL；按 action 拆开测试初始化，Worker 始终没有注册表挂载。之后 CI 功能断言全 PASS，但 host runner uid=1001 无法删除已改属容器 uid=1000 的私有目录。finally 现在只在自身 mkdtemp bind 内恢复 host uid/gid，再清理；`4bd6d87` Compose CI SUCCESS。
- `437e62f` Linux CI 发现 Local 原有 symlink/网络路径拒绝与脚本 fixture 受到新发现逻辑影响。增加显式 `resolveLinuxProgram`/`discover(...,{linux:true})` 入口；旧 `resolveProgram` 合约完全恢复，Local 全套与 Linux 专项在 `4bd6d87` PASS。未修改旧测试来掩盖语义改变。
- 首个真实 GLM 任务没有在 84s CLI 预算内完成，返回 `execution_unknown / CLAUDE_INTERRUPTED`。未自动重跑。随后非生成请求确认国内端点拒绝临时 key（401）；详情及 provider 边界见下节。后续 Linux GLM 显式设 `CLAUDE_CODE_MAX_RETRIES=0` 与 `CLAUDE_CODE_NONSTREAMING_TIMEOUT_RETRIES=0`，用实际 CLI loopback Mock 500 测试验证不重发，不更改 Windows 行为。

## 覆盖映射

| 要求 | 自动化 |
| --- | --- |
| 注册/发现/批准和设备绑定 | Linux approval + daemon integration；真实 Vue picker 增加 Linux VPS/GLM 独立设备，保留 Windows 设备/历史版本隐藏。 |
| Windows 来源→Relay→Linux→来源 | DesktopController、RemoteQueue/outbox、实际 HTTP Relay、独立 Linux 子进程；既有交付/history tests。 |
| 多图/大图 | 五图按序，单张随机 PNG >4 MiB；真实图像解码与 hash。 |
| 重复领取/结果/幂等 | 既有 Core/Relay tests + durable port lost-ack fixture；结果重交不重新执行。 |
| 断网/离线/重启/崩溃 | 原 Remote outbox 故障套件；Linux 离线排队/daemon 重启；Compose SIGKILL，持久状态恢复。 |
| 已开始不确定执行不重跑 | 现有租约恢复 + Linux start reservation journal + crash test，检查一次 attempt/一次 CLI 执行。 |
| 取消/超时/异常/子进程 | Linux 真实 detached group；TERM/KILL、正常根退出遗留后代；Windows 原 Job/taskkill gates。 |
| Token/设备/批准/非法配置 | 身份固定 owner/device/role、拒绝过期 digest、uid 和 workspace、secret mode、重叠目录、shell、internal URL 公网例外；原有目标/hash/Token tests。 |
| 文件/凭据隔离 | 私有 Linux HOME、mounted secret、只读工作区、独立状态/scratch、无宿主 key/Token 继承；原有 corruption/partial-write/history cleanup。 |
| Windows/Local/原生回归 | 原 check + UI + Windows Node 22/24、Rust、hosted WGC/Typing、compiled helpers、ZIP manifest/EXE/clipboard/notification gates。物理已接受路径不冒称重新观察。 |

## 最小真实 VPS 观察（无需模型额度）

环境：专用临时 Compose project/卷和合成 Token；使用当前 SHA 镜像，勿连接用户历史。按 [部署指南](../deploy/relay/WORKER.md)构建；`node scripts/linux-worker-container.mjs ...` 即可复现本次隔离 VPS 实测。它准备 Fake 任务后重启 Worker并验证结果，再用 mock GLM 在真实运行期间 SIGKILL Worker，重启后必须显示 execution_unknown，只有一个 attempt、总计一次该 CLI 执行。所有服务均不得新增 Worker 宿主端口。

PASS：脚本 exit 0、打印每项 PASS、最终隔离/恢复 PASS。FAIL：非零、重复执行/错误结果/超时；脚本采集最后 30 行有限服务日志并清理自身 project/卷。网络恢复只重交结果，不“重试 Agent”。边界：这是真实 VPS/Docker/Fake 与 mock 故障证明，未证明实际 Windows 物理 GUI、真实公网 TLS 或 provider 图像能力。

Linux CLI 本机发现/启动：`dc stop worker` → `dc run --rm --no-deps worker node dist/apps/cli/src/linux-worker.js discover` → `... doctor`。预期精确 CLI 版本、批准绑定有效、`PASS_STARTUP_ONLY_NO_MODEL_REQUEST`，不创建任务、不请求模型。FAIL：非零或 unsupported/auth/policy/sandbox 拒绝；保持 Worker 停止，修正明确配置/权限/版本后重新批准。不删除旧队列或降级 sandbox。Codex 需在目标内核支持其非特权 sandbox；这项 doctor PASS 不等于真实 Codex 请求 PASS。

## 新增 Windows→Linux 物理选择的最小补充（仅未观察部分）

前置：最终完整候选 ZIP，BUILD/MANIFEST SHA 与 PR CI 对应；专用 Fake VPS Worker/HTTPS Relay和临时 A Token。在 Windows 完整解压后打开 `Start Remote acceptance.cmd`，不添加真实 Agent。

1. 设置→跨设备处理，填该 HTTPS 与临时 A Token，保存、刷新；选择 `Linux VPS` 的 Fake，位置改 Remote。PASS：名称/Agent 正常显示，无 Linux 路径/JSON 配置；其他 Windows 设备仍可见。
2. 从 ZIP 添加一张 Remote synthetic PNG，确认提交；PASS：只有一条历史、处理后可复制文本/输入此结果，结果来自选定 VPS。源端历史显示成功不能替代目标文本实际观察。
3. 若失败，先恢复网络/服务并同步原 taskId，不重复提交未知执行。结束在 GUI 删除临时 Token、托盘退出，只清理隔离数据/测试设备。未改变的 M11-X A/B/C 无需重跑；其他 IME/显示器/客户端网络仍未覆盖。

## 真实 provider / 发布边界

用户额外授权临时 key、Claude Code + `glm-5.3-flash` 的必要合成测试。已执行一个新任务/一个 attempt：Windows 本机 Node/DesktopController → `https://relay.haoqi90.top/`（正常证书校验）→ Nosla Linux 非 root Worker → 原生 Claude 2.1.306 → 原 Windows durable history；Task `20816c17-355b-4092-ab98-f2a3a14e6241` 返回 `execution_unknown / CLAUDE_INTERRUPTED`，markerRecognized=false。没有重跑原任务；CLI 内部 HTTP 请求次数不能由一个 attempt 推断。

VPS Debian 13 / Docker 29.5.1 / Compose v5.1.3，Worker image `shot2agent-worker:4bd6d87`，OCI revision 完整 `4bd6d879114b1f50e4fa599288a03cf365b9c978`。实际发现 Codex 0.164.0 与 Claude 2.1.306（均 unverified_auth），GLM Profile 显式批准和 doctor PASS_STARTUP_ONLY_NO_MODEL_REQUEST，单独设备 `nosla-linux`、名称 `Nosla Linux VPS`、无 published port，旧 Relay/反代保持原版本与配置。

失败后完成无需生成的连通性检查：宿主 HEAD 155ms / 401，容器无认证 HEAD 160ms / 401，带临时 key 的 HEAD 与空 messages POST 也为 401。说明网络/TLS可达、该端点未接受提供的认证；不猜测 key 实际归属，不发送到其他服务。已询问操作员端点，Worker 停止接收，结果仍明确不确定。国内端点来自既有批准默认和 [官方 GLM Claude 配置](https://docs.bigmodel.cn/cn/coding-plan/tool/claude)，不同产品/地区 key 不通用。真实识图 **FAIL/未资格通过**，不能用 Mock 替代。若更正 key/端点，只能明确创建新的合成测试任务，原 unknown 保留；不会自动重试。

Codex 无模型 sandbox 本机检查在本 VPS 默认受限容器明确失败：`bwrap: No permissions to create new namespace`；没有加 privileged、开放宿主权限或降级 sandbox。该容器 **不具备 Codex 执行资格**，代码会拒绝。Codex 的版本/图片 flags 发现 PASS 不能替代 sandbox/provider PASS。真实 Codex 与 Claude 订阅模型未执行付费调用，NOT VERIFIED。没有 formal v1.1.0 发布。
