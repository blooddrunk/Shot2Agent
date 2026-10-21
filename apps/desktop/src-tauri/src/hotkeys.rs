//! Fixed Windows RegisterHotKey bindings, owned by one native thread, independent of WebView.
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{mpsc, Mutex};
use std::time::Duration;
pub const ACTIONS: [&str; 5] = [
    "toggle-pause",
    "copy-latest",
    "retry-latest-delivery",
    "cycle-agent",
    "current",
];
type Bindings = BTreeMap<String, String>;
fn parse(value: &Value) -> Result<Bindings, String> {
    let object = value.as_object().ok_or("INVALID_HOTKEYS")?;
    if object.len() > 5 {
        return Err("INVALID_HOTKEYS".into());
    }
    let mut result = Bindings::new();
    for (action, value) in object {
        if !ACTIONS.contains(&action.as_str()) {
            return Err("ACTION_REFUSED".into());
        }
        let key = value.as_str().ok_or("INVALID_HOTKEY")?;
        decode(key)?;
        if result.values().any(|v| v == key) {
            return Err("DUPLICATE_HOTKEY".into());
        }
        result.insert(action.clone(), key.to_string());
    }
    Ok(result)
}
fn decode(key: &str) -> Result<(u32, u32), String> {
    let parts: Vec<_> = key.split('+').collect();
    if parts.len() != 3 || parts[2].len() != 1 {
        return Err("INVALID_HOTKEY".into());
    }
    let mods = match (parts[0], parts[1]) {
        ("Ctrl", "Alt") => 3,
        ("Ctrl", "Shift") => 6,
        ("Alt", "Shift") => 5,
        _ => return Err("INVALID_HOTKEY".into()),
    };
    let vk = parts[2].as_bytes()[0];
    if !vk.is_ascii_uppercase() && !vk.is_ascii_digit() {
        return Err("INVALID_HOTKEY".into());
    }
    Ok((mods, vk as u32))
}
fn id(key: &str) -> i32 {
    let (m, v) = decode(key).expect("validated");
    (0x4000 + (m << 8) + v) as i32
}
trait Registrar {
    fn register(&mut self, key: &str) -> bool;
    fn unregister(&mut self, key: &str);
}
fn replace(reg: &mut impl Registrar, old: &Bindings, next: &Bindings) -> Result<(), String> {
    let mut added = Vec::new();
    for key in next.values().filter(|key| !old.values().any(|v| v == *key)) {
        if !reg.register(key) {
            for key in added {
                reg.unregister(key);
            }
            return Err("HOTKEY_CONFLICT_OLD_BINDINGS_RETAINED".into());
        }
        added.push(key.as_str());
    }
    for key in old.values().filter(|key| !next.values().any(|v| v == *key)) {
        reg.unregister(key);
    }
    Ok(())
}
struct Request(Value, mpsc::SyncSender<Result<(), String>>);
pub struct Hotkeys {
    tx: mpsc::Sender<Request>,
    pub status: Mutex<String>,
}
impl Hotkeys {
    pub fn start(action: impl Fn(String) + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        std::thread::spawn(move || {
            #[cfg(windows)]
            {
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY,
                };
                struct Windows;
                impl Registrar for Windows {
                    fn register(&mut self, key: &str) -> bool {
                        let (mods, vk) = decode(key).expect("validated");
                        unsafe {
                            windows_sys::Win32::UI::Input::KeyboardAndMouse::RegisterHotKey(
                                std::ptr::null_mut(),
                                id(key),
                                mods | 0x4000,
                                vk,
                            ) != 0
                        }
                    }
                    fn unregister(&mut self, key: &str) {
                        unsafe {
                            windows_sys::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey(
                                std::ptr::null_mut(),
                                id(key),
                            );
                        }
                    }
                }
                let mut reg = Windows;
                let mut current = Bindings::new();
                loop {
                    match rx.recv_timeout(Duration::from_millis(10)) {
                        Ok(Request(value, reply)) => {
                            let result = parse(&value).and_then(|next| {
                                replace(&mut reg, &current, &next)?;
                                current = next;
                                Ok(())
                            });
                            let _ = reply.send(result);
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    unsafe {
                        let mut msg: MSG = std::mem::zeroed();
                        while PeekMessageW(
                            &mut msg,
                            std::ptr::null_mut(),
                            WM_HOTKEY,
                            WM_HOTKEY,
                            PM_REMOVE,
                        ) != 0
                        {
                            if let Some((name, _)) = current
                                .iter()
                                .find(|(_, key)| id(key) as usize == msg.wParam)
                            {
                                action(name.clone());
                            }
                        }
                    }
                }
                for key in current.values() {
                    reg.unregister(key);
                }
            }
            #[cfg(not(windows))]
            {
                let _ = action;
                for Request(value, reply) in rx {
                    let result = parse(&value).and_then(|v| {
                        if v.is_empty() {
                            Ok(())
                        } else {
                            Err("WINDOWS_HOTKEYS_REQUIRED".into())
                        }
                    });
                    let _ = reply.send(result);
                }
            }
        });
        Self {
            tx,
            status: Mutex::new("disabled".into()),
        }
    }
    pub fn configure(&self, value: Value) -> Result<(), String> {
        let disabled = value.as_object().map(|v| v.is_empty()).unwrap_or(false);
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx
            .send(Request(value, tx))
            .map_err(|_| "HOTKEY_THREAD_STOPPED")?;
        let result = rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "HOTKEY_THREAD_TIMEOUT")?;
        if let Ok(mut status) = self.status.lock() {
            *status = result
                .as_ref()
                .map(|_| if disabled { "disabled" } else { "registered" }.to_string())
                .unwrap_or_else(|e| e.clone());
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn validation_and_transactional_conflict() {
        for value in [
            json!({"exec":"Ctrl+Alt+X"}),
            json!({"current":"Win+L"}),
            json!({"current":"Ctrl+Alt+AA"}),
            json!({"current":"Ctrl+Alt+X", "copy-latest":"Ctrl+Alt+X"}),
        ] {
            assert!(parse(&value).is_err());
        }
        struct Mock {
            keys: Vec<String>,
        }
        impl Registrar for Mock {
            fn register(&mut self, k: &str) -> bool {
                if k.ends_with('Z') {
                    return false;
                }
                self.keys.push(k.into());
                true
            }
            fn unregister(&mut self, k: &str) {
                self.keys.retain(|v| v != k);
            }
        }
        let old = parse(&json!({"current":"Ctrl+Alt+X"})).unwrap();
        let next = parse(&json!({"current":"Ctrl+Alt+Z", "copy-latest":"Ctrl+Alt+Y"})).unwrap();
        let mut reg = Mock {
            keys: old.values().cloned().collect(),
        };
        assert!(replace(&mut reg, &old, &next).is_err());
        assert_eq!(reg.keys, vec!["Ctrl+Alt+X"]);
        replace(&mut reg, &old, &Bindings::new()).unwrap();
        assert!(reg.keys.is_empty());
    }
    #[cfg(windows)]
    #[test]
    fn native_conflict_and_release() {
        let first = Hotkeys::start(|_| {});
        let second = Hotkeys::start(|_| {});
        let binding = json!({"current":"Ctrl+Alt+9"});
        first.configure(binding.clone()).unwrap();
        assert!(second.configure(binding.clone()).is_err());
        first.configure(json!({})).unwrap();
        second.configure(binding).unwrap();
        second.configure(json!({})).unwrap();
    }
}
