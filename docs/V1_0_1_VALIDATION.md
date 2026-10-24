# Local v1.0.1 UX polish — 验证与原生验收

更新：2026-10-24。**操作员已反馈“验收已经全部通过”，本轮必要的 Windows 原生托盘验收记录为操作员报告 PASS。** 2026-10-23 的自动化结果保留；最后合并、main 构建及正式发布状态以本 PR / Release 的实际结果为准。

## 操作员验收结论（2026-10-24）

- 直接用户反馈：“验收已经全部通过”。按上一轮交付的最小 Fake 原生托盘清单记录为全部通过：监听/未开启、隐藏待确认与不抢焦点、暂停/关闭监听仍处理、队列与菜单资格、错误提示和恢复、退出清理。
- 上一轮交付源码为 `9f7a301a8a6fcb2b4bfb60e650bf12182a1922e4`；验收候选包 BUILD/MANIFEST 为 PR 合并测试提交 `b899da52d2e754bbb2839e68adc4a4b9a835c2bf`，ZIP SHA-256 `cc40e7a4f6f187cf0ba812de4405f8fff115138b88d82518e53d842fbbc0e041`。
- 此结论来自操作员实机反馈，不是 Agent 自动截图/录像或 CI 视觉证明。未另行细分报告的任意主题、DPI、Explorer 重启、通知环境与真实付费提供商能力不扩大宣称；无需为本轮已经验收且未改动的行为重复清单。
- 本次归档验收和发布说明，并修复一个既有重试次数测试的时间依赖；不修改运行代码、任务 Core、文件剪贴板、凭据或 Agent。后续发布须核对最终源码的自动化门和包身份；Remote/Relay 继续延后。

## 基线与实现

- 已执行 `git fetch origin --prune`（0）；原工作区干净，main/origin/main、v1.0.0 tag/Release 均为 `789c90daaba54301ec1eb54f2ed69939bcc3702a`。
- PR #22 当时 OPEN，规范分支 `fa0176891507068bcd9c035941b7ed8498054bfb`。实现分支从 origin/main 创建，再 fast-forward 整合原规范提交，没有复制/重写规范。合并顺序建议先 #22，再本实现 PR。
- 状态由 `packages/desktop/src/tray.ts` 纯函数派生，供快照、Vue 和 Rust 托盘共享；不新增持久化字段。优先级：异常、处理、排队、待确认、暂停、监听、未开启/待设置。
- 捕获与执行各自描述，paused+running/off+running 保持处理主图标和准确捕获文字。待确认仅在真实 pending 时出现；截图不打开或聚焦窗口。单击托盘/菜单回到首页预览。
- 原生 Rust 线程约 2 秒刷新；快捷动作后立即刷新。仅变化的 icon/tooltip/menu 调用原生 setter；失败的 setter 不缓存成功，下次重试。协调器 RPC 失败立即替换为异常/禁用动作；死亡由下一次轮询发现，挂起的 RPC 保留既有 20 秒超时（最坏约 22 秒）。退出唤醒轮询并移除托盘，保留进程树/热键清理。
- 16/20/24/32px 等效原生 RGBA 图像，有深色边线、浅色底和不同轮廓，不只靠颜色。Windows TaskbarCreated 恢复由锁定的 tray-icon 依赖处理；未另行记录 Explorer 重启的具体环境组合。
- 每条历史携带只读 retryableChannels；重试按钮和控制器只重试启用且符合现有资格的失败通道，排除 conflict/ambiguous。失败反馈不报告成功；无 Agent 重跑。
- 首次添加仅在发现一种兼容安装时预选对应类型，否则明确选择 Codex / Claude Code / GLM。不会默认选择 GLM，不改变已保存默认助手。
- 四页/主题/窗口尺寸保持原样。中文恢复提示优先，技术代码放在详情。保留 Core、adapters、文件剪贴板、Token 保存/可选测试、同意和未知执行不重放规则；无 Remote/Relay/新服务/遥测。

## 自动化执行记录

所有数据使用临时隔离目录、合成图片、Fake/mock；没有读取操作员 Token、截图或历史，没有付费 AI 请求。

