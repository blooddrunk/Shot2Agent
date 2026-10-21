# Current M3-L desktop acceptance

Use [M3 Windows run guide](M3_WINDOWS_RUN.md) for the ready-to-run portable build, actual GUI/tray control names, isolated staging root, deterministic 8-second Fake result and five affected observations. The six M3 desktop observations have operator-reported PASS on 2026-10-21, with the Smart/input-method caveat and remaining boundaries in [M3 evidence](M3_VALIDATION.md#operator-acceptance--2026-10-21). Repeat only affected observations after relevant changes. M2 minimum-loop acceptance below remains historical and valid at its recorded scope.

# Windows 验收：只做本次改动需要确认的项目

**当前 M2-L 最小闭环已由操作者在 2026-10-20 反馈验收通过，无需为了补表重新做一遍。** [结果和证据边界](M2_VALIDATION.md#operator-acceptance-2026-10-20)。本页用于以后改动触及相应功能时复验；不是每次更新都要完成的作业。

目前交付物仍是 CLI。下文明确区分“PowerShell”和“正在运行的 watcher”两个输入位置。将来桌面 App 实现后，开发代理必须先把本页改成实际窗口、菜单和按钮步骤，再请用户验证；不要让用户猜未实现的界面。

## 谁来做、何时做

| 本次改动触及什么 | 开发代理先完成 | 用户只需确认什么 |
| --- | --- | --- |
| 普通文档或不影响 Windows 行为的改动 | 自动检查、链接和命令语法检查 | 通常无需人工操作 |
| 剪切板读取、手动复制、桌面入口 | Fake 自动测试、Windows 原生读写测试，准备可运行版本 | A：一张测试截图、复制、粘贴 |
| Codex 参数、Profile、图片输入 | Mock 子进程、安全边界和超时测试 | B：一次已知文字图片的真实分析 |
| Smart 回传或剪切板冲突策略 | 序列号、并发、重启基线自动测试 | C：正常回传和新内容保护 |
| 托盘、窗口、后台进程或启动方式 | 构建、启动/退出测试，准备启动入口 | D：使用其他软件时窗口是否抢焦点 |
| 保存目录或结果文件逻辑 | 原子保存、路径保护、错误隔离测试 | E：打开保存目录、查看文件 |
| 崩溃恢复、磁盘失败、剪切板占用、像素上限 | F：由代理在专用测试环境执行 | 通常无需用户手动构造故障 |
| Remote、推送、文件型剪切板、安装包等尚未交付功能 | 功能实现后另给具体步骤 | 当前无需执行，不能记为 PASS |

用户不用研究 SQLite、租约、PID 或测试脚本。开发代理发起人工验收时，只列本次需要的 A/B/C/D/E 小节，并先完成准备工作。

## 准备一次即可：代理先确认这些条件

1. 明确要测的提交/构建已准备好。不要要求用户一边排查构建失败、一边验证功能。
2. 记录 Windows、Node、Codex 的实际版本和构建提交；版本未知就写“未记录”，不能推测。
3. 确认当前使用 Fake 还是真实 Codex、运行目录和保存目录。**不要重新 `init` 已有目录，不要删除历史。** 临时改设置前先退出测试 watcher，并备份该测试配置；结束后恢复。
4. 提供实际可运行的启动命令和目录。下列命令假设用户仍采用 [使用指南](LOCAL_MVP_USAGE.md) 的默认目录；如果不同，代理应先替换为实际值。
5. 测试只使用记事本中的 `SHOT2AGENT 42` 或其他约定文字，不截账号、聊天或工作资料。真实 Codex 会收到截图，需要网络和可用的 Windows CLI 登录。
6. 不同时启动多个 watcher。已经看到 `Ready (...)` 的窗口就是正在运行的 watcher；在里面输入 `quit` 后才回到 PowerShell。

**两个输入位置不要混用：**

- **PowerShell**：看到类似 `PS D:\code\projects\Shot2Agent>`。在这里运行 `node ...`、`npm.cmd ...`。
- **watcher**：已经显示 `Ready (...)`。在这里输入 `submit`、`list`、`copy 任务UUID`、`delivery 任务UUID`、`quit`。不要在此输入整条 `node ...` 命令。

若代理已启动并显示 `Ready`，用户可以直接从 A 或 B 开始，不必再执行命令。需要手动启动时，在仓库根目录的 PowerShell 使用：

```powershell
# Fake：只验证截图/队列/结果复制，不需要真实 Codex
$fakeRoot = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Fake'
node .\dist\apps\cli\src\mvp.js watch --root $fakeRoot
```

真实 Codex 采用已配置的根目录：

```powershell
$localRoot = Join-Path $env:LOCALAPPDATA 'Shot2Agent-Codex'
node .\dist\apps\cli\src\mvp.js watch --root $localRoot
```

若提示配置不存在，交给代理检查准备步骤；不要为了继续测试随意新建或覆盖配置。

## A. 截一张图，手动复制结果（最小用户检查）

**前置：** Fake watcher 已显示 `Ready (fake, ...)`。打开 Windows 记事本，只输入 `SHOT2AGENT 42`。

1. 按 `Win+Shift+S`，拖出包含这行字的区域，完成截图。这里截图进剪切板，不要求另存文件。
2. 返回 watcher。应看到 `Image staged in memory`。这表示“图片已暂存，等你确认”，还没有创建任务。
3. 在 watcher 输入 `submit` 并回车。应出现一条包含非空 `taskId` 的输出，且 `status` 为 `queued`。`taskId` 后面那串带连字符的字符就是任务 UUID，后面用它查这一条任务。
4. 等出现 `Task processed`，输入 `list`。找到刚才同一个 UUID，状态应是 `succeeded`。如果仍是 `queued/running`，还没处理完，不能提前判失败或开始重复提交。
5. 在 watcher 输入 `copy `（末尾有一个空格），接上刚才的 UUID，再回车。**不要把“任务UUID”这几个汉字或尖括号也输入进去。** 预期看到 `Copied text`。
6. 回到记事本新建一个空白页，按 `Ctrl+V`。应出现以 `# Fake result` 开头、包含 image(s) 和哈希的文字。Fake 只用于验证流程，不会真的识别出截图文字；这不是分析错误。

**通过：** 一个任务成功，`Copied text` 出现，并实际粘贴出 Fake 结果。

**失败怎么处理：** 把 `Action failed: ...` 的错误代码、是否出现 UUID、`list` 中对应状态告诉代理即可，不用提交截图或整段结果。`no_image` 表示本次没读到图；`duplicate` 表示 5 秒内已有相同图片提交，不需要继续连按。可用 `current` 明确重读当前剪切板；它与确认已暂存图片的 `submit` 不同。

**回报一句话即可：** “A 通过，Fake 结果能粘贴”或“A 在第 5 步失败，代码 COPY_FAILED”。

## B. 确认真实 Codex 能读取图片

**何时需要：** 改了 Codex Adapter、Profile 或图片处理，或者第一次配置真实路径。代理先完成 CLI 登录和路径检查，不让用户在这里研究安装。

**前置：** 真实 Codex watcher 已显示 `Ready (codex, ...)`，专用只读 workspace 已准备好。沿用 A 的记事本测试文字。

1. 重新截取 `SHOT2AGENT 42`，在真实 watcher 输入 `submit`。不要把 Fake 任务的 UUID 用在这个根目录里。
2. 等 `Task processed`，输入 `list`。本次任务应为 `succeeded`。
3. 在 watcher 输入 `show ` 加本次 UUID。返回文字应准确包含截图中的 `SHOT2AGENT 42`；Markdown 可以有标题、加粗或解释，不要求与示例逐字一样。
4. 输入 `copy ` 加同一个 UUID，看到 `Copied text` 后，在记事本空白页按 `Ctrl+V`。粘贴内容应与刚才 `show` 的结果一致。

**通过：** 成功状态、已知文字识别正确、手动复制并实际粘贴成功。

**未通过：** `execution_unknown` 不能直接再次提交同图；先由代理确认旧 Codex 是否停止。若 `succeeded` 但认错文字，记录“图片分析内容不符”，不要将它当作剪切板失败。只反馈已知测试文字和状态，不上传私有结果。

**回报：** “B 通过，识别到 SHOT2AGENT 42，粘贴正常”。只读 workspace 的文件前后比较由代理另做，不由这句话自动推定通过。

## C. Smart 自动回传：两个独立检查

**前置：** 代理确认测试配置是 `clipboard: smart`，且在同一个 watcher 中截图、提交和处理。不要为了测试 Smart 改成 `always`。以下不用手动 `copy`，否则无法判断自动回传是否成功。

**C1 正常自动回传：**

1. 按 B 提交测试截图。
2. 提交后不要再复制文字、命令或任务 UUID；复制它们也算新剪切板内容，会使 Smart 正确地跳过自动回传。
3. 等结果完成后，回到记事本空白页直接按 `Ctrl+V`。应粘贴出本次 Markdown 结果；事后查询 `delivery` 的 clipboard 应为 `succeeded`。

**C2 保护新内容：**

1. 先在另一个记事本页打好 `KEEP-MY-NEW-TEXT`，保留这个页面。
2. 再提交一张测试截图。看到 `queued` 后、任务完成前，立即回到那页选中这句话，按 `Ctrl+C`。
3. 等任务处理完，在新的空白页按 `Ctrl+V`。应仍是 `KEEP-MY-NEW-TEXT`，不是 Codex 结果。
4. 返回 watcher，用 `delivery ` 加本次 UUID 查询，clipboard 应为 `blocked_by_clipboard_change`；然后明确执行 `copy ` 加同一个 UUID，再粘贴，才应变为结果文本。

**判断：** C1 和 C2 分开记录。`clipboard: succeeded, attempts: 2` 本身不能证明 C1 或 C2。如果第 2 步复制新文字时任务早已完成，这次 C2 样本无效，记 `NOT VERIFIED`，让代理接手，不要求用户反复抢速度。

## D. 后台运行是否抢走前台焦点

**何时需要：** 修改 watcher/后台进程、托盘或窗口行为时。Snipping Tool 自己弹出的截图界面属于正常截图操作，不算 Shot2Agent 抢焦点。

**前置：** 代理在独立 Fake 测试目录启动 `watch --auto`，明确告知这是自动提交模式；此项不需要真实 Codex。普通确认模式也可以先提交再回到记事本，但不要在此混测剪切板策略。

1. 看到 `Ready` 后，点击 watcher 窗口右上角“最小化”，不要关闭。
2. 在记事本输入一行字，用 `Win+Shift+S` 截取这行字；截图完成后回到记事本，继续慢慢输入 `focus-check`。
3. 等几秒。如果 Shot2Agent 控制台自行出现在最前面，或后续按键跑进它的命令输入位置，记为失败。
4. 最后由你自己恢复 watcher 窗口，输入 `list`，确认截图对应任务已处理；你手动恢复窗口不算程序抢焦点。

**通过：** 任务确实处理了，期间记事本持续能输入，后台窗口没有自己跳出来。只看源码里没有激活窗口 API 不能替代这一观察。

## E. 确认 Markdown 文件保存到了哪里

**前置：** 代理从当前设置读取并告知实际保存目录。默认示例是 `%LOCALAPPDATA%\Shot2Agent-Results`；使用 Fake 时可能是 `%LOCALAPPDATA%\Shot2Agent-Fake-Results`。如果配置不同，代理提供实际地址，不让用户猜。

1. 完成一个测试任务后，在 watcher 输入 `delivery ` 加该 UUID。应看到 `save.status: succeeded`。
2. 按 `Win+E` 打开资源管理器，点击顶部地址栏，粘贴代理给你的保存目录并回车。
3. 找到文件名为本次 UUID、后缀为 `.md` 的文件。隐藏了扩展名时，文件名可能只显示 UUID。
4. 用记事本打开文件（如果系统不认识 `.md`，右键 → 打开方式 → 记事本）。内容应与本次 `show` 的 Markdown 一致；不要拿另一条任务的文件作比较。

**通过：** 回执成功，实际文件存在，内容对应本任务。

**排查：** 回执成功但找不到文件，先由代理确认是不是看错根目录/保存目录。用户不用执行权限修改、制造磁盘满或把文件夹设为只读；这些属于 F。保存成功也不代表文件已经被用户打开，本次观察才补充这项证据。

## `delivery` 到底是什么

这是只读查询：查看“这个任务的结果已经送到哪里”，不会再次执行 Codex，也不会因为查询而重新写剪切板。

```json
{"save":{"status":"succeeded","attempts":1},"clipboard":{"status":"succeeded","attempts":2}}
```

- `save`：保存 Markdown 的通道；`clipboard`：写剪切板的通道。
- `succeeded`：该通道最后一次记录为成功。
- `attempts`：这个通道的累计处理次数。手动 Copy 或显式投递重试可能增加它，**不是 Codex 执行次数**。
- `manual`：自动复制关闭，等用户主动 Copy；`disabled`：通道关闭；`blocked_by_clipboard_change`：Smart 为保护其他内容跳过；它们不等于 Agent 执行失败。
- `retry-delivery` 是另一个明确重试通道的操作；不能把它与 `delivery` 查询混为一谈。

## F. 异常测试交给开发代理，不让普通用户构造故障

这些项目仍有价值，在改动触及相关逻辑或准备发布时执行。未触及时无需让用户补齐整表；没有对应证据就保留 `NOT VERIFIED`。优先运行现有自动测试，只有真实 Windows 行为无法覆盖时才做受控手工测试。

| 场景 | 代理必须准备和执行的具体动作 | 必须观察/记录 | 停止条件和用户负担 |
| --- | --- | --- | --- |
| 排队任务重启恢复 | 新建专用临时根；提交一张合成图片而不启动 Worker；退出提交进程；新进程查询应为 queued；再启动一个 Fake Worker | 同一任务 ID 保留，完成后 succeeded，只有一次执行；历史和文件重启后仍可读 | 不使用用户现有根，不让用户杀当前进程 |
| 启动后中断/超时 | 先跑 Mock Codex hang/tree/cancellation 测试；如需原生复验，记录仅属于测试运行的父/子 PID，强制终止测试执行或触发受控超时，再重开测试根 | 已启动的任务是 execution_unknown，不自动执行第二次；根/子进程确实停止；临时目录可清理，未确认停止时暂停新领取 | 不能用“关闭控制台”代替已证明进程停止；不能让用户在任务管理器猜 Node PID；无法确认所属关系即停止 |
| 保存失败与通道独立 | 在测试根里将保存目标设为专用已存在的普通文件路径，使保存必定失败；剪切板使用测试桩/CI 原生会话；完成 Fake 任务；修正目标后仅重试投递 | task 仍 succeeded；save failed；另一通道照常；修正后成功；Agent attempt 不增加；没有发布部分文件 | 只改测试配置，记录并恢复；不改系统 ACL、不填满用户磁盘 |
| history-only | 测试配置设 clipboard=off 并移除 saveDirectory，完成一个 Fake 任务，再从新进程读历史 | 结果/历史保留，两个可选通道 disabled，没有新输出文件或自动剪切板写入 | 不删除用户的保存目录或结果文件 |
| 过滤、去重、自触发 | 测试桩/CI 依次送文字事件、同一图片两次、结果文本事件；补测同一编码图 5 秒内重复提交 | 文字/自身结果不新增任务；重复图仅创建一次；明确 force 才作为主动重做 | 不能把晚于 5 秒的主动新截图错误判为去重失败 |
| 双 4K / 像素和字节上限 | 生成 7680×2160 合成 PNG、64 MP 边界及超限样本；先跑 decoder 测试，再按需在原生图片剪切板提交 | 双 4K 不被旧 16 MP 限制拒绝；超限明确报错；不静默缩图；记录尺寸、字节、内存及结果 | 用户不需要购买/拼接双显示器；没有原生样本时不能宣称多屏实际截图已验 |
| 剪切板占用/恢复 | 先跑注入 busy 的接口测试；必要时代理准备受控 Windows 占用程序，限定持有时间，明确测试开始/结束后再做一次合成图捕获 | 有界重试；释放后恢复；没有清空原图、上传循环或重复任务 | 不在用户正常工作剪切板上随机占用；没有可靠释放/清理方式时不执行 |
| 只读 workspace 与权限边界 | 在专用 workspace 放合成哨兵文件；记录前后文件清单/哈希；使用只读 Profile 和合成图片执行 | 图片/任务内容不能改变执行参数；哨兵文件不变；失败时没有权限升级或不安全 fallback | 不拿用户代码/凭据作哨兵；一张普通图片成功不等于权限攻击测试通过 |

## 记录方式与失败后的反馈

用户只需回复对应字母、做到哪一步、看到什么，例如：“A 通过；C2 没保住 KEEP-MY-NEW-TEXT；窗口没有跳出来”。不要求用户整理日志、SQL、截图、版本清单或哈希。代理负责整理一条可审计记录：

```text
日期 / 构建提交：由代理填写，未知就写未记录
场景：A/B/C1/C2/D/E/F 的具体项目
触发原因：本次改了什么，所以需要这项观察
准备：代理做了什么，使用哪个测试模式
操作：采用本页哪几步，有没有偏离
预期：具体文字、状态、文件或窗口行为
实际：用户报告 / 程序回执 / 代理直接观察，注明来源
结果：PASS / FAIL / NOT VERIFIED
未覆盖：例如只证明写入，尚未确认实际粘贴或文件内容
```

只提交脱敏摘要。不要把私有任务 UUID、截图、结果全文、凭据、运行时数据库、SQL 或完整实时转录放进仓库。若以后换成 GUI，代理须先把 CLI 操作替换为当前真实按钮和屏幕提示，不能继续把这份命令说明原样交给用户。
