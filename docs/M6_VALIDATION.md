# M6-L validation — 2026-10-21

Implementation candidate 0.6.0. The final source SHA, remote matrix/package run IDs and artifact hash are published in the implementation PR and final report. Only completed successful runs for that exact source establish a gate. This file records observed boundaries, not unexecuted acceptance as PASS.

## Prerequisite repaired independently

PR #9's consent gap was repaired at `dfc0571c1d7e0cdb972d934e86260cdf491fe399`: one shared `effectiveDelivery()` is used by CLI clipboard creation/LocalApp and desktop construction/reconfiguration. Desktop-created Always without consent becomes manual. Explicit legacy M2 CLI Always remains intact; old Smart guards remain sticky. A real CLI child processes a Fake task in a disposable root; simulated clipboard covers unconsented/consented/legacy and Smart receipt cases.

Corrected-head PR checks: [matrix 39572288833](https://github.com/blooddrunk/Shot2Agent/actions/runs/39572288833) and [Windows package 39572288742](https://github.com/blooddrunk/Shot2Agent/actions/runs/39572288742) succeeded. Duplicate push-triggered runs were cancelled by concurrency, not test failures. PR #9 merged as `e038827c573ec42234d7377b8f72d386d975f055`; independent post-merge [main matrix 39572983167](https://github.com/blooddrunk/Shot2Agent/actions/runs/39572983167) and [main Windows package 39572983269](https://github.com/blooddrunk/Shot2Agent/actions/runs/39572983269) succeeded. M6 remains a separate candidate.

The initial local PR #9 full check failed because the new regression's cleanup closed its own SQLite handles twice. Fixed that test cleanup; its targeted rerun passed before commit. Remote final-head and post-merge checks above independently passed; the failed local run is not relabeled successful.

## Added automated coverage

- Native hotkey parser: fixed action allowlist, limited modifier/key grammar, duplicate rejection; registrar transaction tests retain old keys on conflict and release all. Windows test uses two native owner threads to check actual RegisterHotKey conflict/release/re-registration, without injecting keystrokes or reading personal clipboard.
- Coordinator subprocess actions: atomic pause toggle, historical startup image suppression, missing result/Agent/no eligible retry, bad/extra command refusal, hotkey persistence across restart, explicit submit, latest successful copy.
- Latest result uses persisted `result.finishedAt`, deterministic UUID tie break and all pages. Newer queued/failed tasks cannot hide the completed output. History explicitly sorts persisted creation time.
- Delivery action retries only enabled failed channels; skips succeeded/manual/disabled/pending/interrupted/ambiguous/conflict channels. A sibling interrupted clipboard receipt remains untouched while save retries. Agent call count remains unchanged. Existing independent Smart and no-clobber suites remain required.
- Gateway validates explicit HTTPS host/path allowlist, no URL credentials/query/port, bounded models/mappings and credential reference; preserves distinct provider/fingerprint on failure, rejects unverified vision before secret/model access, rejects text-only aliases, auth-kind mismatch and changed bindings.
- Mock CLI -> loopback Mock API asserts exact token env and selected endpoint/model/mappings, no inherited OAuth/API key/proxy, private home, unchanged restricted/safe-mode/tools/MCP flags, typed image block byte equality and text/image order. Mock HTTP 401, malformed final, secret echo, missing credential and policy refusal remain safe failures. These are synthetic fixtures, not real HTTPS/model evidence.
- Windows secure-store tests use unique disposable credential targets only: missing-reference refusal, add/read/delete and replacement refusal. No existing personal credentials accessed. Linux deliberately refuses OS storage.

## Independently observed native Claude Gateway transport

Windows Node + installed official native Claude `2.1.305 (Claude Code)` executed `scripts/claude-gateway-windows-probe.mjs` against a synthetic loopback API with an empty disposable HOME/config. Exit 0, `imageSeen:true, modelSeen:true, authSeen:true, calls:1, finalType:result, subtype:success, isError:false, transportMarker:true, secretOnDisk:false`. The native CLI accepted `--setting-sources ''`, explicit GLM model and AUTH_TOKEN; its request contained the exact synthetic typed image and selected model. A file scan of the disposable home did not find the synthetic credential. No actual model or personal authentication was used. Fixture response text is not recognized image text.

The same M6 probe also passed on the official native 2.1.306 executable extracted into a unique temporary Windows path from the existing package archive (temporary copy removed afterward). Both versions have new AUTH_TOKEN/model/setting-sources transport evidence. Other gateway versions refuse. Two earlier copy attempts accidentally selected a text fixture at a similarly named local path and failed to spawn; those were not native CLI failures and are not counted as qualification. Real GLM availability, key region, HTTPS authentication/certificate/redirect policy and model vision remain independent NOT VERIFIED gates.

## Local environment and commands

Required `corepack pnpm install --frozen-lockfile` completed successfully (pnpm 10.19.0, frozen lockfile unchanged). The full candidate local `npm run check` passed at the earlier 166-test candidate (150 PASS / 16 native SKIP / 0 FAIL), including lint, TS/Vue, build/UI and compiled Local smoke. Subsequent final-head verification is reported with its exact remote SHA. Browser rendering was inspected with synthetic IPC data at 1040x760 and 720x560; Impeccable detector returned no findings. Browser tests do not prove native hotkeys/focus/paste. `npm test` baseline was started before changes; full candidate checks run lint, TS/Vue typecheck, all Node tests, build/UI and compiled smoke. See final PR for completed final counts and exit statuses; partial running logs do not count as PASS. `git diff --check` and Rust formatting are required before delivery.

Local WSL `cargo check` was attempted and blocked by missing system development packages (`libdbus-1-dev` / pkg-config); no system packages were installed. Windows Rust compile/tests/package/EXE smoke use CI, not this Linux attempt as proof.

## Boundaries and remaining observations

No operator credential/root/history/screenshot/task was modified; all probes use synthetic data/disposable config. No real paid model request, failover, permission bypass, tools, Hooks or MCP added. Gateway uses a separate approved Profile, credential lookup and empty child home, preserves machine/remote-policy refusal, and never inherits personal subscription auth. The two accepted HTTPS endpoint configurations rely on the pinned native CLI's TLS/network implementation; the live endpoint redirect behavior has not been qualified here. Default vision remains `not-verified` and refuses. `--attest-vision` is an explicit stopped-Worker operator assertion requiring external evidence; it is never automatic proof or task-controlled permission.

M6 global-action acceptance steps 1–6 are operator-reported PASS; see the scoped record below. True GLM OCR and Gateway live authentication remain NOT VERIFIED. Follow [short executable Windows steps](M6_WINDOWS_ACCEPTANCE.md). Missing cost consent is not a test failure or vision PASS. M3 operator reports and unresolved Smart conflicts retain their original scope; no input-method fix is claimed. No M6 merged-main success unless merged and independently checked later.

## Evidence-driven Windows stabilization

At initial M6 SHA `6e295966c68002810373c0c7ce8c3fd7bc2fc6e3`, Linux Node 22/24 passed and [Windows Rust/build/package/actual EXE smoke](https://github.com/blooddrunk/Shot2Agent/actions/runs/39574790346) passed, but [matrix 39574790699](https://github.com/blooddrunk/Shot2Agent/actions/runs/39574790699) failed Windows. Node 22 recorded three `CLI_HASH_TIMEOUT` cases plus synthetic secure-store creation refusal. These failures are not relabeled PASS. Hash reads now use 1 MiB chunks instead of 64 KiB while retaining the existing 3-second/512-MiB limits, path checks and digest computation. Credential P/Invoke now captures Win32 error codes inside the same C# call, before PowerShell/.NET can overwrite thread last-error; only fixed numeric diagnostics are exposed. No storage fallback or permission expansion is added.

The isolated Windows credential suite was split from Sharp-dependent image tests and independently executed using Windows Node 24.20.0: 2 PASS / 0 FAIL / 0 SKIP (unique disposable add/read/replacement-refusal/delete plus missing-reference refusal). A prior attempt to run the whole image test module with Windows Node against WSL-installed dependencies failed at import because Windows could not resolve Sharp; that did not execute the credential tests. The standalone run requires no dependency install or operator authentication. Fresh final-head Windows CI is required to establish the hosted correction.

The final display pass also corrects Gateway provider labeling and shows the task-bound endpoint/model in result details. Existing subscription checks and task execution are unchanged.

A final end-to-end Gateway refusal regression submits a synthetic image through LocalApp/Task Core, completes exactly one failed attempt, and verifies the durable submission/result adapter provenance. This exposed and corrected the shared contract provider allowlist to include `claude-compatible-endpoint`; unknown provider values still refuse. The contracts + Gateway targeted run passed 17/17. Malformed present desktop consent (`desktop:null`) also remains manual in CLI, while truly legacy configs without the desktop field retain explicit Always semantics.

At `4af7713` the hash timeouts were gone in both Windows Node jobs; only credential creation failed. Added safe phase diagnostics at `ace0fc1` located the exception at `PROMPT` (`-2146233087`), rather than a failed CredWrite OS status. The synthetic prompt fixture now explicitly loads Microsoft.PowerShell.Utility before replacing Read-Host, to avoid child-script command autoload shadowing the test prompt. This is a test-host correction; the default operator entry still uses a hidden interactive token prompt. Local native lifecycle tests passed again 2/2. Only the subsequent final-head hosted run can establish that this fixes CI; earlier failing runs remain failures.

The module-preload attempt at `a356de6` still failed in hosted CI at PROMPT, so it was not accepted as a fix. The final test removes prompt mocking and supplies the synthetic token over a bounded private redirected stdin pipe to the same OS-store add path. The script refuses pipe mode for read/delete and refuses non-redirected/oversized input; no token argument, environment variable, file, plaintext storage or fallback is introduced. Normal CLI `credential-add` still uses the masked prompt. The private-pipe native lifecycle suite passed locally 2/2. Hosted final-head results remain independently required.

The early preflight at `5c8a6d1` identified `PIPE_CONVERT / CommandNotFoundException`: the native Windows PowerShell child could not resolve ConvertTo-SecureString under the inherited caller environment. The helper now receives only Windows system/user-directory variables and an explicit **system Windows PowerShell Modules** path, excluding caller/user module paths and unrelated credentials. This also prevents module autoload from resolving user-owned implementations during secret handling. The regression sets an invalid parent PSModulePath and requires the pinned native helper to complete the disposable lifecycle. No policy bypass or plaintext persistence is used. Subsequent final-head CI and package results are authoritative, not the earlier failed prompt hypotheses.

Pinning the helper module path alone (`fcf9a98`) removed the prior explicit cmdlet error but hit the existing startup deadline in hosted CI, so it was not counted as a pass. The final helper environment retains the full standard Windows startup variables (including ComSpec/SystemDrive/architecture) while excluding unrelated credential variables and caller module paths. Private-pipe input now constructs a .NET SecureString character-by-character with an ASCII/length bound, eliminating both ConvertTo-SecureString autoload and the temporary full plaintext StringBuilder. The production masked prompt and native CredWrite/Read/Delete behavior remain unchanged; no timeout or permission limit is widened.

The restricted helper-environment attempt at `8c99abd` also exceeded the unchanged hosted startup deadline. The final fixed OS helper therefore preserves the normal Windows host environment, matching the existing fixed native policy-helper exception, while excluding provider credential variables and Node injection variables. It no longer overrides PowerShell module discovery; pipe mode no longer needs the Security cmdlet at all. This exception applies only to the fixed credential script with validated actions/reference. Claude model children still get their independent strict environment allowlist and empty home. The unsuccessful restricted-environment attempts are not accepted as release evidence; the final native lifecycle and complete matrix must pass.

## 操作人员验收反馈 — 2026-10-21

操作人员按 [M6 Windows 中文验收步骤](M6_WINDOWS_ACCEPTANCE.md)中“使用 Fake 验收全局操作”的编号反馈：1、2、3、4、5、6 均为 **PASS（操作人员报告）**。这为对应的 Windows 交互行为补充人工观察证据，不作为开发代理独立复测或新增 CI 证据。

| 步骤 | 验收范围 | 反馈 |
| --- | --- | --- |
| 1 | 全局快捷键配置、注册及单独启停 | PASS |
| 2 | 隐藏到托盘后复制最新成功结果、实际粘贴及前台焦点保持 | PASS |
| 3 | 暂停/恢复捕获及旧剪贴板图片不重新触发 | PASS |
| 4 | 仅重试符合条件的失败投递，不再次调用 Agent | PASS |
| 5 | 配置跨重启保留及退出后解除快捷键注册 | PASS |
| 6 | 无效或冲突快捷键拒绝，并保留原配置 | PASS |

反馈未另列具体测试环境、程序包 SHA、操作日志或各步骤中可选分支的执行情况，因此不额外推断可选的显式提交、多个已批准 Agent 的循环切换、实际系统冲突占用及特定故障注入分支均已单独观察。步骤整体 PASS 按原反馈记录。

本次反馈仅覆盖上述编号步骤，不包含后续 Gateway 凭据配置、原生传输探测或真实模型验收。真实端点认证、非交互式真实请求、真实图片传输、目标模型视觉能力及合成截图文字识别仍为 **NOT VERIFIED（未验证）**；未获得真实付费模型调用授权。现有 Smart 冲突仍未解决。PR 合并后 main 的独立验证也不能由本次操作人员反馈替代。

## GLM-5.3-Flash model classification correction

The operator configured `glm-5.3-flash` and reported `GATEWAY_MODEL_VISION_UNSUPPORTED`. The local guard only recognized GLM-4.6V variants. [Official GLM-5.3-Flash documentation](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) explicitly lists image input; the guard now also recognizes the exact `glm-5.3-flash` ID. All three aliases remain individually checked; unknown names still refuse. This is model classification, not endpoint qualification. A `not-verified` Profile continues to refuse with `GATEWAY_VISION_NOT_VERIFIED`; no credential access, real request or operator attestation was performed by this correction. Existing distributed packages do not contain the source correction until rebuilt.

Correction verification: `corepack pnpm install --frozen-lockfile`, full local `npm run check` and `git diff --check` passed. Node tests: 168 total, 152 PASS, 16 native SKIP, 0 FAIL; lint, TS/Vue checks, build/UI and compiled Fake smoke passed. No new Windows CI/package or live endpoint/model evidence is claimed for this uncommitted correction.

Delivery follow-up: acceptance examples, automated Gateway image fixtures and the native-to-Mock probe now target `glm-5.3-flash`. The probe also accepts an explicit model argument and reports the selected model; normal Gateway Profiles already accept explicit model and individual alias parameters. Existing GLM-4.6V compatibility remains for existing Profiles without changing their bindings. The revised targeted Gateway tests passed 10/10; fresh hosted matrix/package checks are required for this delivery.