| 命令或检查 | 退出码 / 结论 | 范围 |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile` | 0 | 锁文件未变化 |
| `node --experimental-strip-types --test packages/desktop/test/tray.test.mjs` | 0，初始 15/15；增补后的 16 项由完整 check 覆盖 | 状态表、独立维度、故障、快速转换、快照资格、失败/成功反馈及不重新执行 |
| `npm run check` | 0：232 tests / 207 passed / 25 platform skipped | lint、TS/Vue、完整 Node 回归、编译与 smoke |
| `npm run desktop:test-ui` | 0：26/26；包括 off+running 和隔离 GUI 故障按钮，最终 CI 另见 PR checks | 真 Vue + 隔离 controller，非原生托盘证据 |
| `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | Rust 格式 |
| 本机 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-default-features` | 101，环境失败 | WSL 缺少 dbus-1.pc；未安装系统包；不作为 Windows 测试通过 |
| Windows Rust release tests / desktop build / package | 0：8/8 Rust release tests；build/package 成功 | 使用 Windows CI，非 WSL EXE |
| 完整 ZIP 解压、manifest 全文件哈希、helper/fixture、EXE IPC/quit/后代清理 | 0：打包及解压目录均 PASS | 原有 portable-verify 与 smoke 保留 |
| `Shot2Agent.exe --staging --tray-smoke`（打包目录及解压目录） | 0：打包及解压目录均 PASS | 创建真实原生 tray/menu/image，setter 与菜单 enabled readback、更新去重、杀掉本次自有协调器后的异常状态、移除托盘；不证明实见外观/真实点击 |
| impeccable detector / diff whitespace | detector 0、无发现；git diff --check 0 | 机械检查不能替代视觉检查 |

最终实现源码 `9f7a301a8a6fcb2b4bfb60e650bf12182a1922e4` 的 [Node 22/24 Linux/Windows + 26 Vue tests](https://github.com/blooddrunk/Shot2Agent/actions/runs/39896243873) 和 [Windows Rust/package/完整解压 EXE/原生 tray smoke](https://github.com/blooddrunk/Shot2Agent/actions/runs/39896243753) 均成功。Windows Node 每档 232 tests / 230 passed / 2 skipped，Linux 每档 232 / 207 / 25；Rust 8/8。该包下载后独立 CRC/SHA 与 249 个清单文件哈希核对通过；本机 Windows `--staging --smoke` 与 `--staging --tray-smoke` 均退出 0。

PR workflow 的 BUILD/MANIFEST 记录合并测试提交，不能把 branch SHA 与构建 SHA 混称。仅文档归档更新后的精确 HEAD / 最终 main CI 和发布包 SHA 将记录在 [实现 PR #23](https://github.com/blooddrunk/Shot2Agent/pull/23) 与正式 Release，不以较早提交的通过覆盖后续失败。

早期新增测试产生的 lint 错误（structuredClone/Event 的测试全局声明），以及 3 项测试前提错误（未进入助手页/漏设手动复制），均修正后通过；没有跳过失败测试。浏览器截图检查包括深浅主题、1040/720/480 宽度及预览、设置、历史、编辑器。源码 SHA、最终 CI URL、测试数量和 ZIP 校验值将在本 PR 的最终证据中填写，不将旧版本证据挪用为本版本 PASS。

## 2026-10-24 归档提交的 CI 计时问题

文档归档提交 `2e84f6e647a4eab5b1596a7c726c39728db4cb92` 的 Windows package/Rust/ZIP/EXE/托盘门 [40053403368](https://github.com/blooddrunk/Shot2Agent/actions/runs/40053403368) 通过；[矩阵 40053403457](https://github.com/blooddrunk/Shot2Agent/actions/runs/40053403457) 的 Windows Node 22 首次失败：既有 `retry exhaustion bounded: 2` 预期 3 次调用，实际 2 次。该用例复用了 500ms 预算，受 hosted Windows SQLite 写入延迟影响，约 2195ms 后触发时间预算停止，与“次数耗尽”的断言混在一起。其他矩阵档和 26 Vue 测试通过；本机完整 check 退出 0（232 项，207 pass/25 平台跳过）。

修复仅为该次数用例加入 `context.mock.method(globalThis.performance, 'now', () => 0)`，复用同文件已有的重试次数隔离模式；次数、失败代码、stopReason 和调用数的严格断言全部保留。单独的真实预算拒绝及队列/活动写超时测试未改，生产投递/原生剪贴板没有变化。最终测试修复提交的精确 HEAD CI 见 PR #23 checks；首次失败保留，不以旧提交通过覆盖。

## 已完成的一次最小 Windows Fake 原生验收（保留复现步骤）

**2026-10-23 请求这次人工观察的原因（已于 2026-10-24 由操作员反馈关闭）：** Computer Use 初始化及一次重试都在操作前失败：`sandboxCwd is not a local file URI: file:///mnt/d/code/projects/Shot2Agent`。未获取真实任务栏截图、未点击原生托盘。浏览器/原生 API readback 不能证明 Windows 任务栏外观及焦点行为。既有未改动的原生 Markdown 文件复制验收继续保留，不要求重测，也不测试真实收费模型。

