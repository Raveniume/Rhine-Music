//! macOS has a text-only menu bar lyric item; no Windows tray/popup webviews.
//! Keep the IPC names shared so the player and stored lyric preference stay portable.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopLyricPayload {
    pub visible: bool,
    pub current: String,
    pub next: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub instrumental: bool,
}

struct Lyrics {
    enabled: bool,
    payload: DesktopLyricPayload,
    pending: bool,
    displayed: Option<String>,
}

fn state() -> &'static Mutex<Lyrics> {
    static STATE: OnceLock<Mutex<Lyrics>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Lyrics { enabled: true, payload: DesktopLyricPayload::default(), pending: false, displayed: None }))
}

fn display_title(payload: &DesktopLyricPayload, enabled: bool) -> Option<String> {
    if !enabled || !payload.visible { return None; }
    let value = if !payload.current.trim().is_empty() { payload.current.trim() }
        else if payload.instrumental { "纯音乐" }
        else { payload.title.trim() };
    // Keep multiline lyrics and long titles from consuming the entire menu bar.
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() { return None; }
    let mut title: String = value.chars().take(24).collect();
    if value.chars().count() > 24 { title.push('…'); }
    Some(title)
}

fn sync(app: &AppHandle) -> Result<(), String> {
    {
        let mut state = state().lock().map_err(|e| e.to_string())?;
        if state.pending { return Ok(()); }
        state.pending = true;
    }
    let handle = app.clone();
    let result = app.run_on_main_thread(move || {
        // Read the latest state here so queued callbacks cannot restore stale lyrics.
        let Ok(mut state) = state().lock() else { return; };
        state.pending = false;
        let title = display_title(&state.payload, state.enabled);
        if title == state.displayed { return; }
        if let Some(item) = handle.tray_by_id("lyrics") {
            if let Err(error) = item.set_title(title.as_deref())
                .and_then(|_| item.set_visible(title.is_some())) {
                eprintln!("Menu bar update failed: {error}");
            } else { state.displayed = title; }
        }
    }).map_err(|e| e.to_string());
    if result.is_err() {
        if let Ok(mut state) = state().lock() { state.pending = false; }
    }
    result
}

#[tauri::command(rename = "desktop_taskbar_lyric_update")]
pub fn update(app: AppHandle, payload: DesktopLyricPayload) -> Result<(), String> {
    state().lock().map_err(|e| e.to_string())?.payload = payload;
    sync(&app)
}

#[tauri::command(rename = "desktop_taskbar_lyric_control")]
pub fn control(app: AppHandle, enabled: bool, restore: bool) -> Result<(), String> {
    {
        let mut state = state().lock().map_err(|e| e.to_string())?;
        state.enabled = enabled;
        if restore { state.payload.visible = true; }
    }
    sync(&app)
}

#[tauri::command(rename = "desktop_taskbar_lyric_ready")]
pub fn ready(app: AppHandle) -> Result<(), String> { sync(&app) }

#[tauri::command(rename = "desktop_taskbar_action")]
pub fn action(app: AppHandle, action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "toggle" | "previous" | "next" | "settings") {
        return Err("未知的菜单栏操作".into());
    }
    app.emit_to("main", "rhine-taskbar-action", serde_json::json!({ "action": action }))
        .map_err(|e| e.to_string())
}

pub fn show_main(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

#[tauri::command(rename = "desktop_tray_action")]
pub fn tray_action(app: AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "show" | "controls" => { show_main(&app); Ok(()) }
        "hide" => Ok(()),
        "settings" => { show_main(&app); self::action(app, action) }
        _ => self::action(app, action),
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let show = MenuItem::with_id(app, "show", "打开 Rhine Music", true, None::<&str>).map_err(|e| e.to_string())?;
    let toggle = MenuItem::with_id(app, "toggle", "播放 / 暂停", true, None::<&str>).map_err(|e| e.to_string())?;
    let previous = MenuItem::with_id(app, "previous", "上一首", true, None::<&str>).map_err(|e| e.to_string())?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>).map_err(|e| e.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let exit = MenuItem::with_id(app, "exit", "退出 Rhine Music", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &toggle, &previous, &next, &separator, &exit]).map_err(|e| e.to_string())?;
    let item = tauri::tray::TrayIconBuilder::with_id("lyrics")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "exit" => { let _ = crate::apply_close_behavior(app, crate::CloseBehavior::Exit); }
            name => { let _ = action(app.clone(), name.into()); }
        })
        .build(app).map_err(|e| e.to_string())?;
    item.set_visible(false).map_err(|e| e.to_string())
}

pub fn setup_taskbar_window(_: &AppHandle, _: &tauri::Url) -> Result<(), String> { Ok(()) }
pub fn setup_tray_controls(_: &AppHandle, _: &tauri::Url) -> Result<(), String> { Ok(()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hidden_or_disabled_lyrics_leave_no_menu_bar_item() {
        let p = DesktopLyricPayload { visible: true, current: "歌词".into(), ..Default::default() };
        assert_eq!(display_title(&p, true).as_deref(), Some("歌词"));
        assert_eq!(display_title(&p, false), None);
        assert_eq!(display_title(&DesktopLyricPayload { visible: false, ..p }, true), None);
    }
    #[test]
    fn titles_fallback_normalize_and_bound_unicode() {
        let mut p = DesktopLyricPayload { visible: true, title: "歌曲".into(), ..Default::default() };
        assert_eq!(display_title(&p, true).as_deref(), Some("歌曲"));
        p.instrumental = true;
        assert_eq!(display_title(&p, true).as_deref(), Some("纯音乐"));
        p.current = "第一行\n第二行".into();
        assert_eq!(display_title(&p, true).as_deref(), Some("第一行 第二行"));
        p.current = "乐".repeat(30);
        assert_eq!(display_title(&p, true), Some(format!("{}…", "乐".repeat(24))));
    }
}
