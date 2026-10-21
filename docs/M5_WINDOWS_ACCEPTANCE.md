# M5-L Windows 11 使用与验收（0.5.0）

M5 保留 `%LOCALAPPDATA%\Shot2Agent-Codex` 正式根目录、`--legacy` 旧历史和 `--staging` 独立 Fake 入口。新版正式入口可选择已批准的 Codex CLI / Claude Code Profile。无需 Relay/VPS。**安装检测、Mock、Windows 打包、协议探针均不是实际 Claude 模型识图证明。**

## 安装检测和显式批准（不请求模型）

前置条件：非管理员 Windows 11 会话、WebView2，解压当前 CI ZIP 并核对 `BUILD.txt` SHA。先从托盘选择“退出”，确保已有 Worker 停止。下面在解压后的 `Shot2Agent` 文件夹运行 PowerShell；所有路径均使用绝对路径。

```powershell
Get-Content .\BUILD.txt
Get-Command codex,claude -All -ErrorAction SilentlyContinue | Select-Object Name,Source
# 仅对已经找到的程序运行版本命令：
if (Get-Command codex -ErrorAction SilentlyContinue) { codex --version }
if (Get-Command claude -ErrorAction SilentlyContinue) { claude --version }
$root = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Codex'
& .\runtime\node.exe .\runtime\dist\apps\cli\src\mvp.js discover-agents --provider claude
& .\runtime\node.exe .\runtime\dist\apps\cli\src\mvp.js discover-agents --provider codex
# 从检测结果中明确选一个绝对路径；可以是原生 EXE 或可验证的官方 npm 包 shim。
$claudePath = 'C:\Users\YOUR_NAME\.local\bin\claude.exe' # 替换为实际路径
& .\runtime\node.exe .\runtime\dist\apps\cli\src\mvp.js approve-agent --root $root --provider claude --path $claudePath
```

`approve-agent` 是本机操作员明确批准。它保留原 Codex Profile，备份 `settings.m5-backup-*.json`，追加一个新的 ID/Version 配置并选择它。已有 Profile 不会覆盖。运行中的 Worker 会拒绝该命令。扫描达到时间/数量上限会显示 `scan_incomplete`，必须用 `--path` 明确选择，不能将未完成检测误当唯一安装。多安装必须用 `--path` 选择；没有手动路径且检测到多个可用候选时拒绝批准。手动路径优先，即使该路径无效也不回退到其它安装。版本/文件摘要变化后旧 Profile 拒绝执行，必须停止应用并重新显式批准。重置路径可对原 CLI 再批准一次，或在 UI 选择保留的原 Profile。

官方 npm `.cmd/.ps1/.bat` 不通过 Shell 运行：核对精确包名和 bin 元数据后映射到原生 EXE，或 Node + 已确认的 JS 入口。未知包装器、链接逃逸和非本地路径被拒绝。首次已有正式 Codex 配置的用户无须迁移；若还没有正式配置，按 `Windows instructions.md` 初始化 Codex，不能以 Fake 配置充当正式入口。

预期：打开 `Start Codex.cmd`，在“执行配置”选择已批准 Agent；“CLI 路径与状态”显示固定版本和路径，刷新安装检测不会改配置、创建任务或修改剪贴板。`unverified_auth` 只表示版本/必要参数检查通过。记录 PASS / FAIL / NOT VERIFIED、CLI 版本、安全错误码。不要提交凭证或历史数据库。

## Claude 安全和协议边界

当前仅 **Windows Claude Code 2.1.305 / 2.1.306** 的 JSONL 图片传输经官方原生 EXE + 本地模拟后端验证。其它版本可以被发现/批准，但缺少 `imageProtocol`，任务会以 `CLAUDE_IMAGE_PROTOCOL_NOT_VERIFIED` 拒绝；不会变为文字任务或切换 Codex。升级不能自动批准新版本。