前提：Windows 11 已解锁桌面；使用本 PR 最终成功 Windows CI 的完整 ZIP，完整解压到一个独立目录，保留 EXE 和 runtime。先自行退出日常实例，避免认错托盘。**只双击 `Start acceptance.cmd`**，窗口标题必须显示 `Fake acceptance`；每次得到全新的临时 root，不打开日常历史/Token。Fake 每个任务延迟约 8 秒。设置页有仅此模式出现的“隔离故障测试”；正式 Local 拒绝这些指令。

1. **未启用 → 监听：** 启动时首页已有程序内置合成图片待确认。先点“丢弃”：托盘应为灰色横线，提示“捕获已关闭”，暂停项禁用。到设置勾选“监听剪贴板中的新图片”，提交方式“确认后提交”，剪贴板返回“手动复制”，点“应用设置”；应为圆点/“正在监听新图片（剪贴板）”。
2. **隐藏待确认、不抢焦点：** 在包内打开合成图片 `runtime\dist\scripts\fixtures\glm-vision.png`，把图片窗口留在前台，按 Win+Shift+S 只截该合成图片。Shot2Agent 应保持隐藏/后台，托盘变感叹号，tooltip 有“图片等待确认”。单击该托盘或右键“查看待确认图片”，应回首页看到预览；没有任务直到点“提交图片”。
3. **处理 + 暂停/关闭 + 排队：** 点“提交图片”，在 8 秒内右键托盘“暂停截图监听”，应仍为处理三角形，tooltip 同时写“正在处理 1 项”和“捕获已暂停”；菜单仅变为“恢复截图监听”。可连续点首页“处理剪贴板图片”两次，队列应显示增加并每约 8 秒递减。到设置关闭剪贴板监听并应用，仍在运行的任务不能变成“停止”，tooltip 应为“正在处理… · 捕获已关闭”；全部完成后横线。无结果时复制禁用；无失败投递时重试禁用；只有一个 Fake 助手时切换助手禁用。
4. **捕获故障/处理故障组合：** 重新开启监听，提交一项，再到设置点“模拟捕获故障”。托盘应变叉号；窗口解释剪贴板连接断开、已有任务继续，并有“重新连接剪贴板”。点击恢复应清除捕获错误且不重跑任务。再次提交一项，点“模拟处理服务故障”，即使快照仍有 running/queue，也应以叉号和“处理服务已停止”优先，要求退出重开；不会声称任务已成功或自动重跑。
5. **协调器失联/退出：** 从托盘“退出 Shot2Agent”，图标应消失。重新双击 `Start acceptance.cmd`，到设置点“模拟协调器失联”。托盘应为叉号、提示退出重开、提交等动作禁用；窗口给出中文重开提示。再次用托盘退出，图标应消失。不会触及日常进程或数据。
6. **外观只看一次：** 在上述步骤同时观察任务栏小图标轮廓与 tooltip/menu 中文。若已有深/浅任务栏环境，可各看一次；只报告实际观察到的主题/DPI。若未实测 Explorer 重启或 DPI 组合，明确保留“未验证”，不阻止合并已验证实现，但不能宣称全环境支持已实见。

可选环境重现：在无运行 Fake 任务时通过任务管理器重启“Windows 资源管理器”，预期托盘恢复且 2 秒内显示实际状态；在 Windows 显示设置切换 100%/150%/200% 缩放，预期轮廓仍可辨。未执行的组合必须写“未验证”。这些系统操作不由自动化代为执行。

结论：操作员于 2026-10-24 反馈“验收已经全部通过”，以上本轮必要观察已记录 PASS。此处步骤仅留作复现；不再请求重复验收或重测既有原生文件复制。正式发布前核对最终 main 的自动化门、ZIP 和 BUILD/MANIFEST 身份；保持 v1.0.0 tag/Release 不变。
