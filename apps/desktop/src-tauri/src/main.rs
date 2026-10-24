#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod capture;
mod hotkeys;
mod native;
#[cfg(all(test, windows))]
mod native_api_tests;
mod tray;
mod typing;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
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
            "--smoke" | "--tray-smoke" => continue,
            _ => return Err("INVALID_LAUNCH_MODE"),
        };
        if mode.replace(next).is_some() {
            return Err("CONFLICTING_LAUNCH_MODE");
        }
    }
    if args.iter().any(|a| a == "--smoke" || a == "--tray-smoke") && mode != Some("staging") {
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
        let root = if mode == "staging" {
            // Every developer Fake launch gets a fresh disposable root.
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
    hotkey_transaction: Mutex<()>,
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
    if request["v"] == 1
        && (request["command"] == "stop-typing"
            || (request["command"] == "action" && request["action"] == "stop-typing"))
    {
        app.state::<native::Runtime>().typing.stop();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let transaction_state = app.state::<State>();
        let _transaction = transaction_state
            .hotkey_transaction
            .lock()
            .map_err(|_| "HOTKEY_TRANSACTION_LOCK")?;
        let is_quit = request.get("command").and_then(Value::as_str) == Some("quit");
        if request["command"] == "staging-fault" && request["kind"] == "coordinator" {
            if launch_mode(&std::env::args().skip(1).collect::<Vec<_>>())? != "staging" {
                return Err("STAGING_ONLY".into());
            }
            if let Ok(bridge) = transaction_state
                .bridge
                .lock()
                .map_err(|_| "COORDINATOR_LOCK")?
                .as_mut()
            {
                let _ = bridge.child.kill();
            }
            refresh_tray(&app);
            return Err("COORDINATOR_STOPPED_RESTART_APP".into());
        }

        let mut response =
            if request.get("command").and_then(Value::as_str) == Some("configure-hotkeys") {
                let state = app.state::<State>();
                let previous = call(&state, json!({"v":1,"command":"snapshot"}))?;
                let old = previous
                    .pointer("/value/hotkeys")
                    .cloned()
                    .ok_or("HOTKEY_SETTINGS_UNAVAILABLE")?;
                let native = app.state::<hotkeys::Hotkeys>();
                native.configure(request.get("hotkeys").cloned().ok_or("INVALID_HOTKEYS")?)?;
                let result = call(&state, request);
                if result
                    .as_ref()
                    .map(|r| r.get("ok") != Some(&Value::Bool(true)))
                    .unwrap_or(true)
                {
                    if native.configure(old).is_err() {
                        let _ = native.configure(json!({}));
                        return Err("HOTKEY_ROLLBACK_FAILED_DISABLED".into());
                    }
                }
                result
            } else if let Some(result) = native::handle(&app, &request, true) {
                result
            } else {
                call(&app.state::<State>(), request)
            };
        if is_quit {
            app.state::<native::Runtime>().typing.shutdown();
            app.state::<tray::Runtime>().shutdown();
            app.exit(0);
        }
        if let Ok(value) = response.as_mut() {
            if let Some(object) = value.get_mut("value").and_then(Value::as_object_mut) {
                object.insert("nativeRuntime".into(), native::snapshot(&app));
                object.insert(
                    "hotkeyStatus".into(),
                    json!(app
                        .state::<hotkeys::Hotkeys>()
                        .status
                        .lock()
                        .map(|v| v.clone())
                        .unwrap_or("HOTKEY_LOCK".into())),
                );
            }
        }
        refresh_tray(&app);
        let response = response?;
        Ok(response)
    })
    .await
    .map_err(|_| "COORDINATOR_JOIN")?
}
#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}
fn open_preview(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("window.dispatchEvent(new Event('shot2agent-open-preview'))");
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn refresh_tray(app: &tauri::AppHandle) {
    let runtime = app.state::<tray::Runtime>();
    let Ok(mut previous) = runtime.update.lock() else {
        return;
    };
    if *runtime.stop.0.lock().unwrap_or_else(|e| e.into_inner()) {
        return;
    }
    let response = call(&app.state::<State>(), json!({"v":1,"command":"snapshot"}));
    let mut view = tray::view(&response);
    let native = native::snapshot(app);
    view["menu"]["stopTyping"] = native["typing"]["active"].clone();
    if native["typing"]["active"] == true {
        view["feedback"] = json!(format!(
            "直接输入：{} / {} 字符 · Esc 停止",
            native["typing"]["sent"], native["typing"]["total"]
        ));
    } else if let Some(phase) = native["typing"]["phase"].as_str() {
        view["feedback"] = json!(format!("直接输入：{phase} · 打开应用查看详情"));
    }
    if native["capturing"] == true {
        view["feedback"] = json!("正在截取显示器…");
    }
    // Only cache a completed native update; a failed setter is retried next poll.
    if tray::apply(app, &view, previous.as_ref()).is_ok() {
        *previous = Some(view);
    }
}
fn tray_action(app: tauri::AppHandle, action: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let request = json!({"v":1,"command":"action","action":action});
        if native::handle(&app, &request, false).is_none() {
            let _ = call(&app.state::<State>(), request);
        }
        refresh_tray(&app);
    });
}
fn quit(app: tauri::AppHandle) {
    app.state::<native::Runtime>().typing.shutdown();
    app.state::<tray::Runtime>().shutdown();

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
            // Process-tree injection here is confined to the developer smoke's own child.
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
        .plugin(tauri_plugin_dialog::init())
        .manage(tray::Runtime::default())
        .manage(native::Runtime::default())
        .manage(State {
            hotkey_transaction: Mutex::new(()),
            bridge: Mutex::new(Bridge::start()),
        })
        .invoke_handler(tauri::generate_handler![rpc, hide_window])
        .setup(|app| {
            let handle = app.handle().clone();
            let busy = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let native = hotkeys::Hotkeys::start(move |action| {
                if action == "stop-typing" { handle.state::<native::Runtime>().typing.stop(); return; }
                if busy.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                let handle = handle.clone();
                let busy = busy.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let request=json!({"v":1,"command":"action","action":action});
                    if native::handle(&handle,&request,false).is_none() { let _=call(&handle.state::<State>(),request); }
                    refresh_tray(&handle);
                    busy.store(false, std::sync::atomic::Ordering::SeqCst);
                });
            });
            if let Ok(snapshot) = call(&app.state::<State>(), json!({"v":1,"command":"snapshot"})) {
                let _ = native.configure(
                    snapshot
                        .pointer("/value/hotkeys")
                        .cloned()
                        .unwrap_or(json!({})),
                );
            }
            app.manage(native);
            let mode =
                launch_mode(&std::env::args().skip(1).collect::<Vec<_>>()).unwrap_or("invalid");
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("Shot2Agent · {}", mode_label(mode)))?;
            }
            let initial = tray::offline();
            TrayIconBuilder::with_id("local")
                .icon(tauri::image::Image::new_owned(
                    tray::pixels("error", 32),
                    32,
                    32,
                ))
                .tooltip(initial["tooltip"].as_str().unwrap_or("Shot2Agent"))
                .menu(&tray::menu(app.handle(), &initial)?)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        open_preview(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => open_preview(app),
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "toggle-pause"
                    | "copy-latest"
                    | "retry-latest-delivery"
                    | "cycle-agent"
                    | "current" => tray_action(app.clone(), event.id.as_ref().to_string()),
                    "quit" => quit(app.clone()),
                    _ => {}
                })
                .build(app)?;
            if std::env::args().any(|a| a == "--tray-smoke") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let result = tray::native_smoke(&handle);
                    if let Ok(exe) = std::env::current_exe() { if let Some(dir) = exe.parent() {
                        let _ = std::fs::write(dir.join("TRAY-SMOKE.txt"), match &result { Ok(()) => "PASS native tray image/menu/tooltip setters, menu eligibility readback, update coalescing, offline and cleanup; visual appearance NOT VERIFIED".into(), Err(e) => format!("FAIL {e}") });
                    }}
                    handle.state::<tray::Runtime>().shutdown();
                    let _ = call(&handle.state::<State>(), json!({"v":1,"command":"quit"}));
                    let _ = std::fs::remove_dir_all(smoke_root());
                    handle.exit(if result.is_ok() { 0 } else { 1 });
                });
                return Ok(());
            }
            // Native polling continues while the WebView is hidden/throttled.
            // Setters marshal to Tauri's main thread; never block that thread on RPC.
            let handle = app.handle().clone();
            let stop = app.state::<tray::Runtime>().stop.clone();
            std::thread::spawn(move || loop {
                refresh_tray(&handle);
                let (lock, wake) = &*stop;
                let stopped = lock.lock().unwrap_or_else(|e| e.into_inner());
                if *stopped {
                    break;
                }
                let (stopped, _) = wake
                    .wait_timeout(stopped, Duration::from_secs(2))
                    .unwrap_or_else(|e| e.into_inner());
                if *stopped {
                    break;
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
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<native::Runtime>().typing.shutdown();
                app.state::<tray::Runtime>().shutdown();
                let _ = app.remove_tray_by_id("local");
                let _ = app.state::<hotkeys::Hotkeys>().configure(json!({}));
            }

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
        assert_eq!(
            launch_mode(&args(&["--staging", "--tray-smoke"])),
            Ok("staging")
        );
        assert_eq!(launch_mode(&args(&["--smoke", "--staging"])), Ok("staging"));
        for a in [
            &["--smoke"][..],
            &["--tray-smoke"],
            &["--codex", "--tray-smoke"],
            &["--staging", "--codex"],
            &["--root=private"],
            &["--codex", "--codex"],
        ] {
            assert!(launch_mode(&args(a)).is_err());
        }
    }
}
