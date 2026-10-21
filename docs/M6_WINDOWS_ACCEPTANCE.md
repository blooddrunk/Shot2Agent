# M6-L Windows Local 操作与验收（0.6.0）

使用最新 CI 生成的 ZIP，完整解压，并在运行前核对 `BUILD.txt` 中的提交版本。无需安装器或 Relay。替换程序包前，请通过 **Quit Shot2Agent（退出 Shot2Agent）** 关闭旧程序。已有历史记录和已批准的执行配置（Profile）会保留；任务不会自动重新执行。在 M6_VALIDATION.md 中记录实际观察结果之前，以下内容仅为待执行的验收步骤。

## 使用 Fake 验收全局操作（不产生模型费用）

前置条件：Windows 11 交互式桌面、WebView2、最新 ZIP。打开 `Start acceptance.cmd`，使用 Fake 和 `%LOCALAPPDATA%\Shot2Agent-M3-Acceptance`，与正式历史记录隔离。如果该测试目录已有操作人员的测试历史，请保留；先使用程序包提供的 `--staging --smoke`，在独立的一次性目录中执行自动检查。不要删除正式数据目录。

1. 展开 **全局快捷键与操作**。所有快捷键初始均为停用状态。为 **暂停 / 恢复捕获** 设置 `Ctrl+Alt+P`，为 **复制最新成功结果** 设置 `Ctrl+Alt+C`，为 **重试最新失败投递** 设置 `Ctrl+Alt+R`；可选设置 **循环切换已批准 Agent** 为 `Ctrl+Alt+A`、**提交当前剪贴板图片** 为 `Ctrl+Alt+S`。点击 **保存快捷键**。显示 `registered` 表示注册成功；快捷键不可用时返回 `HOTKEY_CONFLICT_OLD_BINDINGS_RETAINED`。仅支持 Ctrl+Alt、Ctrl+Shift 或 Alt+Shift 加大写字母或数字。清空某一输入框即可停用该快捷键；**全部停用** 会停用所有快捷键。只有原生注册成功后才保存配置。
2. 选择手动剪贴板投递和确认捕获模式，并应用设置。在记事本输入 `SHOT2AGENT 42`，使用 `Win+Shift+S` 仅截取这段文字。提交一次，等待状态变为 succeeded（成功）。条件允许时，可保留一个更新的排队中或运行中任务。点击 **隐藏到托盘**，点击记事本，再按 `Ctrl+Alt+C`，随后按一次 `Ctrl+V` 粘贴。预期：粘贴的是最新一个“已完成且成功”的 Markdown 结果，不会选择运行中或失败任务的结果，且记事本仍在前台。记录实际粘贴内容和焦点状态；仅有投递收据不能证明这两项。
3. 保持记事本在前台，按 `Ctrl+Alt+P`，通过托盘提示或显示窗口确认捕获已暂停。再次按下后应恢复捕获；原有剪贴板图片不得产生新任务。可选的显式提交快捷键与 **提交当前剪贴板图片** 按钮一致，即使自动捕获已关闭或暂停，也可以提交当前图片。这是明确的提交操作，不是恢复监听。去重仍然生效；适用时状态应显示 `DUPLICATE_IMAGE` 或 `NO_CURRENT_IMAGE`。
4. 没有符合条件的失败投递时按重试快捷键：应显示 `NO_ELIGIBLE_FAILED_DELIVERY`，且不调用 Agent。对于 Fake 任务已完成、但保存失败的情况，仅修复输出目录问题后再按重试。系统只重试已启用且失败的投递通道；已成功、已中断、结果不确定或受冲突保护的通道均跳过。任务 ID 和执行尝试次数保持不变。完整故障注入已有自动化覆盖，不要破坏个人输出文件来制造此场景。
5. 关闭并重新打开测试程序：快捷键配置应保留。检查退出清理时，先从托盘退出，再在第二个测试实例中注册相同快捷键：这些快捷键应恢复可用。原生自动化测试还会在两个独立线程中注册同一快捷键，检查冲突、释放并重新注册。不要让两个 Worker（任务执行进程）共用同一个数据目录。
6. 将两个输入框设为同一组合键，或输入 `Win+L`：保存应被拒绝，并保留原配置。验证实际系统冲突时，可先在自己控制的另一个应用中占用一个测试快捷键；在此处设置同一快捷键应被拒绝。测试后恢复另一个应用的设置。如果发生异常，先使用 **全部停用**，再从托盘退出并重新打开；不要重置历史记录或设置文件。

