use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopLyricPayload {
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub current: String,
    #[serde(default)]
    pub next: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub playing: bool,
    #[serde(default)]
    pub instrumental: bool,
}

static LAST_PAYLOAD: OnceLock<Mutex<Option<DesktopLyricPayload>>> = OnceLock::new();
static LYRICS_VISIBLE: AtomicBool = AtomicBool::new(false);

fn last_payload() -> &'static Mutex<Option<DesktopLyricPayload>> {
    LAST_PAYLOAD.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "macos")]
fn display_title(payload: &DesktopLyricPayload) -> Option<String> {
    if !payload.visible {
        return None;
    }
    let value = if payload.current.trim().is_empty() {
        if payload.instrumental {
            "纯音乐"
        } else {
            payload.title.trim()
        }
    } else {
        payload.current.trim()
    };
    if value.is_empty() {
        return None;
    }
    let mut output = value.chars().take(34).collect::<String>();
    if value.chars().count() > output.chars().count() {
        output.push('…');
    }
    Some(output)
}

#[tauri::command(rename = "desktop_taskbar_lyric_update")]
pub fn update(app: AppHandle, payload: DesktopLyricPayload) -> Result<(), String> {
    LYRICS_VISIBLE.store(payload.visible, Ordering::Release);
    if let Ok(mut last) = last_payload().lock() {
        *last = Some(payload.clone());
    }
    app.emit_to("taskbar-lyrics", "rhine-taskbar-lyric", &payload)
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    if let Some(tray) = app.tray_by_id("lyrics") {
        tray.set_title(display_title(&payload))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("taskbar-lyrics") {
        if let Some(placement) = taskbar_placement() {
            apply_placement(&window, placement, payload.visible);
        } else {
            let _ = window.hide();
        }
    }
    Ok(())
}

#[tauri::command(rename = "desktop_taskbar_lyric_ready")]
pub fn ready(app: AppHandle) -> Result<(), String> {
    let payload = last_payload().lock().ok().and_then(|last| last.clone());
    if let Some(payload) = payload {
        app.emit_to("taskbar-lyrics", "rhine-taskbar-lyric", &payload)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(rename = "desktop_taskbar_action")]
pub fn action(app: AppHandle, action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "toggle" | "next" | "previous") {
        return Err("未知的任务栏操作".into());
    }
    app.emit_to(
        "main",
        "rhine-taskbar-action",
        serde_json::json!({ "action": action }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command(rename = "desktop_tray_action")]
pub fn tray_action(app: AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "hide" => {
            if let Some(window) = app.get_webview_window("tray-controls") {
                window.hide().map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Ok(())
        }
        "settings" => app.emit_to("main", "rhine-taskbar-action", serde_json::json!({ "action": "settings" })).map_err(|e| e.to_string()),
        "toggle" | "next" | "previous" => app.emit_to("main", "rhine-taskbar-action", serde_json::json!({ "action": action })).map_err(|e| e.to_string()),
        _ => Err("未知的托盘操作".into()),
    }
}

pub fn setup_tray_controls(app: &AppHandle, service_url: &tauri::Url) -> Result<(), String> {
    let mut tray_url = service_url.clone();
    tray_url.set_query(Some("desktop=1&tray=1"));
    WebviewWindowBuilder::new(app, "tray-controls", WebviewUrl::External(tray_url))
        .title("RhineMusic")
        .inner_size(360.0, 190.0)
        .min_inner_size(320.0, 170.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(());
    };
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let show = MenuItem::with_id(app, "tray-show", "打开 RhineMusic", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let toggle = MenuItem::with_id(app, "tray-toggle", "播放 / 暂停", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let previous = MenuItem::with_id(app, "tray-previous", "上一首", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let next = MenuItem::with_id(app, "tray-next", "下一首", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let controls = MenuItem::with_id(app, "tray-controls", "播放控制浮窗", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let settings = MenuItem::with_id(app, "tray-settings", "设置", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let exit = MenuItem::with_id(app, "tray-exit", "退出 RhineMusic", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &controls, &toggle, &previous, &next, &separator, &settings, &exit])
        .map_err(|e| e.to_string())?;
    tauri::tray::TrayIconBuilder::with_id("lyrics")
        .icon(icon)
        .title("RhineMusic")
        .tooltip("RhineMusic")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let action = match event.id().as_ref() {
                "tray-show" => None,
                "tray-controls" => {
                    if let Some(window) = app.get_webview_window("tray-controls") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    None
                }
                "tray-toggle" => Some("toggle"),
                "tray-previous" => Some("previous"),
                "tray-next" => Some("next"),
                "tray-settings" => Some("settings"),
                "tray-exit" => {
                    crate::EXITING.store(true, Ordering::Release);
                    app.exit(0);
                    None
                }
                _ => None,
            };
            if event.id().as_ref() == "tray-show" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            } else if let Some(action) = action {
                let _ = app.emit_to("main", "rhine-taskbar-action", serde_json::json!({ "action": action }));
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { button: tauri::tray::MouseButton::Left, .. }) {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            } else if matches!(event, tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. }) {
                if let Some(window) = tray.app_handle().get_webview_window("tray-controls") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TaskbarEdge {
    Bottom,
    Top,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TaskbarGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    hidden: bool,
}

fn taskbar_geometry(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    edge: TaskbarEdge,
    reserved_start: u32,
    preferred_width: u32,
    minimum_width: u32,
    lyric_height: u32,
    auto_hide: bool,
) -> Option<TaskbarGeometry> {
    if width == 0 || height == 0 {
        return None;
    }
    let (available, lyric_width, px, py) = match edge {
        TaskbarEdge::Bottom | TaskbarEdge::Top => {
            let available = width.saturating_sub(reserved_start.saturating_add(12));
            let w = preferred_width.min(available);
            let py = if edge == TaskbarEdge::Bottom {
                // Keep the lyric window's bottom edge aligned with the taskbar.
                // Use signed arithmetic so a 44px lyric window on a 40px taskbar
                // is positioned four pixels above the taskbar instead of being
                // clamped to its bottom edge and clipped.
                y + height as i32 - lyric_height as i32
            } else {
                y
            };
            (available, w, x + reserved_start as i32, py)
        }
        TaskbarEdge::Left | TaskbarEdge::Right => {
            let available = height.saturating_sub(reserved_start.saturating_add(12));
            let w = preferred_width.min(available);
            let px = if edge == TaskbarEdge::Left {
                x + width as i32 + 2
            } else {
                x - w as i32 - 2
            };
            (available, w, px, y + reserved_start as i32)
        }
    };
    Some(TaskbarGeometry {
        x: px,
        y: py,
        width: lyric_width,
        height: lyric_height,
        hidden: auto_hide || available < minimum_width || lyric_width < minimum_width,
    })
}

#[cfg(target_os = "windows")]
fn taskbar_placement() -> Option<TaskbarGeometry> {
    use std::mem::size_of;
    use windows_sys::Win32::UI::Shell::{
        SHAppBarMessage, ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_GETSTATE, ABM_GETTASKBARPOS,
        ABS_AUTOHIDE, APPBARDATA,
    };
    let mut data = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        ..Default::default()
    };
    if unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut data) } == 0 {
        return None;
    }
    let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as u32;
    let rect = data.rc;
    let taskbar_width = (rect.right - rect.left).max(0) as u32;
    let taskbar_height = (rect.bottom - rect.top).max(0) as u32;
    if taskbar_width == 0 || taskbar_height == 0 {
        return None;
    }
    let edge = match data.uEdge {
        ABE_TOP => TaskbarEdge::Top,
        ABE_LEFT => TaskbarEdge::Left,
        ABE_RIGHT => TaskbarEdge::Right,
        _ => TaskbarEdge::Bottom,
    };
    taskbar_geometry(
        rect.left,
        rect.top,
        taskbar_width,
        taskbar_height,
        edge,
        180,
        520,
        160,
        44,
        state & ABS_AUTOHIDE != 0,
    )
}

#[cfg(target_os = "windows")]
fn apply_placement(
    window: &tauri::WebviewWindow,
    placement: TaskbarGeometry,
    lyrics_visible: bool,
) {
    let _ = window.set_size(PhysicalSize::new(placement.width, placement.height));
    let _ = window.set_position(PhysicalPosition::new(placement.x, placement.y));
    if placement.hidden || !lyrics_visible {
        let _ = window.hide();
    } else {
        let _ = window.show();
    }
}

#[cfg(target_os = "windows")]
pub fn setup_taskbar_window(app: &AppHandle, service_url: &tauri::Url) -> Result<(), String> {
    let mut taskbar_url = service_url.clone();
    taskbar_url.set_query(Some("desktop=1&taskbar=1"));
    let window =
        WebviewWindowBuilder::new(app, "taskbar-lyrics", WebviewUrl::External(taskbar_url))
            .title("RhineMusic Lyrics")
            .inner_size(520.0, 44.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .focusable(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
    if let Some(placement) = taskbar_placement() {
        apply_placement(&window, placement, false);
    }
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut previous = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let placement = taskbar_placement();
            if placement == previous {
                continue;
            }
            previous = placement;
            let Some(window) = app_handle.get_webview_window("taskbar-lyrics") else {
                break;
            };
            let _ = app_handle.run_on_main_thread(move || {
                if let Some(value) = placement {
                    apply_placement(&window, value, LYRICS_VISIBLE.load(Ordering::Acquire));
                } else {
                    let _ = window.hide();
                }
            });
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_inside_horizontal_taskbar_and_adjacent_to_vertical_taskbar() {
        let bottom = taskbar_geometry(
            0,
            1040,
            1920,
            40,
            TaskbarEdge::Bottom,
            180,
            520,
            160,
            44,
            false,
        )
        .unwrap();
        assert_eq!(
            (bottom.x, bottom.y, bottom.width, bottom.hidden),
            (180, 1036, 520, false)
        );
        let top =
            taskbar_geometry(0, 0, 1920, 40, TaskbarEdge::Top, 180, 520, 160, 44, false).unwrap();
        assert_eq!((top.x, top.y), (180, 0));
        let left =
            taskbar_geometry(0, 0, 48, 1080, TaskbarEdge::Left, 180, 520, 160, 44, false).unwrap();
        assert_eq!(
            (left.x, left.y, left.width, left.hidden),
            (50, 180, 520, false)
        );
        let right = taskbar_geometry(
            1872,
            0,
            48,
            1080,
            TaskbarEdge::Right,
            180,
            520,
            160,
            44,
            false,
        )
        .unwrap();
        assert_eq!((right.x, right.y), (1350, 180));
    }

    #[test]
    fn hides_for_autohide_or_insufficient_workspace_and_preserves_monitor_origin() {
        let narrow = taskbar_geometry(
            1200,
            1040,
            320,
            40,
            TaskbarEdge::Bottom,
            180,
            520,
            160,
            44,
            false,
        )
        .unwrap();
        assert!(narrow.hidden);
        let auto = taskbar_geometry(
            -1920,
            1040,
            1920,
            40,
            TaskbarEdge::Bottom,
            180,
            520,
            160,
            44,
            true,
        )
        .unwrap();
        assert!(auto.hidden);
        assert_eq!(auto.x, -1740);
        assert!(taskbar_geometry(0, 0, 0, 40, TaskbarEdge::Top, 0, 460, 260, 30, false).is_none());
    }
}

#[cfg(not(target_os = "windows"))]
pub fn setup_taskbar_window(_app: &AppHandle, _service_url: &tauri::Url) -> Result<(), String> {
    Ok(())
}
