use serde_json::{json, Value};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;
#[derive(Default)]
pub struct Runtime {
    capture_busy: AtomicBool,
    capture_status: Mutex<String>,
    pub typing: crate::typing::Typing,
}
fn value(response: Result<Value, String>) -> Result<Value, String> {
    let response = response?;
    if response["ok"] != true {
        return Err(response["error"]
            .as_str()
            .unwrap_or("NATIVE_OPERATION_FAILED")
            .into());
    }
    Ok(response["value"].clone())
}
fn capture_tempfile() -> std::io::Result<tempfile::NamedTempFile> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("shot2agent-capture-").suffix(".png");
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_TEMPORARY, FILE_FLAG_DELETE_ON_CLOSE, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        // The OS deletes intermediate pixels even after process termination.
        // Share-delete permits the inherited coordinator to read while we own it.
        builder.make(|path| {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE)
                .open(path)
        })
    }
    #[cfg(not(windows))]
    {
        builder.tempfile()
    }
}
pub fn snapshot(app: &tauri::AppHandle) -> Value {
    let state = app.state::<Runtime>();
    json!({"typing":state.typing.snapshot(),"capturing":state.capture_busy.load(Ordering::SeqCst),"captureStatus":state.capture_status.lock().map(|v|v.clone()).unwrap_or_default()})
}
pub fn handle(
    app: &tauri::AppHandle,
    request: &Value,
    from_ui: bool,
) -> Option<Result<Value, String>> {
    let action = if request["command"] == "action" {
        request["action"].as_str()
    } else {
        request["command"].as_str()
    }?;
    if ![
        "capture-monitor",
        "type-latest",
        "type-result",
        "type-clipboard",
        "stop-typing",
        "native-monitors",
    ]
    .contains(&action)
    {
        return None;
    }
    let allowed = if action == "type-result" {
        vec!["v", "command", "id"]
    } else if request["command"] == "action" {
        vec!["v", "command", "action"]
    } else {
        vec!["v", "command"]
    };
    if request["v"] != 1
        || !request
            .as_object()?
            .keys()
            .all(|k| allowed.contains(&k.as_str()))
    {
        return Some(Err("COMMAND_REFUSED".into()));
    }
    let state = app.state::<Runtime>();
    let result = (|| {
        match action {
            "native-monitors" => return Ok(json!({"ok":true,"value":crate::capture::monitors()?})),
            "stop-typing" => state.typing.stop(),
            "capture-monitor" => {
                if state.capture_busy.swap(true, Ordering::SeqCst) {
                    return Err("CAPTURE_BUSY".into());
                }
                *state
                    .capture_status
                    .lock()
                    .map_err(|_| "NATIVE_STATE_LOCK")? = "capturing".into();
                let captured = (|| {
                    let options = value(super::call(
                        &app.state::<super::State>(),
                        json!({"v":1,"command":"capture-plan"}),
                    ))?;
                    let png = crate::capture::capture(options["monitor"].as_str().unwrap_or(""))?;
                    let mut temp = capture_tempfile().map_err(|_| "CAPTURE_STORAGE_FAILED")?;
                    temp.write_all(&png)
                        .and_then(|_| temp.as_file_mut().sync_all())
                        .map_err(|_| "CAPTURE_STORAGE_FAILED")?;
                    value(super::call(
                        &app.state::<super::State>(),
                        json!({"v":1,"command":"capture-ingest","path":temp.path().to_string_lossy(),"options":options}),
                    ))?;
                    Ok::<(), String>(())
                })();
                state.capture_busy.store(false, Ordering::SeqCst);
                *state
                    .capture_status
                    .lock()
                    .map_err(|_| "NATIVE_STATE_LOCK")? =
                    captured.as_ref().err().cloned().unwrap_or("saved".into());
                captured?;
            }
            _ => {
                #[cfg(windows)]
                let trigger_target = if from_ui {
                    None
                } else {
                    Some(crate::typing::platform::Window::selected()?)
                };
                let source = if action == "type-clipboard" {
                    #[cfg(windows)]
                    {
                        let s = value(super::call(
                            &app.state::<super::State>(),
                            json!({"v":1,"command":"snapshot"}),
                        ))?;
                        json!({"text":crate::typing::platform::clipboard_text()?,"delayMs":s["nativeOptions"]["delayMs"],"charsPerSecond":s["nativeOptions"]["charsPerSecond"]})
                    }
                    #[cfg(not(windows))]
                    {
                        return Err("WINDOWS_TYPING_REQUIRED".into());
                    }
                } else {
                    let req = if action == "type-result" {
                        json!({"v":1,"command":"typing-source","source":"history","id":request["id"]})
                    } else {
                        json!({"v":1,"command":"typing-source","source":"latest"})
                    };
                    value(super::call(&app.state::<super::State>(), req))?
                };
                #[cfg(windows)]
                if trigger_target
                    .as_ref()
                    .map(|w| !w.focused())
                    .unwrap_or(false)
                {
                    return Err("TYPING_FOCUS_CHANGED".into());
                }
                state.typing.start(
                    source["text"].as_str().ok_or("TYPING_EMPTY")?.into(),
                    source["delayMs"]
                        .as_u64()
                        .ok_or("INVALID_NATIVE_SETTINGS")?,
                    source["charsPerSecond"]
                        .as_u64()
                        .ok_or("INVALID_NATIVE_SETTINGS")?,
                    from_ui,
                )?;
            }
        }
        super::call(
            &app.state::<super::State>(),
            json!({"v":1,"command":"snapshot"}),
        )
    })();
    let label = if action == "type-result" {
        "type-history"
    } else {
        action
    };
    let status =
        result
            .as_ref()
            .err()
            .map(String::as_str)
            .unwrap_or(if action.starts_with("type-") {
                "preparing"
            } else {
                "succeeded"
            });
    let _ = super::call(
        &app.state::<super::State>(),
        json!({"v":1,"command":"native-feedback","action":label,"status":status}),
    );
    Some(result)
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn intermediate_capture_is_readable_and_deleted_on_close() {
        let mut file = capture_tempfile().unwrap();
        file.write_all(b"synthetic-pixels").unwrap();
        file.as_file_mut().sync_all().unwrap();
        let path = file.path().to_path_buf();
        assert_eq!(std::fs::read(&path).unwrap(), b"synthetic-pixels");
        drop(file);
        assert!(!path.exists());
    }
}