Adapter 使用 `--restricted --safe-mode --tools "" --disallowedTools "mcp__*" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --no-session-persistence`，不使用 `--bare` 或权限绕过。由于管理员 Hooks 高于这些参数，M5 拒绝检测到的机器/用户注册表策略、受管配置文件/目录、远程策略缓存及 MCP 配置（不可读取同样拒绝）。仅支持 CLI 报告已登录的个人 `claude.ai` Pro/Max 订阅；API Key、OAuth 环境 Token、Team/Enterprise 或未知账户类型拒绝，以免服务端策略加载无法隔离的 Hooks。身份读取不代表模型已成功认证。用户仍通过 Claude 自己的登录流程登录，Shot2Agent 不管理凭证。

可选无模型费用的协议重验（仅合成图片，临时空配置、本地模拟 API，不访问现有登录）：

```powershell
& .\runtime\node.exe '.\Verify Claude transport.mjs' $claudePath
```

预期退出 0，`imageSeen:true, calls:1, subtype:success, isError:false`。这只证明输入图片字节到达模拟 API、CLI 正确完成，**不是实际模型识别**。不要用这个命令作为登录或识图 PASS。

## 真实模型任务（必须另行明确同意可能的费用）

前置条件：所选 CLI 已由用户登录；用户明确同意本次最多 Codex 一次、Claude 一次真实模型费用；Claude 满足上述个人订阅、版本和隔离条件。未获得费用同意时此项记 **NOT VERIFIED**，不要运行。

1. 用记事本写 `SHOT2AGENT 42`，`Win+Shift+S` 只截取合成文字。应用先保持确认模式、手动剪贴板、开启一个新的空 Markdown 输出目录。
2. 选择 Codex，点击一次“提交当前剪贴板图片”。完成后查看详情与保存的 Markdown：文字应识别出 `SHOT2AGENT 42`，历史归属 Codex、状态 succeeded、只有一个执行 attempt。
3. 选择 Claude，对同一合成图片执行一次；如命中 5 秒去重，请稍后再点击一次，先确认前一次未创建任务。预期 Claude 历史/详情和 Markdown 识别相同标记、一个 attempt。失败/不确定时停止，不自动重跑、不切另一个 Agent 补跑。
4. 若安全条件拒绝，记录具体 `CLAUDE_*` 错误码和版本，标记 FAIL/BLOCKED；缺安装、登录、费用同意则 NOT VERIFIED。不要提供真实截图或模型私人输出。

可以先只做上面的无费用检查。订阅认证、真实模型是否正确理解图片及费用行为均保留独立边界。

## 桌面与重启（可先用 Mock，不代替原生观察）

前置条件：前面两个 Agent 可用且已同意相应费用；要测试排队绑定时，在一个任务尚在运行时再提交合成图，不额外重复已完成任务。

- Codex 提交后切 Claude，及 Claude 提交后切 Codex：旧任务历史归属保持原 Agent/版本；新任务才使用新选择。点击详情核对 attempts 中 Adapter/版本和 Profile 指纹。
- 开启自动提交、Smart 和 Markdown 保存；记事本保持前台，截取新的合成图片。预期各自归属正确、一个任务、文件独立保存、前台焦点保持、实际粘贴一次结果。Smart receipt 成功本身不是粘贴证明。
- 在第二次结果完成前复制 `NEWER CLIPBOARD`：预期 `blocked_by_clipboard_change`，粘贴仍为 `NEWER CLIPBOARD`；手动“复制结果”后可粘贴结果。
- 暂停后退出并重启：保留设置、Profile 注册表、历史和未开始队列。已有任务不因当前选择重定向；已可能启动的任务为 succeeded/failed/execution_unknown 等终态，不自动重跑。恢复只监听新图片。

逐项记录 PASS / FAIL / NOT VERIFIED，加上可见状态/安全错误码和合成文字观察。既有 M3 输入法同步相关现象的根因仍未确认，不承诺所有输入法兼容。

## 回退

停止应用和 Worker 后保留整个私有根目录，在本机将批准前的 `settings.m5-backup-*.json` 复制回 `settings.json`；不要删除数据库/图片/投递收据。旧 0.4.1 能继续读取原 Codex 配置/历史，不会把新增 Claude/新版 Codex 任务改为旧 Codex 执行；这些任务需重装 M5 并恢复对应 Profile 才可继续。不要把版本回退当作未知执行结果的重试授权。配置备份可能包含私人路径，留在本机，不提交 Git。
