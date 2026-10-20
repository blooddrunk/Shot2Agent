# Windows Local MVP 使用与验收

M2-L 使用 **Windows 原生 Node CLI + 隐藏 PowerShell/Win32 剪切板辅助进程**。没有本地 HTTP、Relay 或 VPS 配置。CLI 不会主动激活窗口；可最小化控制台继续监听。没有系统托盘、GUI、安装包或自启动。Windows 实际截图、焦点和真实 Windows Codex 的验收结论见 [验证记录](M2_VALIDATION.md)，不能从 Fake/CI 推断。

## 安装与启动（Windows 11 PowerShell）

在普通用户的交互式桌面运行，勿使用 WSL Node、管理员终端、计划任务或 Windows Service。准备 Node **22.16+**、Git、pnpm **10.19.0**。首次安装需要网络。所有运行时目录放在当前用户目录的本地磁盘；不要放在 Git、截图监听目录、共享目录或 OneDrive 内。

```powershell
git clone https://github.com/blooddrunk/Shot2Agent.git
Set-Location Shot2Agent
node --version
corepack pnpm install --frozen-lockfile
npm run check
# 如果没有 corepack：npm install -g pnpm@10.19.0；然后 pnpm install --frozen-lockfile
```

先走 Fake 路径（不需要 Codex 或账号）：

```powershell
$fakeRoot = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Fake'
$fakeOutput = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Fake-Results'
node .\dist\apps\cli\src\mvp.js init --root $fakeRoot --adapter fake --clipboard manual --save $fakeOutput
node .\dist\apps\cli\src\mvp.js watch --root $fakeRoot
```

用 `Win+Shift+S` 截取一张**合成测试文字**图片。回到控制台输入 `submit` 回车，这是确认操作；`Image detected` 本身不会上传或创建任务。记下返回的 UUID。Worker 自动处理，输入：

```text
list
show <真实 UUID>
copy <真实 UUID>
delivery <真实 UUID>
quit
```

将 `<真实 UUID>` 整段替换为输出的 UUID。`copy` 是明确的 Copy text 操作；在记事本粘贴，结果应与 `show` 一致。保存文件为 `$fakeOutput\<UUID>.md`。可以在任务执行期间继续提交，队列逐项处理。`quit`/Ctrl+C 会请求停止执行，再关闭存储；启动过而无法确认结束的 Codex 执行记为 `execution_unknown`。

真实 Codex 路径：

```powershell
# 若尚未安装；需要支持下述隔离选项的版本
npm install -g @openai/codex
codex --version
codex login
codex login status
codex exec --help
$localRoot = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Codex'
$workspace = Join-Path $env:LOCALAPPDATA 'Shot2Agent-ReadonlyWorkspace'
$output = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Results'
New-Item -ItemType Directory -Force $workspace | Out-Null
# npm Windows 安装通常提供 codex.cmd；启动器会改为 node + 旁边的包内 codex.js，不通过 cmd.exe
$codexPath = (Get-Command codex.cmd -ErrorAction Stop).Source
node .\dist\apps\cli\src\mvp.js init --root $localRoot --adapter codex --workspace $workspace --codex $codexPath --clipboard smart --save $output
node .\dist\apps\cli\src\mvp.js doctor --root $localRoot
node .\dist\apps\cli\src\mvp.js watch --root $localRoot
```

独立原生安装用 `--codex 'C:\实际路径\codex.exe'`；非标准 npm 布局可用 `--codex 'C:\实际路径\node.exe' --codex-script 'C:\实际路径\codex.js'`。禁止 `.bat/.ps1` 包装或 shell 命令。配置只由本机用户控制，不能让任务或截图选择可执行程序/工作目录。

真实路径同样截图后输入 `submit`。返回的 Markdown 应包含合成截图文字。Smart 成功后可直接在记事本粘贴；如果提交后复制了新内容，Smart 必须保留新内容，并在 `delivery UUID` 显示 `blocked_by_clipboard_change`，仍可输入 `copy UUID` 手动复制结果。

`watch --auto` 是**显式开启新图片自动提交/上传云端 Codex**；默认未开启。此时可最小化控制台，在其他程序截图等待结果后粘贴。保持 watcher 的标准输入打开；关闭控制台会停止 watcher。没有后台常驻 Windows 服务。自动模式会检查启动时当前剪切板的图片一次。相同编码图片 5 秒内去重，之后新的剪切板事件可以再次提交；`submit --force` 用于明确重做，watch 中固定采用启动时的 `--force` 选项。失败/未知任务绝不自动重做。

## 单次命令与配置

所有命令均支持 `--root`；未指定时用 `%LOCALAPPDATA%\Shot2Agent`。Fake/Codex 建议使用不同根目录，互不迁移历史。`init` 只创建一次；再次运行会拒绝覆盖已有配置。

