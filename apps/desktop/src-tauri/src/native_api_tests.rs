//! Explicitly ignored in ordinary runs: only a seeded disposable hosted desktop.
use std::time::{Duration, Instant};
use windows_sys::Win32::{
    Foundation::HWND,
    System::DataExchange::GetClipboardSequenceNumber,
    UI::{Input::KeyboardAndMouse::SetFocus, WindowsAndMessaging::*},
};
struct Window(HWND);
impl Drop for Window {
    fn drop(&mut self) {
        unsafe {
            DestroyWindow(self.0);
        }
    }
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
unsafe fn pump() {
    let mut msg: MSG = std::mem::zeroed();
    while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}
unsafe fn text(hwnd: HWND) -> String {
    let n = GetWindowTextLengthW(hwnd);
    let mut units = vec![0u16; n as usize + 1];
    let len = GetWindowTextW(hwnd, units.as_mut_ptr(), units.len() as i32);
    String::from_utf16(&units[..len as usize]).unwrap()
}
#[test]
#[ignore = "explicit hosted desktop only; scripts/windows/native-api-smoke.mjs seeds synthetic clipboard"]
fn hosted_window_capture_and_unicode() {
    eprintln!("NATIVE_TEST_CLIPBOARD");
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    assert_eq!(
        crate::typing::platform::clipboard_text().unwrap(),
        "M11 synthetic clipboard sentinel 中文 🧪"
    );
    let before = unsafe { GetClipboardSequenceNumber() };
    let monitors = crate::capture::monitors().unwrap();
    eprintln!("NATIVE_TEST_MONITORS");
    let monitor = monitors
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["primary"] == true)
        .unwrap();
    let (width, height) = (
        monitor["width"].as_i64().unwrap() as i32,
        monitor["height"].as_i64().unwrap() as i32,
    );
    unsafe {
        // A full-screen opaque synthetic EDIT covers the hosted primary monitor.
        let window = Window(CreateWindowExW(
            WS_EX_TOPMOST,
            wide("EDIT").as_ptr(),
            wide("M11 synthetic desktop 中文 ASCII").as_ptr(),
            WS_POPUP | WS_VISIBLE | ES_MULTILINE as u32 | ES_AUTOVSCROLL as u32,
            0,
            0,
            width,
            height,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        ));
        assert!(!window.0.is_null());
        ShowWindow(window.0, SW_SHOW);
        SetForegroundWindow(window.0);
        SetFocus(window.0);
        let ready = Instant::now() + Duration::from_millis(200);
        while Instant::now() < ready {
            pump();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(GetForegroundWindow(), window.0);
        eprintln!("NATIVE_TEST_WINDOW_READY");
        // The production target selector refuses this own-process test window.
        assert!(crate::typing::platform::Window::selected().is_err());
        assert!(crate::capture::capture("synthetic-removed-monitor").is_err());
        eprintln!("NATIVE_TEST_CAPTURE");
        let png = crate::capture::capture(monitor["id"].as_str().unwrap())
            .expect("hosted WGC must produce a real frame");
        let mut reader = png::Decoder::new(std::io::Cursor::new(png))
            .read_info()
            .unwrap();
        assert_eq!(reader.info().width, width as u32);
        assert_eq!(reader.info().height, height as u32);
        eprintln!("NATIVE_TEST_DECODE");
        let mut decoded = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut decoded).unwrap();
        assert!(decoded[..info.buffer_size()]
            .chunks_exact(4)
            .any(|pixel| pixel != &decoded[..4]));
        assert_eq!(GetClipboardSequenceNumber(), before);
        SetWindowTextW(window.0, wide("").as_ptr());
        eprintln!("NATIVE_TEST_TYPING");
        let expected = "中文 ASCII !© 🧪 𠀀\n```ts\nconst synthetic = true;\n```";
        for c in expected.chars() {
            crate::typing::platform::inject(&crate::typing::keys(c)).unwrap();
            pump();
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            pump();
            if text(window.0).replace('\r', "") == expected {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(text(window.0).replace('\r', ""), expected);
        assert_eq!(GetClipboardSequenceNumber(), before);
        assert_eq!(
            crate::typing::platform::clipboard_text().unwrap(),
            "M11 synthetic clipboard sentinel 中文 🧪"
        );
    }
}
