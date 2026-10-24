# M10-R 验证记录

状态：M10 功能候选已实现，1.1.0-dev.1；自动化门禁通过。真实双机公网验收仍 NOT VERIFIED，不构成正式 Remote 发布。

基线：2026-10-24 fetch 后 `origin/main=5f0f7ab8e8d4f3cd30aa2b7351fa19aa499e11cb`，工作区原先干净。最新正式 Release 为 v1.0.2；PR #24 已合并，规划 PR #25（2815eaec8af9aef68b2c8e6727a4b82d45cf6a3f）仍开放。已读取其 M10-R R01–R10 规划；此实现不修改发布请求、旧 Tag/Release 或展开 M11。

## 已通过的候选身份与门禁

候选功能/测试源码为 `f777d00537501061769dd22f72fa0dfce19da50f`（[PR #26](https://github.com/blooddrunk/Shot2Agent/pull/26)）。本段后续收尾只更新验证记录和包内说明，不改变应用 runtime；最终 PR HEAD 的 CI/ZIP 身份另行报告于交付信息。PR CI checkout 使用合并测试提交，不能把包中的 SHA 冒称为分支 HEAD。

| 实际命令/门禁 | 状态 | 精确结果与证据 |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile` | PASS | 本机 `CI=true` 退出 0，pnpm 10.19.0 / Node v24.22.1；锁文件未改。所有 CI 同样冻结安装。 |
| `npm run check` | PASS | 本机 f777d00：退出 0，255 tests / 252 PASS / 3 SKIPPED / 0 FAIL；lint、TS/Vue、JS/UI 构建与 compiled Local/Gateway-resource smoke 均 PASS。 |
| `npm run desktop:test-ui` | PASS | 本机完整 31/31，退出 0；f777d00 CI 同样 31/31。Remote 的 1040/720/480px 实际 Vue 操作及截图均已检查。 |
| `node --experimental-strip-types --test packages/desktop/test/remote.test.mjs packages/core/test/relay-deploy.test.mjs` | PASS | 退出 0，14/14：13 个 Remote 故障/闭环测试及 1 个设备注册表回归。 |
| `node --experimental-strip-types --test packages/local/test/codex-discovery.test.mjs` | PASS | 本机退出 0，6/6；目录去重与扫描预算分开，生产的 5 秒预算保留。 |
| Windows/Linux × Node 22/24 `npm run check` | PASS | [40067540826](https://github.com/blooddrunk/Shot2Agent/actions/runs/40067540826)，所有 job SUCCESS。每个平台 255 tests；Windows 253 PASS/2 SKIPPED，Linux 224 PASS/31 SKIPPED；无 FAIL。平台专用 SKIPPED 不冒称执行。 |
| Docker build + `node scripts/relay-container.mjs shot2agent-relay:m10-test` | PASS | 同一 [40067540826](https://github.com/blooddrunk/Shot2Agent/actions/runs/40067540826) 的独立 Ubuntu job：镜像构建、Caddy 配置校验、Compose 私有卷启动/去重/重启/claim/完整结果和文件下载、匿名拒绝、热轮换、备份恢复全部退出 0；Relay 无 published port。 |
| `npm run desktop:build`、Rust fmt/test、`npm run desktop:package`、packaged/extracted EXE smoke | PASS | [40067540865](https://github.com/blooddrunk/Shot2Agent/actions/runs/40067540865)：8/8 Rust；原生下载标记 helper、Credential Manager、文件剪贴板/cache、IPC/refusal/quit/descendant cleanup、tray API 和完整提取验证均退出 0。API smoke 不等于可见通知/Explorer 粘贴。 |
| 本机 Docker / cargo | SKIPPED | 未安装；由上述真实 Linux/Windows CI 执行，未以本机未安装为理由跳过门禁。 |

完整下载并独立验证的候选 [Windows artifact 12550181374](https://github.com/blooddrunk/Shot2Agent/actions/runs/40067540865/artifacts/12550181374)：

- ZIP SHA-256 `da8f0063c7a55024b76e907e079f2cb3bcac87fac39fe7906fe1c4072e464016`。
- BUILD.txt / MANIFEST.json / Relay source/SOURCE.txt 均指向 PR 合并测试提交 `92f791f0dc637f42a6c5e0b463765fd03ea62d5b`，版本 `1.1.0-dev.1`。`git fetch origin refs/pull/26/merge` 后与 f777d00 比较树无差异。
- 外层 artifact 和内层 ZIP 的 CRC 全部 PASS；368 个 manifest 文件逐一 SHA-256 PASS。Remote client/capabilities/outbox 编译资源、两个验收入口、5 张合成图、使用/验证说明和独立 Relay 构建上下文都在包内。
- 原生观察所用 df6e5bf 候选的 244 个 runtime 文件与本候选逐字节相同；只有测试/包身份有差异，不扩大原生观察结论。

## 开发阶段记录（保留实际失败）

所有测试使用临时根目录、合成图片、Fake/mock 和临时设备 Token。未读取操作员历史、使用个人截图或调用付费模型。

| 命令 | 状态 | 退出码/结果 |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile`（`CI=true`） | PASS | 0；冻结锁文件未更改。首次无 TTY 安装退出 1，设置 CI 后成功。 |
| `npm run check`（本机最终功能复验） | PASS | 0；250 Node 测试，247 PASS / 3 SKIPPED；lint、TS/Vue、构建和 compiled smoke PASS。提交后由 CI 校验精确 SHA。 |
| `node --experimental-strip-types --test packages/desktop/test/remote.test.mjs` | PASS | 0；现有 Remote 13/13，另有注册表部署回归 1/1（合跑 14/14）；包括独立桌面进程的真实 HTTP 自动收发、缓存预算、身份切换不迁移及安全重启清理。 |
| `npm run desktop:test-ui`（新增前） | PASS | 0；28/28。首次缺少 Chromium 退出 1；安装 Playwright Chromium 后通过。 |
| 第一轮修复后 PR CI（0bbd10b） | PASS | [Node 矩阵、31 Vue、Compose](https://github.com/blooddrunk/Shot2Agent/actions/runs/40066709064)；[8 Rust、ZIP/EXE/原生 API](https://github.com/blooddrunk/Shot2Agent/actions/runs/40066709042)。后续收尾提交必须再验证精确身份。 |
| 本机 Docker / Rust 构建 | SKIPPED | 本机未安装 Docker / cargo；这些本机命令不可执行；相应 Linux 容器与 Windows 构建已在上述 CI 实际 PASS。 |

新增 Remote GUI 专项 `npm run desktop:test-ui -- -g "M10 Remote"` 已 PASS（0，3/3，1040/720/480px），截图已检查无横向溢出。完整 31 项曾有 1 项 FAIL：旧版本标题断言硬编码 1.0.2；改为 APP_VERSION 后定向重跑 PASS。随后完整 31/31 在 CI 通过。

开发阶段 Remote GUI 测试曾发现测试驱动未等待异步图片提交，以及删除 Token 后残留上次同步时间导致精确文字断言失败；已修正等待和状态清理，最终重跑结果另记。首次旧测试在临时 start 指纹校验变更下失败；校验限制为带目标绑定的 Remote，Local 原有绑定变化的终态失败语义保留。不得用后续 PASS 隐藏这些实际发生的 FAIL。

## R01–R10 对照（自动化 PASS，真实环境边界分列）

| ID | 可执行证据/关键断言 | 当前边界 |
| --- | --- | --- |
| R01 | 现有 compiled Local smoke 禁止网络/listener；Remote 模式切换测试确认 Local 新任务直接进入本机 Core，零 Relay 调用。 | 原 Local 数据/旧版本 fixture 保留；真实新增 Remote 原生观察未完成。 |
| R02 | remote.test 单图/5 图、GUI composer 排序、独立后台进程 Worker、origin 自动下载、Markdown/复制/通知 mock、一次 attempt。 | Fake；没有真实模型请求。 |
| R03 | 离线上传、服务端接受后丢 ACK、重启 A；稳定 taskId/key，服务端只有一个任务/Agent 只执行一次；M1 截断/部分写入断言沿用。 | 真实路由器/WAN 不在模拟网络结论内。 |
| R04 | 暂停接收后排队，Relay 重启保留 presence/任务/结果；A 重启恢复，交付 receipt 不重复；独立进程自动接收。 | 真实 VPS/断电存储未验收。 |
| R05 | 目标/Worker 身份和旧 proof 拒绝；启动后租约丢失变为 execution_unknown，claim 不重跑；M1 未启动过期重新排队和 fencing 测试保留。 | 模型进程副作用不由 Fake 证明；复用已批准 adapter 的停止语义。 |
| R06 | 独立设备角色/owner、错误及轮换 Token、伪造 target、部分输入、路径遍历、下载哈希/原设备/响应大小校验；旧 symlink/blob/超限测试保留。 | TLS 只允许 HTTPS 或 loopback HTTP，公网证书需实际部署。 |
| R07 | 保存失败时文件剪贴板/通知仍成功；全关闭保留历史；Smart 保护新内容；真实本地 .md 路径、历史删除不删导出。 | CF_HDROP/通知 API 是独立 Windows gate；Explorer 实际粘贴需限定人工观察。 |
| R08 | 模式只影响新任务；Remote 永不进入可执行 Local Core；同一 working/cleanup/OS worker lock 串行；Token 不出现在 JSON/快照。 | 原配置不强制迁移；Remote 使用独立数据库，旧待传绑定不改地址/身份。 |
| R09 | 冻结安装/check/UI、Node 22/24 Win/Linux 和 Windows Rust/ZIP/extracted EXE 复用现有 CI；增加 Relay namespace 原生凭据测试、Remote 资源 manifest 检查。 | 本文只把实际执行的结果标为 PASS。 |
| R10 | `scripts/relay-container.mjs` 实际通过独立 Compose/私有卷、Caddy 配置、上传去重/重启/Fake/私有下载/撤销与停机备份恢复；断言 Relay 没有 published port。 | Docker CI PASS；真实公网 DNS/TLS 仍 NOT VERIFIED。 |

## 人工边界与交付

[Remote 使用与最小验收](REMOTE_GUIDE.md) 给出前置设备、具体窗口/点击、PASS/FAIL、恢复和未验证范围。ZIP 已包含隔离且可重启的 Fake 启动器、五张合成图和可独立构建的 Relay 源码部署上下文。未观察的真实双 Windows、跨网络 HTTPS/VPS、Explorer 粘贴、通知/焦点均 **NOT VERIFIED**。没有请求重复验证 v1.0.2 未改变的原生 Local 功能；新观察只针对 Remote 结果路径。

2026-10-24 原生观察：Windows 11 Pro 10.0.26300、单台电脑、两个独立临时 Fake 数据根、loopback Relay。采用上述相同 runtime 的真实 EXE，设置由隔离生产 controller 预置（**不声称手工/原生 GUI 录入 Token 已验收**）。实际截图确认 B 设置显示“Relay 已连接”、遮蔽后的已保存 Token 和已勾选的接收开关，故仅该可见状态为 PASS。A 首个实例在观察前退出，原因未确认；重新启动后出现窗口和原生文件选择器。Computer Use 两次输入后文件名仍为空，本次原生提交测试尝试 **FAIL / 输入未确认**，没有实际提交或粘贴可据以判定成功。测试已停止、两个临时 Credential Manager 项已删除；正常应用历史、真实 Token 和截图未作为测试输入。

因此真实双设备公网闭环、最终 Remote 结果 Explorer 粘贴、可见通知/焦点保持继续 **NOT VERIFIED**，按指南只需三组真实观察；不要求重新执行故障注入或整套开发命令。没有付费模型请求，也没有创建 v1.1.0 Tag/Release。

## CI 实际失败和修复

- 初始源 008a9b14af1ca0f156ca8b34ea8fbe5a585a8c5f，[40066564989](https://github.com/blooddrunk/Shot2Agent/actions/runs/40066564989) 的 Compose job 实际 FAIL：未引用的 YAML flow 字符串在逗号处分成两个 tmpfs 项，Docker 报 `invalid mount path: mode=1777`。已给字符串加引号，并在容器测试断言解析后的完整 tmpfs；40066709064 的容器 job 实际 PASS。
- 本机完整 UI 曾 30 PASS / 1 FAIL（硬编码旧版本）；改为检查当前 APP_VERSION，定向 1/1 PASS，40066709064 完整 31/31 PASS。
- 本机损坏 blob 回归曾 FAIL（新增长度预检查返回 UNSAFE_FILE，而原契约是 BLOB_INTEGRITY）；保留原错误契约同时在读文件前拒绝不符长度，随后完整 check PASS。
- 缓存预算、一次性排他启动清理及 Git 跟踪文件限定的部署源码包属于收尾修正；后续精确 SHA CI 仍须全部通过，不能沿用旧构建替代。
- df6e5bf 的 [40067041753](https://github.com/blooddrunk/Shot2Agent/actions/runs/40067041753) Windows Node 22 实际 FAIL：原 Codex junction 去重测试耗时 5153ms，超过 5 秒后多出 `scan_incomplete`，断言 2≠1。f777d00 只改测试：目录身份测试冻结上下文 Date，并新增独立真实预检进程/逻辑时钟推进的预算用例，证明下一安装不再扫描。未调大生产预算、未降低指纹/兼容性断言；同 SHA Windows Node 22 完整 255 tests 已 PASS。