```powershell
# 手动提交当前剪切板，本身就是确认操作；随后启动 work 或 watch 处理
node .\dist\apps\cli\src\mvp.js submit --root $localRoot
node .\dist\apps\cli\src\mvp.js work --root $localRoot
# 图片文件入口；file 不读取剪切板，因此 Smart 没有安全基线，会跳过自动回传
node .\dist\apps\cli\src\mvp.js file 'C:\测试图片\synthetic.png' --root $localRoot
node .\dist\apps\cli\src\mvp.js list --root $localRoot
node .\dist\apps\cli\src\mvp.js show '<真实 UUID>' --root $localRoot
node .\dist\apps\cli\src\mvp.js copy '<真实 UUID>' --root $localRoot
node .\dist\apps\cli\src\mvp.js delivery '<真实 UUID>' --root $localRoot
# 只重试结果通道，不重新调用 Codex
node .\dist\apps\cli\src\mvp.js retry-delivery '<真实 UUID>' --root $localRoot
```

Smart 基线绑定当前 helper 生命周期，**重启或另一个 CLI 进程处理旧任务时保守跳过自动复制**。为了自动回传，请在同一个 `watch` 进程内提交及处理。手动 `copy` 始终可用。

退出 watcher 后可用 `notepad (Join-Path $localRoot 'settings.json')` 修改本机配置，再重启：

- `delivery.clipboard`: `off | manual | smart | always`。默认 `manual`；`always` 只有明确配置时启用，会覆盖新内容。
- `delivery.saveDirectory`: 独立的绝对路径；删除该键关闭保存。只允许生成的 UUID 文件名，拒绝符号链接根、目标冲突或路径逃逸。保存采用临时文件、fsync、rename；文件不可执行。
- `off` 并删除保存目录是合法的 history-only。`copy UUID` 仍表示用户明确要求复制。
- `codex`: Worker-owned 的注册项，含 ID/version、固定 workspace、可执行路径/JS 入口、**准确 CLI 版本字符串**、timeout（5 秒至 1 小时）、prompt。升级 Codex 后 `doctor`/执行拒绝版本变化；先查新版本 `exec --help` 确认兼容性，再明确更新 `cliVersion`，同时提升 Profile version。旧版本排队任务保持待处理，不静默改绑。

任务保存在 `tasks.sqlite` 和 `blobs/`；剪切板基线、原图/发送哈希、转换记录及独立通道收据在 `local.sqlite`。备份时先退出所有进程，复制整个根目录；不要只复制主数据库而遗漏 WAL/图片。保持用户目录 ACL 私有。M2-L 不自动安装 ACL、清理历史或删除图片；用户需管理磁盘空间。

## 安全与资源边界

