//! Manual output only. Never clipboard-paste, refocus, retry or execute an Agent.
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
#[derive(Clone, Default)]
pub struct Typing {
    busy: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    closed: Arc<AtomicBool>,
    status: Arc<Mutex<Value>>,
}
#[derive(Debug, PartialEq)]
pub struct Key {
    pub vk: u16,
    pub scan: u16,
    pub flags: u32,
}
pub fn keys(c: char) -> Vec<Key> {
    let mut result = Vec::new();
    if c == '\n' {
        result.push(Key {
            vk: 13,
            scan: 0,
            flags: 0,
        });
        result.push(Key {
            vk: 13,
            scan: 0,
            flags: 2,
        });
    } else {
        let mut units = [0; 2];
        for unit in c.encode_utf16(&mut units).iter().copied() {
            result.push(Key {
                vk: 0,
                scan: unit,
                flags: 4,
            });
            result.push(Key {
                vk: 0,
                scan: unit,
                flags: 6,
            });
        }
    }
    result
}
trait Target {
    fn valid(&self) -> bool;
    fn send(&mut self, keys: &[Key]) -> Result<(), String>;
}
fn run(
    text: &str,
    target: &mut impl Target,
    cancel: impl Fn() -> bool,
    mut progress: impl FnMut(usize) -> Result<(), String>,
) -> Result<(), String> {
    for (i, c) in text.chars().enumerate() {
        if cancel() {
            return Err("TYPING_CANCELED".into());
        }
        if !target.valid() {
            return Err("TYPING_FOCUS_CHANGED".into());
        }
        target.send(&keys(c))?;
        progress(i + 1)?;
    }
    Ok(())
}
impl Typing {
    pub fn snapshot(&self) -> Value {
        self.status
            .lock()
            .map(|v| v.clone())
            .unwrap_or(json!({"phase":"TYPING_STATE_UNAVAILABLE"}))
    }
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
    pub fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.stop();
    }
    fn update(&self, phase: &str, sent: usize, total: usize) {
        if let Ok(mut s) = self.status.lock() {
            *s = json!({"phase":phase,"sent":sent,"total":total,"active":self.busy.load(Ordering::SeqCst)});
        }
    }
    fn canceled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst) || self.closed.load(Ordering::SeqCst)
    }
    fn wait(&self, until: Instant, check: impl Fn() -> bool) -> bool {
        while Instant::now() < until {
            if self.canceled() || !check() {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        !self.canceled() && check()
    }
    pub fn start(
        &self,
        text: String,
        delay: u64,
        speed: u64,
        select_after_delay: bool,
    ) -> Result<(), String> {
        if text.trim().is_empty() {
            return Err("TYPING_EMPTY".into());
        }
        if text.len() > 400_000 || text.contains('\0') {
            return Err("TYPING_TEXT_LIMIT".into());
        }
        if !(500..=10000).contains(&delay) || !(1..=200).contains(&speed) {
            return Err("INVALID_NATIVE_SETTINGS".into());
        }
        if self.closed.load(Ordering::SeqCst) {
            return Err("APP_CLOSED".into());
        }
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err("TYPING_BUSY".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        let this = self.clone();
        let text = text.replace("\r\n", "\n").replace('\r', "\n");
        let total = text.chars().count();
        this.update("preparing", 0, total);
        #[cfg(windows)]
        let initial = if select_after_delay {
            None
        } else {
            platform::Window::selected().ok()
        };
        std::thread::spawn(move || {
            let mut sent = 0;
            let result = (|| {
                #[cfg(windows)]
                {
                    let started = Instant::now();
                    if !select_after_delay && initial.is_none() {
                        return Err("TYPING_INVALID_TARGET".into());
                    }
                    if !this.wait(started + Duration::from_millis(delay), || {
                        if platform::escape() {
                            this.stop();
                            return false;
                        }
                        initial.as_ref().map(|w| w.focused()).unwrap_or(true)
                    }) {
                        return Err(if this.canceled() {
                            "TYPING_CANCELED"
                        } else {
                            "TYPING_FOCUS_CHANGED"
                        }
                        .into());
                    }
                    let mut target = match initial {
                        Some(w) => w,
                        None => platform::Window::selected()?,
                    };
                    if platform::modifiers() {
                        return Err("TYPING_RELEASE_MODIFIERS".into());
                    }
                    let observed = target.clone();
                    run(
                        &text,
                        &mut target,
                        || this.canceled() || platform::escape(),
                        |n| {
                            sent = n;
                            this.update("typing", n, total);
                            let until =
                                Instant::now() + Duration::from_secs_f64(1.0 / speed as f64);
                            if !this.wait(until, || {
                                !platform::escape() && observed.focused() && !platform::modifiers()
                            }) {
                                return Err(if !observed.focused() {
                                    "TYPING_FOCUS_CHANGED"
                                } else if platform::modifiers() {
                                    "TYPING_RELEASE_MODIFIERS"
                                } else {
                                    "TYPING_CANCELED"
                                }
                                .into());
                            }
                            if started.elapsed() >= Duration::from_secs(300) {
                                return Err("TYPING_TIME_LIMIT".into());
                            }
                            Ok(())
                        },
                    )
                }
                #[cfg(not(windows))]
                {
                    let _ = (&text, delay, speed, select_after_delay, &mut sent);
                    Err::<(), String>("WINDOWS_TYPING_REQUIRED".into())
                }
            })();
            if let Ok(mut status) = this.status.lock() {
                let phase = result.as_ref().err().map(String::as_str).unwrap_or("sent");
                *status = json!({"phase":phase,"sent":sent,"total":total,"active":false});
                this.busy.store(false, Ordering::SeqCst);
            }
        });
        Ok(())
    }
}
#[cfg(windows)]
pub mod platform {
    use super::*;
    use windows_sys::Win32::UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*};
    #[derive(Clone)]
    pub struct Window {
        top: usize,
        focus: usize,
    }
    pub fn escape() -> bool {
        unsafe { GetAsyncKeyState(VK_ESCAPE as i32) < 0 }
    }
    pub fn modifiers() -> bool {
        unsafe {
            [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
                .iter()
                .any(|k| GetAsyncKeyState(*k as i32) < 0)
        }
    }
    impl Window {
        pub fn selected() -> Result<Self, String> {
            unsafe {
                let top = GetForegroundWindow();
                let mut pid = 0;
                let thread = GetWindowThreadProcessId(top, &mut pid);
                let mut info: GUITHREADINFO = std::mem::zeroed();
                info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
                if top.is_null()
                    || thread == 0
                    || pid == std::process::id()
                    || GetGUIThreadInfo(thread, &mut info) == 0
                    || info.hwndFocus.is_null()
                {
                    return Err("TYPING_INVALID_TARGET".into());
                }
                Ok(Self {
                    top: top as usize,
                    focus: info.hwndFocus as usize,
                })
            }
        }
        pub fn focused(&self) -> bool {
            Self::selected()
                .map(|w| w.top == self.top && w.focus == self.focus)
                .unwrap_or(false)
        }
    }
    impl Target for Window {
        fn valid(&self) -> bool {
            self.focused() && !modifiers()
        }
        fn send(&mut self, keys: &[Key]) -> Result<(), String> {
            inject(keys)
        }
    }
    pub(crate) fn inject(keys: &[Key]) -> Result<(), String> {
        let inputs: Vec<INPUT> = keys
            .iter()
            .map(|k| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: k.vk,
                        wScan: k.scan,
                        dwFlags: k.flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            })
            .collect();
        if unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        } != inputs.len() as u32
        {
            // A partial insertion may leave a key down. Release only; never replay text.
            let ups: Vec<INPUT> = keys
                .iter()
                .filter(|k| k.flags & 2 != 0)
                .map(|k| INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: k.vk,
                            wScan: k.scan,
                            dwFlags: k.flags,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                })
                .collect();
            unsafe {
                SendInput(
                    ups.len() as u32,
                    ups.as_ptr(),
                    std::mem::size_of::<INPUT>() as i32,
                );
            }
            return Err("TYPING_INJECTION_FAILED".into());
        }
        Ok(())
    }
    pub fn clipboard_text() -> Result<String, String> {
        use windows::Win32::System::{DataExchange::*, Memory::*};
        unsafe {
            OpenClipboard(None).map_err(|_| "CLIPBOARD_BUSY")?;
            let result = (|| {
                let handle = GetClipboardData(13).map_err(|_| "TYPING_EMPTY")?;
                let len = GlobalSize(windows::Win32::Foundation::HGLOBAL(handle.0));
                if len == 0 || len > 800_002 {
                    return Err("TYPING_TEXT_LIMIT".into());
                }
                let ptr = GlobalLock(windows::Win32::Foundation::HGLOBAL(handle.0));
                if ptr.is_null() {
                    return Err("CLIPBOARD_BUSY".into());
                }
                let slice = std::slice::from_raw_parts(ptr as *const u16, len / 2);
                let end = slice.iter().position(|u| *u == 0).unwrap_or(slice.len());
                let text = String::from_utf16(&slice[..end])
                    .map_err(|_| "TYPING_INVALID_UNICODE".to_string());
                let _ = GlobalUnlock(windows::Win32::Foundation::HGLOBAL(handle.0));
                text
            })();
            let _ = CloseClipboard();
            result
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_and_shutdown_cancel_preparation_without_input() {
        let t = Typing::default();
        assert_eq!(
            t.start("  ".into(), 500, 60, true),
            Err("TYPING_EMPTY".into())
        );
        assert_eq!(
            t.start("x".repeat(400001), 500, 60, true),
            Err("TYPING_TEXT_LIMIT".into())
        );
        assert_eq!(
            t.start("x".into(), 499, 60, true),
            Err("INVALID_NATIVE_SETTINGS".into())
        );
        assert_eq!(
            t.start("x".into(), 500, 201, true),
            Err("INVALID_NATIVE_SETTINGS".into())
        );
        t.stop();
        assert!(!t.wait(Instant::now() + Duration::from_secs(1), || true));
        t.shutdown();
        assert_eq!(t.start("x".into(), 500, 60, true), Err("APP_CLOSED".into()));
    }
    #[test]
    fn unicode_newline_and_surrogates() {
        assert_eq!(
            keys('🧪')
                .iter()
                .filter(|k| k.flags == 4)
                .map(|k| k.scan)
                .collect::<Vec<_>>(),
            vec![0xd83e, 0xddea]
        );
        assert_eq!(
            keys('\n'),
            vec![
                Key {
                    vk: 13,
                    scan: 0,
                    flags: 0
                },
                Key {
                    vk: 13,
                    scan: 0,
                    flags: 2
                }
            ]
        );
        for c in "中文ABC !©\t```𠀀".chars() {
            assert_eq!(keys(c).len(), c.len_utf16() * 2);
        }
    }
    struct Mock {
        sent: Vec<u16>,
        left: usize,
        fail: bool,
    }
    impl Target for Mock {
        fn valid(&self) -> bool {
            self.left > 0
        }
        fn send(&mut self, keys: &[Key]) -> Result<(), String> {
            if self.fail {
                return Err("TYPING_INJECTION_FAILED".into());
            }
            self.sent
                .extend(keys.iter().filter(|k| k.flags & 2 == 0).map(|k| k.scan));
            self.left -= 1;
            Ok(())
        }
    }
    #[test]
    fn order_focus_cancel_and_failure_do_not_retry() {
        let mut m = Mock {
            sent: vec![],
            left: 2,
            fail: false,
        };
        assert_eq!(
            run("中ab", &mut m, || false, |_| Ok(())),
            Err("TYPING_FOCUS_CHANGED".into())
        );
        assert_eq!(m.sent, vec![0x4e2d, 97]);
        m.left = 10;
        assert_eq!(
            run("x", &mut m, || true, |_| Ok(())),
            Err("TYPING_CANCELED".into())
        );
        assert_eq!(m.sent.len(), 2);
        m.fail = true;
        assert_eq!(
            run("x", &mut m, || false, |_| Ok(())),
            Err("TYPING_INJECTION_FAILED".into())
        );
        assert_eq!(m.sent.len(), 2);
    }
}
