#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
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
impl Bridge {
    fn start() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|_| "APP_PATH")?;
        let runtime = exe.parent().ok_or("APP_PATH")?.join("runtime");
        let staging = std::env::args().any(|a| a == "--staging");
        let root = std::env::var_os("LOCALAPPDATA").ok_or("WINDOWS_USER_SESSION_REQUIRED")?;
        let root = std::path::PathBuf::from(root).join(if staging {
            "Shot2Agent-M3-Acceptance"
        } else {
            "Shot2Agent"
        });
        let mut command = Command::new(runtime.join("node.exe"));
        command
            .arg(runtime.join("dist/packages/desktop/src/main.js"))
            .arg(root);
        if staging {
            command.arg("--staging");
        }
        command
            .current_dir(&runtime)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
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
            #[cfg(windows)]
            _job: job,
        })
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
                .map_err(|_| "COORDINATOR_TIMEOUT_RESTART_APP")?;
            serde_json::from_str(&line).map_err(|_| "COORDINATOR_PROTOCOL".to_string())
        })();
        if result.is_err() {
            self.broken = true;
            let _ = self.child.kill();
        }
        result
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
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
                let _ = tray.set_tooltip(Some(format!("Shot2Agent · {status}")));
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
            Ok::<(), String>(())
        })();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    tauri::Builder::default()
        .manage(State {
            bridge: Mutex::new(Bridge::start()),
        })
        .invoke_handler(tauri::generate_handler![rpc, hide_window])
        .setup(|app| {
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
                .tooltip("Shot2Agent · Local")
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
                    let _ = tray.set_tooltip(Some(format!("Shot2Agent · {status}")));
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
