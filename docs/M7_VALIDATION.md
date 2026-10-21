# M7-L 验证记录 — 2026-10-21

实现及后续修复集中在 [PR #13](https://github.com/blooddrunk/Shot2Agent/pull/13)。基准 main 为 `0806d64429ddc92760928df71cf57f5e33fdc0d1`；最终 head、CI 和 Windows 包以该 PR 的提交及 Actions 记录为准。

## 操作人员报告

- 下载 ZIP 后启动界面曾报 `COORDINATOR_STOPPED_RESTART_APP`；修复后操作人员确认能正常进入界面。
- GUI 保存 GLM Token 曾报 `LOCAL_OPERATION_FAILED`；后续操作人员确认 Token 可以保存。
- 截图任务曾报 `CLAUDE_MANAGED_POLICY_REFUSED`；操作人员随后明确报告“验证通过，图片可以被 glm 处理”。这建立了该操作人员当前本机配置的实际 GLM 图片处理证据。
- 操作人员未提供最后一次成功运行的程序包 SHA，因此该报告不单独绑定到某个后续修复提交，也不扩展为其他 CLI、Windows 用户、端点或模型全部通过。未记录或复制 Token、截图内容、历史数据库和实际输出。
- 操作人员指出旧 `execution_unknown / CODEX_INTERRUPTED` 历史无法删除。已加入 GUI 单次确认后的单项/批量删除；该新增按钮的交互验收尚未由操作人员报告。

## 自动化与原生复现

- 隔离的 Windows 临时脚本副本加上互联网来源 `ZoneId=3`：`RemoteSigned` 启动返回 1、没有策略结果，并报脚本安全错误；仅对子进程生效的 `Bypass` 启动返回 0 和 `absent`。该复现使用真实 Windows PowerShell，不启动 Claude，不发送模型请求。
- 修正后的固定策略命令只允许内置脚本和精确参数；真实注册表策略必须返回 `present` 才报告 managed-policy 拒绝。其他启动错误归类为检查不可用。真实文件策略拒绝仍保留。
- CI 覆盖源码辅助脚本及最终 Windows 包；最终包中的三个内置辅助脚本均加入下载标记。凭据生命周期使用合成 Token，策略脚本使用只读检查，打包 EXE smoke 使用隔离 Fake。
- 历史删除使用一次确认：用户确认对应 Agent 已停止，且当前 Worker 执行及清理已结束后，才允许删除不确定历史。该操作不启动、取消或重放 Agent，不改变任务执行结果以伪造成功。
- 针对性 Fake 检查覆盖默认拒绝、确认删除、批量原子性、活动任务拒绝、未确认停止拒绝、删除意图持久化、崩溃恢复、私有文件及元数据清理和不重放。删除不确定历史后也释放其 Profile 引用。外部 Markdown 文件保留。

本地 `corepack pnpm install --frozen-lockfile` 和 `npm run check` 均退出 0；完整检查为 195 项、170 PASS、0 FAIL、25 个平台相关 SKIP，并包含 lint、TypeScript/Vue、构建和编译后 Fake smoke。历史/桌面针对性检查 12/12、策略分类及拒绝检查 3/3、重试次数和时间预算针对性检查 2/2 通过。Windows 原生策略辅助脚本复现及修复验证退出 0。

最终提交对应的 Windows CI 结果在 PR 中记录。真实 GUI 观察与 Fake/Mock/辅助脚本结果分别按上述范围解释；本轮自动化未发起付费模型请求。

## CI 中另行发现的计时测试问题

`6b6a020` 的 [Windows 包与原生辅助脚本检查](https://github.com/blooddrunk/Shot2Agent/actions/runs/39628560136)通过；[矩阵检查](https://github.com/blooddrunk/Shot2Agent/actions/runs/39628560224)的 Windows Node 24 在已有的保存重试计数测试失败：慢速 SQLite 写入耗尽 500ms 预算，实际调用 2 次，断言要求 3 次。生产逻辑按预算停止正确。仅该计数/通道独立性测试固定单调时钟；真实时间预算拒绝测试继续单独覆盖，不改变生产重试预算或断言。其他三个矩阵任务通过，原失败记录保留。
