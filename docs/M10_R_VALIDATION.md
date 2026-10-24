# M10-R 验证记录

状态：实现中，1.1.0-dev.1；不构成正式 Remote 发布或真实双机验收。

基线：2026-10-24 fetch 后 `origin/main=5f0f7ab8e8d4f3cd30aa2b7351fa19aa499e11cb`，工作区原先干净。最新正式 Release 为 v1.0.2；PR #24 已合并，规划 PR #25（2815eaec8af9aef68b2c8e6727a4b82d45cf6a3f）仍开放。已读取其 M10-R R01–R10 规划；此实现不修改发布请求、旧 Tag/Release 或展开 M11。

## 已执行的开发验证

所有测试使用临时根目录、合成图片、Fake/mock 和临时设备 Token。未读取操作员历史、使用个人截图或调用付费模型。

| 命令 | 状态 | 退出码/结果 |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile`（`CI=true`） | PASS | 0；冻结锁文件未更改。首次无 TTY 安装退出 1，设置 CI 后成功。 |
| `npm run check`（本机最终功能复验） | PASS | 0；250 Node 测试，247 PASS / 3 SKIPPED；lint、TS/Vue、构建和 compiled smoke PASS。提交后由 CI 校验精确 SHA。 |
| `node --experimental-strip-types --test packages/desktop/test/remote.test.mjs` | PASS | 0；10/10。包括独立桌面进程的真实 HTTP 自动收发。 |
| `npm run desktop:test-ui`（新增前） | PASS | 0；28/28。首次缺少 Chromium 退出 1；安装 Playwright Chromium 后通过。 |
| 最终源码、CI、Windows ZIP 身份 | NOT VERIFIED | 将在功能提交的 CI 完成后补入精确 SHA、命令与链接。 |
| 本机 Docker / Rust 构建 | SKIPPED | 本机未安装 Docker / cargo；Linux 容器与 Windows 构建 CI 已配置，尚不能称 PASS。 |

新增 Remote GUI 专项 `npm run desktop:test-ui -- -g "M10 Remote"` 已 PASS（0，3/3，1040/720/480px），截图已检查无横向溢出。完整 31 项 UI 正在复验。

开发阶段 Remote GUI 测试曾发现测试驱动未等待异步图片提交，以及删除 Token 后残留上次同步时间导致精确文字断言失败；已修正等待和状态清理，最终重跑结果另记。首次旧测试在临时 start 指纹校验变更下失败；校验限制为带目标绑定的 Remote，Local 原有绑定变化的终态失败语义保留。不得用后续 PASS 隐藏这些实际发生的 FAIL。

## R01–R10 对照（最终 CI 待补）

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
| R10 | `scripts/relay-container.mjs` 驱动独立 Compose/私有卷、上传去重/重启/Fake/私有下载/撤销与停机备份恢复；断言 Relay 没有 published port。 | 本机 Docker 不可用；等待新增 CI 实际结果，公网 TLS 仍 NOT VERIFIED。 |

## 人工边界与交付

[Remote 使用与最小验收](REMOTE_GUIDE.md) 给出前置设备、具体窗口/点击、PASS/FAIL、恢复和未验证范围。ZIP 将包含隔离且可重启的 Fake 启动器、五张合成图和可独立构建的 Relay 源码部署上下文。未观察的真实双 Windows、跨网络 HTTPS/VPS、Explorer 粘贴、通知/焦点均 **NOT VERIFIED**。没有请求重复验证 v1.0.2 未改变的原生 Local 功能；新观察只针对 Remote 结果路径。