循环切换 Agent 需要注册表中已有两个以上获批 Profile。仅含 Fake 的测试环境应显示 `NO_OTHER_APPROVED_AGENT`。若要在不调用模型的情况下观察原生切换，仅在已有获批配置的队列为空、且捕获关闭时，按循环切换快捷键并查看选中的提供方和版本。此项检查不要再提交图片。排队中和运行中任务的绑定保持不变，已由自动化 Mock 测试覆盖；未获得费用授权时，不要创建真实排队任务或启用付费 Worker 来重复该测试。

## 配置网关凭据并批准 Profile（不请求模型）

网关（Gateway）认证独立于个人 Pro/Max Claude 订阅认证。仅支持固定地址：国内 `https://open.bigmodel.cn/api/anthropic`，国际 `https://api.z.ai/api/anthropic`；不同区域的密钥不可互换。不允许查询参数、URL 内嵌凭据、任意主机、端口、HTTP 或禁用 TLS 的参数。模型 ID 和全部三个模型别名均纳入 Profile 指纹。现有订阅认证检查保持不变。

前置条件：程序和 Worker 均已停止，已有获批的 Codex 数据目录，已批准原生 Claude 2.1.305/2.1.306，网关账户由操作人员本人控制，且 Windows 凭据管理器可用。以下配置命令不会请求模型。当前版本仅提供命令行方式新增凭据和批准 Profile；桌面界面只能检测安装、查看和选择已批准的 Profile。这是当前配置界面的功能缺口，并非安全机制要求必须使用命令行。日常截图、结果复制和已批准 Agent 的切换无需执行这些命令。

### 明确打开命令执行位置

这里的“程序包目录”指**直接包含 `Shot2Agent.exe`、`Start Codex.cmd` 和 `runtime` 文件夹的那一级目录**，不是 ZIP 所在目录、仓库根目录或 `runtime` 子目录。

本次已下载并核对的程序包位于 Windows 路径：

```text
D:\code\projects\Shot2Agent\build\M6-f531d18-ci39580060787\unpacked\Shot2Agent
```

若使用本次交付包，先从托盘退出 Shot2Agent，再打开 PowerShell，完整复制执行：

```powershell
Set-Location -LiteralPath 'D:\code\projects\Shot2Agent\build\M6-f531d18-ci39580060787\unpacked\Shot2Agent'
Get-Item '.\Shot2Agent.exe', '.\runtime\node.exe', '.\runtime\dist\apps\cli\src\mvp.js'
```

预期列出这三个文件，且没有“找不到路径”错误。若报错，停止执行后续配置命令。若自行解压到了其他位置，用资源管理器进入直接包含 `Shot2Agent.exe` 的文件夹，点击地址栏、输入 `powershell` 并按回车；然后执行上面的 `Get-Item` 检查。这样打开的 PowerShell 就位于正确目录。不要在聊天中发送 Token。

确认位置正确后，在同一个 PowerShell 窗口执行：

```powershell
$root = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Codex'
$cli = Join-Path $PWD 'runtime\dist\apps\cli\src\mvp.js'
$node = Join-Path $PWD 'runtime\node.exe'
& $node $cli credential-add --root $root
# 在隐藏输入提示中输入 Token。仅复制返回的 Shot2Agent-Gateway-UUID 凭据引用。
$ref = 'Shot2Agent-Gateway-REPLACE_WITH_RETURNED_UUID'
$claude = 'C:\Users\YOUR_NAME\.local\bin\claude.exe' # 替换为实际发现的准确路径
& $node $cli approve-gateway --root $root --path $claude --endpoint 'https://open.bigmodel.cn/api/anthropic' --model 'glm-5.3-flash' --credential-ref $ref
```

无需通过命令参数或环境变量传入 Token。Token 由 Windows 凭据管理器保存（通用凭据，在当前 Windows 用户范围内使用本机持久化）。设置和数据库仅保存凭据引用、端点、模型及指纹，不提供明文存储回退。覆盖已有凭据引用会被拒绝；轮换凭据时，新增引用并批准一个新的不可变 Profile。原有排队任务的 Profile 继续使用旧引用。系统会保留 Worker 停止状态下的设置备份。删除凭据会影响所有引用它的 Profile，必须显式执行：

