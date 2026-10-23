use serde_json::{json, Value};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    Manager,
};

/// Native cache stores presentation only, never tasks, credentials or screenshots.
#[derive(Default)]
pub struct Runtime {
    pub update: Mutex<Option<Value>>,
    pub stop: Arc<(Mutex<bool>, Condvar)>,
}
impl Runtime {
    pub fn shutdown(&self) {
        let (lock, wake) = &*self.stop;
        *lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
        wake.notify_all();
    }
}
pub fn offline() -> Value {
    json!({"icon":"error", "label":"处理服务失联", "tooltip":"Shot2Agent · 处理服务失联，请退出并重新打开 · 捕获和任务状态不可用", "pending":"", "feedback":"",
        "menu":{"toggleLabel":"暂停截图监听","toggle":false,"copy":false,"retry":false,"cycle":false,"current":false}})
}
pub fn view(response: &Result<Value, String>) -> Value {
    response
        .as_ref()
        .ok()
        .filter(|v| v["ok"] == true)
        .and_then(|v| v.pointer("/value/tray"))
        .filter(|v| v["icon"].is_string() && v["menu"].is_object())
        .cloned()
        .unwrap_or_else(offline)
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}

/// Equivalent native images at every Windows tray size. A dark keyline and pale
/// backing preserve contrast on either taskbar; each state has a distinct glyph.
pub fn pixels(id: &str, size: u32) -> Vec<u8> {
    let color = match id {
        "monitoring" => [31, 122, 80, 255],
        "paused" | "pending" => [139, 84, 0, 255],
        "running" | "queued" => [31, 95, 180, 255],
        "error" => [183, 45, 45, 255],
        _ => [82, 91, 99, 255],
    };
    let mut rgba = vec![0; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let (a, b) = (
                (x as f32 + 0.5) * 16.0 / size as f32,
                (y as f32 + 0.5) * 16.0 / size as f32,
            );
            let glyph = match id {
                "monitoring" => (a - 8.0).powi(2) + (b - 8.0).powi(2) <= 10.0,
                "paused" => {
                    (4.0..6.5).contains(&a) && (4.0..12.0).contains(&b)
                        || (9.5..12.0).contains(&a) && (4.0..12.0).contains(&b)
                }
                "pending" => {
                    (7.0..9.0).contains(&a)
                        && ((3.0..9.0).contains(&b) || (11.0..13.0).contains(&b))
                }
                "running" => (4.0..12.0).contains(&a) && (b - 8.0).abs() < (12.0 - a) * 0.55,
                "queued" => {
                    (4.0..12.0).contains(&a)
                        && ((4.0..6.0).contains(&b)
                            || (7.0..9.0).contains(&b)
                            || (10.0..12.0).contains(&b))
                }
                "error" => {
                    (4.0..12.0).contains(&a)
                        && (4.0..12.0).contains(&b)
                        && ((a - b).abs() < 1.3 || (a + b - 16.0).abs() < 1.3)
                }
                _ => (4.0..12.0).contains(&a) && (7.0..9.0).contains(&b),
            };
            let pixel = if !(1.0..15.0).contains(&a) || !(1.0..15.0).contains(&b) {
                [0, 0, 0, 0]
            } else if !(2.0..14.0).contains(&a) || !(2.0..14.0).contains(&b) {
                [40, 48, 44, 255]
            } else if glyph {
                color
            } else {
                [246, 248, 245, 255]
            };
            let i = ((y * size + x) * 4) as usize;
            rgba[i..i + 4].copy_from_slice(&pixel);
        }
    }
    rgba
}
pub fn menu(app: &tauri::AppHandle, v: &Value) -> tauri::Result<Menu<tauri::Wry>> {
    let m = &v["menu"];
    let entries = [
        (
            "show",
            if text(v, "pending").is_empty() {
                "打开 Shot2Agent"
            } else {
                "查看待确认图片"
            },
            true,
        ),
        ("hide", "隐藏窗口", true),
        ("toggle-pause", text(m, "toggleLabel"), m["toggle"] == true),
        ("copy-latest", "复制最新结果", m["copy"] == true),
        (
            "retry-latest-delivery",
            "重试失败投递（不重新请求 AI）",
            m["retry"] == true,
        ),
        (
            "cycle-agent",
            "切换 AI 助手（仅新任务）",
            m["cycle"] == true,
        ),
        ("current", "提交剪贴板图片", m["current"] == true),
        ("feedback", text(v, "feedback"), false),
        ("quit", "退出 Shot2Agent", true),
    ];
    let menu = Menu::new(app)?;
    for (id, label, enabled) in entries {
        if !label.is_empty() {
            menu.append(&MenuItem::with_id(app, id, label, enabled, None::<&str>)?)?;
        }
    }
    Ok(menu)
}
#[derive(Debug, PartialEq)]
struct Updates {
    icon: bool,
    tooltip: bool,
    menu: bool,
}
fn updates(v: &Value, previous: Option<&Value>) -> Updates {
    Updates {
        icon: previous.map(|p| &p["icon"]) != Some(&v["icon"]),
        tooltip: previous.map(|p| &p["tooltip"]) != Some(&v["tooltip"]),
        menu: previous.map(|p| (&p["menu"], &p["pending"], &p["feedback"]))
            != Some((&v["menu"], &v["pending"], &v["feedback"])),
    }
}
pub fn apply(app: &tauri::AppHandle, v: &Value, previous: Option<&Value>) -> tauri::Result<()> {
    if previous == Some(v) {
        return Ok(());
    }
    if let Some(tray) = app.tray_by_id("local") {
        let changed = updates(v, previous);
        if changed.icon {
            tray.set_icon(Some(tauri::image::Image::new_owned(
                pixels(text(v, "icon"), 32),
                32,
                32,
            )))?;
        }
        if changed.tooltip {
            tray.set_tooltip(Some(text(v, "tooltip")))?;
        }
        if changed.menu {
            tray.set_menu(Some(menu(app, v)?))?;
        }
    }
    Ok(())
}