Adapter 使用参数数组、`shell:false`、隐藏子窗口、只读 sandbox、`approval_policy=never`、关闭 shell tool、忽略用户配置和 rules、ephemeral 会话；不提供任何权限升级或失败后宽松重试。Windows 固定请求 `windows.sandbox="unelevated"` 的受限令牌沙箱，避免自动管理员配置；若组织策略/CLI 不支持则任务拒绝或未知，绝不退回无沙箱。[OpenAI Windows 沙箱说明](https://developers.openai.com/codex/windows) 说明其限制；这里不承诺文件读取隔离或模型完全服从截图防注入提示。请使用专用空白 workspace，无额外项目配置/MCP、账号材料或敏感文件。[CLI 参数](https://developers.openai.com/codex/cli/reference) 与 [非交互执行](https://developers.openai.com/codex/noninteractive) 用于核对图片和最终输出选项。

主程序不打印 child stdout/stderr、凭据、图片或结果作诊断；`show`/`copy` 是用户主动读取内容。子进程只继承运行、Codex 登录、代理和证书所需的环境变量；不继承任意应用令牌。Codex 模型会收到图片，仍可能需要网络。进程日志总量上限 1 MiB，最终 UTF-8 Markdown 上限 100,000 字节，非零退出/超时/日志溢出/无有效最终文件均保守记未知（未启动则 failed）。POSIX 杀进程组，Windows taskkill `/T /F`；未能确认完整活动结束时不宣称安全重试。

支持仍图 PNG/JPEG/WEBP（Windows 图像剪切板转换为 PNG），64,000,000 像素、每边 32,768；Core 仍为每图 20 MiB、每任务 60 MiB/20 图。CLI 当前每次提交单图，不提供批量编辑器。全局串行 Core 解码、Sharp 单线程与 32 MiB 缓存限制降低峰值；64 MP 的解码仍可能消耗数百 MiB，请预留内存，非操作系统硬内存隔离。

读入原图最多 60 MiB；超过 20 MiB 时尝试无损 PNG 优化（保留尺寸、不降采样、不用调色板、不做有损压缩），持久化原哈希/发送哈希及转换类型。优化后仍超限明确拒绝。剪切板 DIB 最大约 256 MiB，并在解码前检查尺寸；PNG 原始大小最多 60 MiB。不会清空读取失败的剪切板。没有 CF_HDROP、远程回传或移动通知。

## 故障排查

| 现象/代码 | 操作 | 期望与边界 |
| --- | --- | --- |
| `ALREADY_INITIALIZED_EDIT_PRIVATE_SETTINGS` | 退出 watcher，用记事本修改私有 settings.json 或选新根 | 不覆盖原队列/历史 |
| `CODEX_FLAGS_UNSUPPORTED` / `CODEX_VERSION_CHANGED` / `CODEX_PREFLIGHT` | `codex --version`、`codex exec --help`、`codex login status`、`doctor`；修复路径/兼容版本/认证 | 不加入 bypass/full-access 参数 |
| `CODEX_EXIT` / `execution_unknown` | 先检查认证、workspace、进程是否还活着；不要自动再次提交 | 原任务保留，确认停机后才人工建新任务 |
| `CLIPBOARD_UNAVAILABLE_OR_OVERSIZED` | 在登录桌面重试 `submit`，关闭占用剪切板的软件；检查图像大小 | helper 有 6 次短退避，序列监听失败下次再试；不会清空图像 |
| helper 无法启动 | 运行 Windows PowerShell 5.1；检查组织执行策略、Add-Type、System.Drawing；按本机政策允许此受审脚本 | 不自动绕过执行策略；`file` 仍可验证 Agent |
| Smart 无自动结果 | `delivery UUID` 检查新复制/重启/文件任务导致的 blocked | 用 `copy UUID`；不要改为 always 规避冲突保护 |
| save failed | 检查磁盘空间、目录 ACL、已有文件内容、路径符号链接；修复配置后 `retry-delivery UUID` | 不重复执行 Agent；clipboard 与历史继续可用 |
| 进程重启后 running | 等待默认 30 秒租约恢复，运行 `list`；started 到期变 unknown | queued 会继续，started 不重放 |

## Windows 人工验收记录表

前置：同一台 Windows 11 登录桌面、上述安装/build 成功、可用 Codex 登录、专用空白 workspace、只含已知文字的合成截图、独立结果目录。先记录 `git rev-parse HEAD`、`node --version`、`codex --version`、`codex login status`（不要记 token）。每一行记录具体命令/动作、时间、预期、观察、退出码、PASS/FAIL/NOT VERIFIED；记录存在 Git 外。不要用完整控制台转录捕获私人结果。

| 项目 | 具体操作 | 期望观察 | 证据与失败排查 |
| --- | --- | --- | --- |
| Fake 单次闭环 | 按上文 Fake watch；截图、submit、list、show、copy，粘贴记事本 | 恰好 1 UUID，succeeded，Markdown 一致，UUID.md 存在 | 记录状态/文件存在与哈希，勿提交图片；失败按 helper/save 项排查 |
| 真图片 + Codex | 真实路径 watch；截图包含 `SHOT2AGENT 42`，submit、show | Markdown 准确读出文字，workspace 无修改 | 比较已知文字、workspace 文件清单及哈希，记录版本和状态；检查认证/只读限制 |
| Smart 正常 | `--clipboard smart` 初始化，同 watcher 提交后不复制其他内容，完成后粘贴 | delivery clipboard=succeeded，结果文本准确 | 记录收据与文字比较结果 |
| 新内容保护 | 提交后立刻在记事本复制另一句，等完成再粘贴 | 仍为新句，blocked；copy UUID 后才是结果 | 记录两次比较结果，若覆盖则 FAIL |
| 焦点 | watcher 已最小化，在记事本截图/编辑并等待任务完成 | 窗口不跳到前台、键盘仍作用记事本 | 观察提交前后前台窗口/光标，不能由 CI 判定 |
| 保存/独立通道 | save+smart 同开；再把 saveDirectory 指向一个已有普通文件路径并重启 watcher | 正常时两通道独立成功；错误时 save failed，task/clipboard/history 不受影响 | delivery 收据、UUID.md 哈希；修复后 retry-delivery 不增加 attempt |
| history-only | 退出，设 clipboard=off，删除 saveDirectory；重启、submit | succeeded，两个 disabled，无额外输出，show 可读 | 记录通道、文件清单；手动 copy 仍可测试 |
| 过滤与去重 | 复制纯文本；随后复制同一图，连续 submit 两次（5 秒内） | 文本不建任务；一次提交、第二次无 ID | list 数量；--force 只用于明确新任务 |
| 双 4K | 将 7680×2160 合成 PNG 以图像形式复制/截图，再提交 | 不出现 16 MP 拒绝；若 <20 MiB 则正常处理 | 记录尺寸、字节、任务状态、任务管理器峰值内存 |
| 重启恢复 | submit 后退出再 work；执行中关闭后等租约到期 list，再启动 watch | queued 恢复；started=execution_unknown，无重复 Agent attempt；旧 Smart 不回写 | 记录 list/status 与次数；未知后先检查旧 Codex 进程再人工建新任务 |
| 剪切板占用 | 用测试工具暂时占用剪切板再释放；新图 submit | 有界重试/下一轮恢复，不清空原图、无重复任务 | 记录失败与释放后状态；超过上限明确失败 |

若某项环境不具备，标记 **NOT VERIFIED**，不能写 PASS。只需在这一轮代码上做一轮针对实际失败的最小稳定性修复；Remote、完整 UI、托盘、安装包仍单独延期。