```powershell
& $node $cli credential-delete --root $root --credential-ref $ref --confirm-delete
```

检查排队任务后，只删除本次测试自行创建的凭据引用。删除后，受影响的 Profile 将拒绝执行，不会自动选择另一个 Agent。恢复时应创建新的凭据引用和 Profile，切勿覆盖历史记录。如有需要，可为后续任务重新选择原先获批的 Codex 或订阅 Profile。

界面显示网关提供方、端点、模型、`bound_os_reference`（仅表示已绑定；执行时才检查凭据是否可用），以及视觉状态 `not-verified`。默认任务会在读取凭据或启动模型之前，以 `GATEWAY_VISION_NOT_VERIFIED` 拒绝执行。已知不支持视觉的 GLM 模型名称会以 `GATEWAY_MODEL_VISION_UNSUPPORTED` 拒绝执行；其他 CLI 版本也会被拒绝，不会切换 Agent。认证、端点或传输失败均保留安全错误码和原始网关来源记录；已启动但执行结果不确定时，绝不自动重放。

## 无费用的原生传输探测

```powershell
& $node '.\Verify Gateway transport.mjs' $claude 'glm-5.3-flash'
```

该探测使用空的一次性配置、合成凭据、本机回环 Mock API 和合成 PNG，不读取已有认证信息。预期退出码为 0，且 `imageSeen`、`modelSeen`、`authSeen`、`transportMarker` 均为 true，`calls:1`、`secretOnDisk:false`。它验证原生 CLI 参数、图片类型消息块传输、准确的模型路由和 Token 认证。返回的标记由测试夹具提供，**不是 OCR 识图结果**。本机回环探测不能证明真实 HTTPS 端点认证、证书或重定向行为、模型可用性或视觉能力。

## 真实模型验收——单独授权并观察前均为 NOT VERIFIED（未验证）

本轮实现未获得付费请求授权。不能根据纯文本 CLI 可用或 Mock 通过来推断图片支持。[GLM-4.6V 官方文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v) 描述了视觉能力，但不能据此确认某个具体 Anthropic 兼容端点或 Coding Plan 密钥具有该能力。[Claude 官方配置文档](https://docs.bigmodel.cn/cn/coding-plan/tool/claude) 说明了网关设置和模型别名；不能假定 Coding 默认模型支持图片。

只有操作人员确认所用的准确端点、模型和凭据在现有隔离限制下支持直接图片输入（包括可接受的 TLS 和重定向行为），并明确授权一次合成图片付费任务后，才可使用完全相同的显式参数重新执行 `approve-gateway`，并增加 `--attest-vision`。这会创建新的 Profile 和版本，记录的是**操作人员声明**，不是软件验证。任务输入和界面均不能授予此权限；Profile 配置由可信操作人员在程序停止后完成。证据不足时，保持默认拒绝。不要通过启用 MCP 视觉服务器或工具绕过限制。

随后打开程序，选择这个新 Profile，保持捕获关闭、剪贴板投递为手动，并使用新的空输出目录。在记事本输入 `SHOT2AGENT 42`，截图仅包含这段文字，然后点击一次 **提交当前剪贴板图片**。预期：只有一次执行尝试，任务记录显示网关提供方和获批 Profile 版本，状态为 succeeded（成功），Markdown 正确识别该标记。记录不含敏感信息的端点主机名、模型及 CLI 版本、状态或错误码、识别出的标记和尝试次数；切勿记录 Token、真实个人截图或账户输出。认证、非交互式完成请求、图片类型消息块传输、模型视觉能力和标记识别，是**五项独立检查**。不能从一次 Worker 执行尝试推断实际 API 请求次数；CLI 内部的 HTTP 行为需要提供方侧不含敏感信息的用量证据。失败或结果不确定时立即停止，不自动重试或切换 Agent。如果无法确认直接视觉输入及重定向隔离符合要求，应让 Profile 保持 `not-verified`，继续安全拒绝。

交互式快捷键投递、窗口隐藏时的前台焦点、实际剪贴板粘贴、原生托盘菜单交互，以及真实端点和 GLM 识图，在分别获得实际观察证据之前，均保持 NOT VERIFIED（未验证）。现有 Smart 冲突仍未解决，关闭输入法同步后也仍然存在。
