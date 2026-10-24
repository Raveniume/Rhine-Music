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

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(());
    };
    tauri::tray::TrayIconBuilder::with_id("lyrics")
        .icon(icon)
        .title("RhineMusic")
        .tooltip("RhineMusic")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                tauri::tray::TrayIconEvent::Click { .. }
                    | tauri::tray::TrayIconEvent::DoubleClick { .. }
            ) {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
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
                y + height.saturating_sub(lyric_height) as i32
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
        220,
        460,
        260,
        30,
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
            .inner_size(460.0, 30.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
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
            220,
            460,
            260,
            30,
            false,
        )
        .unwrap();
        assert_eq!(
            (bottom.x, bottom.y, bottom.width, bottom.hidden),
            (220, 1050, 460, false)
        );
        let top =
            taskbar_geometry(0, 0, 1920, 40, TaskbarEdge::Top, 220, 460, 260, 30, false).unwrap();
        assert_eq!((top.x, top.y), (220, 0));
        let left =
            taskbar_geometry(0, 0, 48, 1080, TaskbarEdge::Left, 220, 460, 260, 30, false).unwrap();
        assert_eq!(
            (left.x, left.y, left.width, left.hidden),
            (50, 220, 460, false)
        );
        let right = taskbar_geometry(
            1872,
            0,
            48,
            1080,
            TaskbarEdge::Right,
            220,
            460,
            260,
            30,
            false,
        )
        .unwrap();
        assert_eq!((right.x, right.y), (1410, 220));
    }

    #[test]
    fn hides_for_autohide_or_insufficient_workspace_and_preserves_monitor_origin() {
        let narrow = taskbar_geometry(
            1200,
            1040,
            320,
            40,
            TaskbarEdge::Bottom,
            220,
            460,
            260,
            30,
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
            220,
            460,
            260,
            30,
            true,
        )
        .unwrap();
        assert!(auto.hidden);
        assert_eq!(auto.x, -1700);
        assert!(taskbar_geometry(0, 0, 0, 40, TaskbarEdge::Top, 0, 460, 260, 30, false).is_none());
    }
}

#[cfg(not(target_os = "windows"))]
pub fn setup_taskbar_window(_app: &AppHandle, _service_url: &tauri::Url) -> Result<(), String> {
    Ok(())
}
