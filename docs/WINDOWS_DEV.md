# Windows developer environment: Native vs WSL

**Recommendation: keep the main repository on Windows NTFS and use Windows-native terminals/toolchains.** Example: `D:\Projects\Shot2Agent` with PowerShell, Node.js, pnpm, VS Code and (later) the Rust MSVC toolchain.

Why: the first user-facing deliverable relies on Windows tray APIs, clipboard-image events, screenshot file-watch semantics, notifications, signed/unsigned installers and Windows paths. Tauri 2 on Windows uses the Microsoft C++ Build Tools, WebView2 and Rust MSVC. Running Windows build tools against source in `\\wsl$` adds cross-filesystem complexity.

Microsoft recommends storing files in the filesystem of the operating system where their development tools run. Avoid building Linux code from `/mnt/c` or Windows native code from `\\wsl$` when intensive file operations are involved.

References:
- https://learn.microsoft.com/en-us/windows/wsl/interop
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/learn/system-tray/
- https://v2.tauri.app/plugin/clipboard/

## Bootstrap commands (PowerShell)

```powershell
New-Item -ItemType Directory -Force D:\Projects | Out-Null
Set-Location D:\Projects
git clone https://github.com/blooddrunk/Shot2Agent.git
Set-Location .\Shot2Agent
node --version
npm test
```

The contract bootstrap currently needs only Node.js >=22.16 and npm. Before developing real applications, install Node.js active LTS, enable Corepack/pnpm matching `packageManager`, and generate a committed `pnpm-lock.yaml`. Once Tauri is added, install Rust MSVC toolchain, Visual Studio C++ Build Tools (Desktop development with C++ workload) and WebView2, then verify `cargo --version`, `rustc --version`, `pnpm --version` and an actual Windows Tauri build.

**Do not run** npm/pnpm, cargo, and app dev server for the *same checkout* interchangeably under Windows and WSL. In particular, do not share `node_modules` between OS environments.

## When to use WSL

- Run Linux deployment/container smoke tests against a **separate Linux-local checkout** such as `~/projects/Shot2Agent`.
- Inspect/reproduce production Linux service behavior, native Linux paths, process signals and SQLite persistence.
- Prefer a Linux CI job for backend reproducibility; WSL is optional, not a required baseline for developing the Windows capture app.

## Recommended test matrix

| Component | Main development/test environment | Additional verification |
| --- | --- | --- |
| Tray / clipboard / folder capture | Native Windows 11 | Windows CI and actual desktop session |
| Contracts / frontend / Node worker | Native Windows | Linux CI |
| VPS relay | Native Windows while coding | Linux container/CI and actual VPS smoke |
| Tauri build/installer | Native Windows MSVC | Fresh Windows test profile |

The repo is intended to work without WSL being installed.