/// Only reached via --staging --tray-smoke: exercise real native resources in a
/// fresh Fake root. Setter/readback proof is deliberately separate from visual proof.
pub fn native_smoke(app: &tauri::AppHandle) -> Result<(), String> {
    let response = super::call(
        &app.state::<super::State>(),
        json!({"v":1,"command":"snapshot"}),
    );
    let actual = view(&response);
    if actual["icon"] == "error" {
        return Err("INITIAL_SNAPSHOT_FAILED".into());
    }
    let mut previous = None;
    for (i, icon) in [
        "off",
        "monitoring",
        "pending",
        "queued",
        "running",
        "paused",
        "error",
    ]
    .iter()
    .enumerate()
    {
        let mut v = actual.clone();
        v["icon"] = json!(icon);
        v["tooltip"] = json!(format!("Shot2Agent · 隔离原生测试 · {icon}"));
        v["pending"] = json!(if *icon == "pending" {
            "图片等待确认"
        } else {
            ""
        });
        v["menu"]["toggle"] = json!(i % 2 == 0);
        v["menu"]["toggleLabel"] = json!(if i % 2 == 0 {
            "暂停截图监听"
        } else {
            "恢复截图监听"
        });
        for key in ["copy", "retry", "cycle", "current"] {
            v["menu"][key] = json!(i % 2 == 0);
        }
        apply(app, &v, previous.as_ref()).map_err(|e| e.to_string())?;
        // Tauri getters read the native menu state, not DOM data.
        let menu = menu(app, &v).map_err(|e| e.to_string())?;
        app.tray_by_id("local")
            .ok_or("TRAY_MISSING")?
            .set_menu(Some(menu.clone()))
            .map_err(|e| e.to_string())?;
        for (id, key) in [
            ("toggle-pause", "toggle"),
            ("copy-latest", "copy"),
            ("retry-latest-delivery", "retry"),
            ("cycle-agent", "cycle"),
            ("current", "current"),
        ] {
            let item = menu
                .get(id)
                .and_then(|x| x.as_menuitem().cloned())
                .ok_or("NATIVE_MENU_MISSING")?;
            if item.is_enabled().map_err(|e| e.to_string())? != (v["menu"][key] == true) {
                return Err("NATIVE_MENU_ELIGIBILITY".into());
            }
        }
        apply(app, &v, Some(&v)).map_err(|e| e.to_string())?;
        previous = Some(v);
    }
    // Kill only this smoke's own coordinator and exercise production loss handling.
    if let Ok(bridge) = app.state::<super::State>().bridge.lock().unwrap().as_mut() {
        let _ = bridge.child.kill();
    }
    super::refresh_tray(app);
    if app.state::<Runtime>().update.lock().unwrap().as_ref() != Some(&offline()) {
        return Err("OFFLINE_TRAY_NOT_PUBLISHED".into());
    }
    drop(app.remove_tray_by_id("local").ok_or("TRAY_REMOVE_FAILED")?);
    if app.tray_by_id("local").is_some() {
        return Err("TRAY_RETAINED_AFTER_REMOVE".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn polling_only_updates_changed_resources() {
        let a = offline();
        assert_eq!(
            updates(&a, None),
            Updates {
                icon: true,
                tooltip: true,
                menu: true
            }
        );
        assert_eq!(
            updates(&a, Some(&a)),
            Updates {
                icon: false,
                tooltip: false,
                menu: false
            }
        );
        let mut b = a.clone();
        b["tooltip"] = json!("new");
        assert_eq!(
            updates(&b, Some(&a)),
            Updates {
                icon: false,
                tooltip: true,
                menu: false
            }
        );
        b = a.clone();
        b["menu"]["copy"] = json!(true);
        assert_eq!(
            updates(&b, Some(&a)),
            Updates {
                icon: false,
                tooltip: false,
                menu: true
            }
        );
        b = a.clone();
        b["icon"] = json!("running");
        assert_eq!(
            updates(&b, Some(&a)),
            Updates {
                icon: true,
                tooltip: false,
                menu: false
            }
        );
    }
    #[test]
    fn offline_never_reuses_live_state() {
        for response in [
            Err("pipe".into()),
            Ok(json!({"ok":false})),
            Ok(json!({"ok":true,"value":{}})),
        ] {
            let v = view(&response);
            assert_eq!(v["icon"], "error");
            for key in ["toggle", "copy", "retry", "cycle", "current"] {
                assert_eq!(v["menu"][key], false);
            }
            assert_eq!(v, offline());
        }
    }
    #[test]
    fn distinct_glyphs_at_all_tray_sizes() {
        for size in [16, 20, 24, 32] {
            let icons: Vec<_> = [
                "monitoring",
                "paused",
                "pending",
                "queued",
                "running",
                "off",
                "error",
            ]
            .iter()
            .map(|id| pixels(id, size))
            .collect();
            for (i, p) in icons.iter().enumerate() {
                assert_eq!(p.len(), (size * size * 4) as usize);
                assert!(p.chunks(4).any(|p| p[3] == 0));
                for q in icons.iter().skip(i + 1) {
                    assert_ne!(p, q);
                }
            }
        }
    }
    #[test]
    fn shutdown_wakes_poll_and_is_idempotent() {
        let r = Runtime::default();
        r.shutdown();
        r.shutdown();
        assert!(*r.stop.0.lock().unwrap());
    }
}
