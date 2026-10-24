# Shot2Agent Local v1.0.2 — 发布验证记录

## 功能来源

- PR [#24](https://github.com/blooddrunk/Shot2Agent/pull/24)（功能源码 `4c2c3170f2dcc007438fbe8a8a6db55f04494175`）修复 Windows 原生 Codex CLI 探测、Junction 真实路径绑定及全局快捷键错误反馈。
- PR 同源码 [Node / Vue CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/40058956619) 和 [Windows Rust / portable CI](https://github.com/blooddrunk/Shot2Agent/actions/runs/40058956598) 均 PASS。
- 2026-10-24，新电脑原生验收由操作员报告 PASS；快捷键失败原因为快捷键冲突。此项为人工反馈，并不代表自动化涵盖所有真实系统组合。

## v1.0.2 正式版本门禁

发布工作流只接受 `main` 最新源码的明确版本请求，要求桌面 Tauri、Rust 包、Cargo.lock 和应用版本一致；等待相同源码提交的 Linux / Windows Node 22/24 及 Vue CI 全部成功。
Windows 打包流水线运行 Rust fmt、release tests、desktop:package、原生管道 / 凭据 / 托盘 / EXE smoke，完整解压便携 ZIP 并运行 portable-verify；发布工作流再次校验 ZIP SHA-256、ZIP CRC、BUILD.txt 源码提交和 MANIFEST.json 版本 / 源码字段。
只有以上步骤通过才会创建并公开 GitHub Release，附 ZIP、SHA256SUMS 和相关使用/验证文件。发布时的实际源码 SHA、流水线 URL、ZIP SHA-256 由工作流写入 Release 正文，避免在提交前虚构最终结果。

## 边界

测试采用 Fake / mock 与合成图片，不会使用真实 Token、用户截图或自动发起计费模型请求。正式 ZIP 的所有真实 DPI、Explorer UI 交互、真实模型通信没有被此次自动化新增覆盖；既有未修改功能的操作员验收仍按原记录保留。
