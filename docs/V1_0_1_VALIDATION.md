# Local v1.0.1 UX polish — 验证与原生验收

日期：2026-10-23。实现候选；**原生托盘可视验收未完成，不发布正式 v1.0.1 标签**。

## 基线与实现

- 已执行 `git fetch origin --prune`（0）；原工作区干净，main/origin/main、v1.0.0 tag/Release 均为 `789c90daaba54301ec1eb54f2ed69939bcc3702a`。
- PR #22 当时 OPEN，规范分支 `fa0176891507068bcd9c035941b7ed8498054bfb`。实现分支从 origin/main 创建，再 fast-forward 整合原规范提交，没有复制/重写规范。合并顺序建议先 #22，再本实现 PR。
- 状态由 `packages/desktop/src/tray.ts` 纯函数派生，供快照、Vue 和 Rust 托盘共享；不新增持久化字段。优先级：异常、处理、排队、待确认、暂停、监听、未开启/待设置。
- 捕获与执行各自描述，paused+running/off+running 保持处理主图标和准确捕获文字。待确认仅在真实 pending 时出现；截图不打开或聚焦窗口。单击托盘/菜单回到首页预览。
- 原生 Rust 线程约 2 秒刷新；快捷动作后立即刷新。仅变化的 icon/tooltip/menu 调用原生 setter；失败的 setter 不缓存成功，下次重试。协调器 RPC 失败立即替换为异常/禁用动作；死亡由下一次轮询发现，挂起的 RPC 保留既有 20 秒超时（最坏约 22 秒）。退出唤醒轮询并移除托盘，保留进程树/热键清理。
- 16/20/24/32px 等效原生 RGBA 图像，有深色边线、浅色底和不同轮廓，不只靠颜色。Windows TaskbarCreated 恢复由锁定的 tray-icon 依赖处理；当前并未实测重启 Explorer。
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

已执行代码源 `3d9dba0a62745182391428ba5ed382b14ab81b6a` 的 [Node 22/24 Linux/Windows + 25 Vue tests](https://github.com/blooddrunk/Shot2Agent/actions/runs/39895556862) 和 [Windows Rust/package/完整解压 EXE/原生 tray smoke](https://github.com/blooddrunk/Shot2Agent/actions/runs/39895556832) 均成功；Windows Node 每档 232 tests / 230 passed / 2 skipped，Linux 每档 232 / 207 / 25。PR workflow 的 BUILD/MANIFEST 记录合并测试提交，不能把 branch SHA 与构建 SHA 混称。最后增补仅增加预览收费说明、off+running/隔离故障按钮 GUI 回归和原生菜单文字 readback；**最终分支 SHA、精确 HEAD 的 CI 和 ZIP 哈希见 [实现 PR #23](https://github.com/blooddrunk/Shot2Agent/pull/23) 的描述与 checks**，不可用本段较早提交的通过覆盖后续失败。

早期新增测试产生的 lint 错误（structuredClone/Event 的测试全局声明），以及 3 项测试前提错误（未进入助手页/漏设手动复制），均修正后通过；没有跳过失败测试。浏览器截图检查包括深浅主题、1040/720/480 宽度及预览、设置、历史、编辑器。源码 SHA、最终 CI URL、测试数量和 ZIP 校验值将在本 PR 的最终证据中填写，不将旧版本证据挪用为本版本 PASS。

## 一次最小的 Windows Fake 原生验收

**为什么仍需要这一次：** Computer Use 初始化及一次重试都在操作前失败：`sandboxCwd is not a local file URI: file:///mnt/d/code/projects/Shot2Agent`。未获取真实任务栏截图、未点击原生托盘。浏览器/原生 API readback 不能证明 Windows 任务栏外观及焦点行为。既有未改动的原生 Markdown 文件复制验收继续保留，不要求重测，也不测试真实收费模型。

前提：Windows 11 已解锁桌面；使用本 PR 最终成功 Windows CI 的完整 ZIP，完整解压到一个独立目录，保留 EXE 和 runtime。先自行退出日常实例，避免认错托盘。**只双击 `Start acceptance.cmd`**，窗口标题必须显示 `Fake acceptance`；每次得到全新的临时 root，不打开日常历史/Token。Fake 每个任务延迟约 8 秒。设置页有仅此模式出现的“隔离故障测试”；正式 Local 拒绝这些指令。

1. **未启用 → 监听：** 启动时首页已有程序内置合成图片待确认。先点“丢弃”：托盘应为灰色横线，提示“捕获已关闭”，暂停项禁用。到设置勾选“监听剪贴板中的新图片”，提交方式“确认后提交”，剪贴板返回“手动复制”，点“应用设置”；应为圆点/“正在监听新图片（剪贴板）”。
2. **隐藏待确认、不抢焦点：** 在包内打开合成图片 `runtime\dist\scripts\fixtures\glm-vision.png`，把图片窗口留在前台，按 Win+Shift+S 只截该合成图片。Shot2Agent 应保持隐藏/后台，托盘变感叹号，tooltip 有“图片等待确认”。单击该托盘或右键“查看待确认图片”，应回首页看到预览；没有任务直到点“提交图片”。
3. **处理 + 暂停/关闭 + 排队：** 点“提交图片”，在 8 秒内右键托盘“暂停截图监听”，应仍为处理三角形，tooltip 同时写“正在处理 1 项”和“捕获已暂停”；菜单仅变为“恢复截图监听”。可连续点首页“处理剪贴板图片”两次，队列应显示增加并每约 8 秒递减。到设置关闭剪贴板监听并应用，仍在运行的任务不能变成“停止”，tooltip 应为“正在处理… · 捕获已关闭”；全部完成后横线。无结果时复制禁用；无失败投递时重试禁用；只有一个 Fake 助手时切换助手禁用。
4. **捕获故障/处理故障组合：** 重新开启监听，提交一项，再到设置点“模拟捕获故障”。托盘应变叉号；窗口解释剪贴板连接断开、已有任务继续，并有“重新连接剪贴板”。点击恢复应清除捕获错误且不重跑任务。再次提交一项，点“模拟处理服务故障”，即使快照仍有 running/queue，也应以叉号和“处理服务已停止”优先，要求退出重开；不会声称任务已成功或自动重跑。
5. **协调器失联/退出：** 从托盘“退出 Shot2Agent”，图标应消失。重新双击 `Start acceptance.cmd`，到设置点“模拟协调器失联”。托盘应为叉号、提示退出重开、提交等动作禁用；窗口给出中文重开提示。再次用托盘退出，图标应消失。不会触及日常进程或数据。
6. **外观只看一次：** 在上述步骤同时观察任务栏小图标轮廓与 tooltip/menu 中文。若已有深/浅任务栏环境，可各看一次；只报告实际观察到的主题/DPI。若未实测 Explorer 重启或 DPI 组合，明确保留“未验证”，不阻止合并已验证实现，但不能宣称全环境支持已实见。

可选环境重现：在无运行 Fake 任务时通过任务管理器重启“Windows 资源管理器”，预期托盘恢复且 2 秒内显示实际状态；在 Windows 显示设置切换 100%/150%/200% 缩放，预期轮廓仍可辨。未执行的组合必须写“未验证”。这些系统操作不由自动化代为执行。

最小回报：以上 1–5 各 PASS/具体失败，以及观察到的 Windows 主题/缩放；失败时只报哪次点击、实际图标/文字/焦点或退出结果。**目前没有操作员的新托盘 PASS，不建议正式发布 v1.0.1。** 全部必要 Windows 自动门和以上原生观察通过后，再从最终 main 构建和发布；不要修改 v1.0.0 tag/Release。
