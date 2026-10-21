#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

struct Bridge {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<String>,
    broken: bool,
    phase: Arc<Mutex<String>>,
    #[cfg(windows)]
    _job: Job,
}
#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
fn contain(child: &Child) -> std::io::Result<Job> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let job = Job(CreateJobObjectW(std::ptr::null(), std::ptr::null()));
        if job.0.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &info as *const _ as _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
            || AssignProcessToJobObject(job.0, child.as_raw_handle()) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(job)
    }
}
fn diagnostic_phase(line: &str) -> Option<&'static str> {
    match line {
        "CODEX_SETUP_REQUIRED" => Some("CODEX_SETUP_REQUIRED"),
        "CODEX_PROFILE_REQUIRED" => Some("CODEX_PROFILE_REQUIRED"),
        "FAKE_ACCEPTANCE_PROFILE_REQUIRED" => Some("FAKE_ACCEPTANCE_PROFILE_REQUIRED"),
        "PHASE_PARENT_GATE" => Some("PHASE_PARENT_GATE"),
        "PHASE_COORDINATOR_INIT" => Some("PHASE_COORDINATOR_INIT"),
        "PHASE_CLIPBOARD_START" => Some("PHASE_CLIPBOARD_START"),
        "PHASE_SERVING" => Some("PHASE_SERVING"),
        _ => None,
    }
}
#[cfg(test)]
mod diagnostic_tests {
    use super::diagnostic_phase;
    #[test]
    fn untrusted_stderr_is_never_a_diagnostic() {
        for line in [
            "private clipboard text",
            "PHASE_SERVING secret",
            "PHASE_SERVING\nprivate",
            "Error: token=synthetic",
            "",
        ] {
            assert_eq!(diagnostic_phase(line), None);
        }
        assert_eq!(
            diagnostic_phase("PHASE_CLIPBOARD_START"),
            Some("PHASE_CLIPBOARD_START")
        );
    }
}
fn smoke_root() -> &'static std::path::PathBuf {
    static ROOT: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    ROOT.get_or_init(|| {
        std::env::temp_dir().join(format!(
            "shot2agent-smoke-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    })
}
// Fixed launch roots preserve old histories and never infer a different Profile.
fn launch_mode(args: &[String]) -> Result<&'static str, &'static str> {
    let mut mode = None;
    for arg in args {
        let next = match arg.as_str() {
            "--codex" => "codex",
            "--staging" => "staging",
            "--legacy" => "legacy",
            "--smoke" => continue,
            _ => return Err("INVALID_LAUNCH_MODE"),
        };
        if mode.replace(next).is_some() {
            return Err("CONFLICTING_LAUNCH_MODE");
        }
    }
    if args.iter().any(|a| a == "--smoke") && mode != Some("staging") {
        return Err("SMOKE_REQUIRES_STAGING");
    }
    Ok(mode.unwrap_or("codex"))
}
fn mode_label(mode: &str) -> &'static str {
    match mode {
        "staging" => "Fake acceptance",
        "legacy" => "Legacy Local",
        _ => "Local",
    }
}
impl Bridge {
    fn start() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|_| "APP_PATH")?;
        let runtime = exe.parent().ok_or("APP_PATH")?.join("runtime");
        let mode = launch_mode(&std::env::args().skip(1).collect::<Vec<_>>())?;
        let root = std::env::var_os("LOCALAPPDATA").ok_or("WINDOWS_USER_SESSION_REQUIRED")?;
        let root = if std::env::args().any(|a| a == "--smoke") {
            smoke_root().clone()
        } else {
            std::path::PathBuf::from(root).join(match mode {
                "staging" => "Shot2Agent-M3-Acceptance",
                "legacy" => "Shot2Agent",
                _ => "Shot2Agent-Codex",
            })
        };
        let mut command = Command::new(runtime.join("node.exe"));
        command
            .arg(runtime.join("dist/packages/desktop/src/main.js"))
            .arg(root)
            .arg(format!("--{mode}"));
        command
            .current_dir(&runtime)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "COORDINATOR_START_FAILED_CHECK_RUNTIME")?;
        #[cfg(windows)]
        let job = match contain(&child) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.kill();
                return Err("PROCESS_CONTAINMENT_FAILED".into());
            }
        };
        // Keep only bounded, known phase codes; never expose arbitrary child stderr.
        let phase = Arc::new(Mutex::new("NODE_START".to_string()));
        let observed = phase.clone();
        let stderr = child.stderr.take().ok_or("COORDINATOR_PIPE")?;
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            loop {
                let mut line = String::new();
                if reader.by_ref().take(129).read_line(&mut line).is_err() || line.is_empty() {
                    break;
                }
                if !line.ends_with('\n') {
                    break;
                }
                let code = line.trim();
                if let Some(code) = diagnostic_phase(code) {
                    if let Ok(mut value) = observed.lock() {
                        *value = code.to_string();
                    }
                }
            }
        });
        let mut input = child.stdin.take().ok_or("COORDINATOR_PIPE")?;
        input
            .write_all(b"SHOT2AGENT/1\n")
            .map_err(|_| "COORDINATOR_HANDSHAKE")?;
        let stdout = child.stdout.take().ok_or("COORDINATOR_PIPE")?;
        let (tx, output) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                if reader
                    .by_ref()
                    .take(2_000_001)
                    .read_line(&mut line)
                    .is_err()
                    || line.is_empty()
                    || line.len() > 2_000_000
                    || !line.ends_with('\n')
                {
                    break;
                }
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            input,
            output,
            broken: false,
            phase,
            #[cfg(windows)]
            _job: job,
        })
    }
    fn stop_tree(&mut self) {
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self._job.0, 1);
        }
        let _ = self.child.kill();
    }
    fn request(&mut self, request: Value) -> Result<Value, String> {
        if self.broken {
            return Err("COORDINATOR_STOPPED_RESTART_APP".into());
        }
        let bytes = serde_json::to_vec(&request).map_err(|_| "INVALID_REQUEST")?;
        if bytes.len() > 65535 {
            return Err("REQUEST_TOO_LARGE".into());
        }
        let result = (|| {
            self.input
                .write_all(&bytes)
                .and_then(|_| self.input.write_all(b"\n"))
                .and_then(|_| self.input.flush())
                .map_err(|_| "COORDINATOR_PIPE_CLOSED")?;
            let line = self
                .output
                .recv_timeout(Duration::from_secs(20))
                .map_err(|error| {
                    let stage = self
                        .phase
                        .lock()
                        .map(|p| p.clone())
                        .unwrap_or("UNKNOWN".into());
                    let operation = request
                        .get("command")
                        .and_then(Value::as_str)
                        .filter(|s| ["snapshot", "quit", "exec"].contains(s))
                        .unwrap_or("request");
                    match error {
                        mpsc::RecvTimeoutError::Timeout => {
                            format!("COORDINATOR_TIMEOUT_{stage}_{operation}")
                        }
                        mpsc::RecvTimeoutError::Disconnected => {
                            format!("COORDINATOR_EXIT_{stage}_{operation}")
                        }
                    }
                })?;
            serde_json::from_str(&line).map_err(|_| "COORDINATOR_PROTOCOL".to_string())
        })();
        if result.is_err() {
            self.broken = true;
            self.stop_tree();
        }
        result
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.stop_tree();
        let _ = self.child.wait();
    }
}
struct State {
    bridge: Mutex<Result<Bridge, String>>,
}
fn call(state: &State, request: Value) -> Result<Value, String> {
    let mut guard = state.bridge.lock().map_err(|_| "COORDINATOR_LOCK")?;
    match guard.as_mut() {
        Ok(bridge) => bridge.request(request),
        Err(error) => Err(error.clone()),
    }
}
#[tauri::command]
async fn rpc(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let is_quit = request.get("command").and_then(Value::as_str) == Some("quit");
        let response = call(&app.state::<State>(), request);
        if is_quit {
            app.exit(0);
        }
        let response = response?;
        if let Some(status) = response.pointer("/value/status").and_then(Value::as_str) {
            if let Some(tray) = app.tray_by_id("local") {
                let _ = tray.set_tooltip(Some(format!(
                    "Shot2Agent · {} · {status}",
                    mode_label(
                        launch_mode(&std::env::args().skip(1).collect::<Vec<_>>())
                            .unwrap_or("invalid")
                    )
                )));
            }
        }
        Ok(response)
    })
    .await
    .map_err(|_| "COORDINATOR_JOIN")?
}
#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}
fn quit(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = call(&app.state::<State>(), json!({"v":1,"command":"quit"}));
        app.exit(0);
    });
}
fn main() {
    if std::env::args().any(|a| a == "--smoke") {
        let result = (|| {
            let mut bridge = Bridge::start()?;
            let snapshot = bridge.request(json!({"v":1,"command":"snapshot"}))?;
            if snapshot.get("ok") != Some(&Value::Bool(true)) {
                return Err("SNAPSHOT_FAILED".to_string());
            }
            let refused =
                bridge.request(json!({"v":1,"command":"exec","executable":"forbidden"}))?;
            if refused.get("ok") != Some(&Value::Bool(false)) {
                return Err("ALLOWLIST_FAILED".to_string());
            }
            let stop = bridge.request(json!({"v":1,"command":"quit"}))?;
            if stop.get("ok") != Some(&Value::Bool(true)) {
                return Err("STOP_FAILED".to_string());
            }
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(status) = bridge.child.try_wait().map_err(|_| "WAIT_FAILED")? {
                    if !status.success() {
                        return Err("UNCLEAN_COORDINATOR_EXIT".into());
                    }
                    break;
                }
                if std::time::Instant::now() > deadline {
                    return Err("COORDINATOR_DID_NOT_EXIT".into());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            drop(bridge);
            // Fault injection stays inside developer smoke, never in the UI/IPC command set.
            let mut interrupted = Bridge::start()?;
            interrupted.request(json!({"v":1,"command":"snapshot"}))?;
            let _ = interrupted.child.kill();
            if interrupted
                .request(json!({"v":1,"command":"snapshot"}))
                .is_ok()
            {
                return Err("DEAD_COORDINATOR_NOT_DETECTED".into());
            }
            #[cfg(windows)]
            {
                use windows_sys::Win32::System::JobObjects::*;
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                loop {
                    let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION =
                        unsafe { std::mem::zeroed() };
                    let ok = unsafe {
                        QueryInformationJobObject(
                            interrupted._job.0,
                            JobObjectBasicAccountingInformation,
                            &mut info as *mut _ as _,
                            std::mem::size_of_val(&info) as u32,
                            std::ptr::null_mut(),
                        )
                    };
                    if ok == 0 {
                        return Err("JOB_QUERY_FAILED".into());
                    }
                    if info.ActiveProcesses == 0 {
                        break;
                    }
                    if std::time::Instant::now() > deadline {
                        return Err("DESCENDANTS_STILL_RUNNING".into());
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
            Ok::<(), String>(())
        })();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let _ = std::fs::write(dir.join("SMOKE.txt"), match &result { Ok(()) => "PASS packaged IPC, refusal, natural quit, unexpected coordinator death and descendant cleanup".to_string(), Err(error) => format!("FAIL {error}") });
            }
        }
        let _ = std::fs::remove_dir_all(smoke_root());
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    tauri::Builder::default()
        .manage(State {
            bridge: Mutex::new(Bridge::start()),
        })
        .invoke_handler(tauri::generate_handler![rpc, hide_window])
        .setup(|app| {
            let mode =
                launch_mode(&std::env::args().skip(1).collect::<Vec<_>>()).unwrap_or("invalid");
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("Shot2Agent · {}", mode_label(mode)))?;
            }
            let show = MenuItem::with_id(app, "show", "Show Shot2Agent", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause capture", true, None::<&str>)?;
            let resume = MenuItem::with_id(app, "resume", "Resume capture", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "quit", "Quit Shot2Agent", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &pause, &resume, &exit])?;
            let mut pixels = vec![0u8; 32 * 32 * 4];
            for y in 4..28 {
                for x in 4..28 {
                    let i = (y * 32 + x) * 4;
                    pixels[i..i + 4].copy_from_slice(if x < 8 || x > 23 || y < 8 || y > 23 {
                        &[39, 99, 76, 255]
                    } else {
                        &[246, 248, 245, 255]
                    });
                }
            }
            TrayIconBuilder::with_id("local")
                .icon(tauri::image::Image::new_owned(pixels, 32, 32))
                .tooltip(format!("Shot2Agent · {}", mode_label(mode)))
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "pause" | "resume" => {
                        let a = app.clone();
                        let paused = event.id.as_ref() == "pause";
                        tauri::async_runtime::spawn_blocking(move || {
                            let _ = call(
                                &a.state::<State>(),
                                json!({"v":1,"command":"pause","paused":paused}),
                            );
                        });
                    }
                    "quit" => quit(app.clone()),
                    _ => {}
                })
                .build(app)?;
            // Tray status stays live even when WebView timers are throttled while hidden.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(2));
                let response = call(
                    &handle.state::<State>(),
                    json!({"v":1,"command":"snapshot"}),
                );
                let status = response
                    .as_ref()
                    .ok()
                    .and_then(|r| r.pointer("/value/status"))
                    .and_then(Value::as_str)
                    .unwrap_or("coordinator unavailable; quit and restart");
                if let Some(tray) = handle.tray_by_id("local") {
                    let _ = tray.set_tooltip(Some(format!(
                        "Shot2Agent · {} · {status}",
                        mode_label(
                            launch_mode(&std::env::args().skip(1).collect::<Vec<_>>())
                                .unwrap_or("invalid")
                        )
                    )));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Shot2Agent startup failed")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
                quit(app.clone());
            }
        });
}

#[cfg(test)]
mod launch_tests {
    use super::*;
    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn fixed_launch_modes_fail_closed() {
        assert_eq!(launch_mode(&args(&[])), Ok("codex"));
        assert_eq!(launch_mode(&args(&["--legacy"])), Ok("legacy"));
        assert_eq!(launch_mode(&args(&["--smoke", "--staging"])), Ok("staging"));
        for a in [
            &["--smoke"][..],
            &["--staging", "--codex"],
            &["--root=private"],
            &["--codex", "--codex"],
        ] {
            assert!(launch_mode(&args(a)).is_err());
        }
    }
}
