#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::{Duration, Instant},
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
mod instance_handoff;
mod taskbar_lyric;

struct MusicService(Mutex<Option<Child>>);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum CloseBehavior {
    Exit,
    Tray,
}

struct ClosePreference(Mutex<Option<CloseBehavior>>);
static EXITING: AtomicBool = AtomicBool::new(false);

fn close_preference_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("close-behavior.json"))
}

fn load_close_preference(app: &tauri::AppHandle) -> ClosePreference {
    let value = close_preference_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<CloseBehavior>(&text).ok());
    ClosePreference(Mutex::new(value))
}

fn persist_close_preference(app: &tauri::AppHandle, value: Option<CloseBehavior>) -> Result<(), String> {
    let path = close_preference_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    match value {
        Some(value) => std::fs::write(path, serde_json::to_vec(&value).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string()),
        None => match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

fn apply_close_behavior(app: &tauri::AppHandle, behavior: CloseBehavior) -> Result<(), String> {
    match behavior {
        CloseBehavior::Tray => app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_owned())?
            .hide()
            .map_err(|error| error.to_string()),
        CloseBehavior::Exit => {
            EXITING.store(true, Ordering::Release);
            if let Some(taskbar) = app.get_webview_window("taskbar-lyrics") {
                let _ = taskbar.close();
            }
            if let Some(tray) = app.get_webview_window("tray-controls") {
                let _ = tray.close();
            }
            app.exit(0);
            Ok(())
        }
    }
}

impl MusicService {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            if let Some(stdin) = child.stdin.as_mut() { let _ = stdin.write_all(b"shutdown\n"); }
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() { return; }
                std::thread::sleep(Duration::from_millis(30));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for MusicService { fn drop(&mut self) { self.stop(); } }

#[tauri::command]
async fn desktop_window_state(window: WebviewWindow) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(serde_json::json!({ "fullscreen": window.is_fullscreen().map_err(|e| e.to_string())?, "maximized": window.is_maximized().map_err(|e| e.to_string())? }))
    }).await.map_err(|e| e.to_string())?
}

fn enter_window_fullscreen(window: &WebviewWindow) -> tauri::Result<()> {
    if !window.is_fullscreen()? {
        // Tao's Windows WM_NCCALCSIZE path uses rcWork whenever IsZoomed is
        // still true, even for borderless fullscreen. Clear maximize first so
        // the client area covers rcMonitor instead of stopping at the taskbar.
        window.unmaximize()?;
        window.set_fullscreen(true)?;
    }
    // Activate after marking fullscreen so the shell can lower the taskbar.
    window.set_focus()
}

#[tauri::command]
async fn desktop_window_action(window: WebviewWindow, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apply_window_action(window, &action))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn desktop_request_close(app: tauri::AppHandle, state: State<'_, ClosePreference>) -> Result<(), String> {
    let behavior = state
        .0
        .lock()
        .map_err(|_| "关闭偏好不可用".to_owned())?
        .as_ref()
        .copied();
    match behavior {
        Some(value) => apply_close_behavior(&app, value),
        None => app
            .emit_to("main", "rhine-close-requested", ())
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
fn desktop_close_preference(state: State<'_, ClosePreference>) -> Result<Option<String>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "关闭偏好不可用".to_owned())?
        .map(|value| match value {
            CloseBehavior::Exit => "exit".to_owned(),
            CloseBehavior::Tray => "tray".to_owned(),
        }))
}

#[tauri::command]
fn desktop_set_close_preference(
    app: tauri::AppHandle,
    state: State<'_, ClosePreference>,
    behavior: String,
) -> Result<(), String> {
    let value = match behavior.as_str() {
        "exit" => Some(CloseBehavior::Exit),
        "tray" => Some(CloseBehavior::Tray),
        "ask" => None,
        _ => return Err("未知的关闭行为".to_owned()),
    };
    *state.0.lock().map_err(|_| "关闭偏好不可用".to_owned())? = value;
    persist_close_preference(&app, value)
}

#[tauri::command]
fn desktop_close_decision(
    app: tauri::AppHandle,
    state: State<'_, ClosePreference>,
    behavior: String,
    remember: bool,
) -> Result<(), String> {
    let value = match behavior.as_str() {
        "exit" => CloseBehavior::Exit,
        "tray" => CloseBehavior::Tray,
        _ => return Err("未知的关闭行为".to_owned()),
    };
    let stored = if remember { Some(value) } else { None };
    *state.0.lock().map_err(|_| "关闭偏好不可用".to_owned())? = stored;
    persist_close_preference(&app, stored)?;
    apply_close_behavior(&app, value)
}

fn apply_window_action(window: WebviewWindow, action: &str) -> Result<(), String> {
    match action {
        "minimize" => window.minimize(),
        // Maximize uses the Windows work area, leaving the taskbar available.
        "maximize" => {
            if window.is_fullscreen().unwrap_or(false) { window.set_fullscreen(false) }
            else if window.is_maximized().unwrap_or(false) { window.unmaximize() }
            else { window.maximize() }
        },
        "maximize-window" => {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.maximize()
        },
        "fullscreen" => if window.is_fullscreen().unwrap_or(false) { window.set_fullscreen(false) } else { enter_window_fullscreen(&window) },
        "enter-fullscreen" => enter_window_fullscreen(&window),
        "leave-fullscreen" => window.set_fullscreen(false),
        "restore" => {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.unmaximize()
        },
        "close" => window.close(),
        _ => return Err("Unknown window action".into()),
    }.map_err(|e| e.to_string())
}

#[tauri::command]
async fn desktop_pick_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().set_title("选择音乐文件夹").pick_folder().map(|p| p.to_string_lossy().into_owned()))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_open_link(url: &str) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "Invalid link")?;
    if !matches!(parsed.scheme(), "https" | "http") { return Err("Only web links are allowed".into()); }
    open::that_detached(url).map_err(|e| e.to_string())
}

// Feedback opens a user-reviewed draft; it never sends mail or accepts another recipient.
#[tauri::command]
fn desktop_open_feedback(url: &str) -> Result<(), String> {
    if url.len() > 7500 { return Err("Feedback draft is too long".into()); }
    let parsed: tauri::Url = url.parse().map_err(|_| "Invalid feedback link")?;
    if parsed.scheme() != "mailto" || parsed.path() != "2228396737@qq.com"
        || parsed.host_str().is_some() || parsed.fragment().is_some() {
        return Err("Invalid feedback recipient".into());
    }
    let mut keys = std::collections::HashSet::new();
    for (key, value) in parsed.query_pairs() {
        if !matches!(key.as_ref(), "subject" | "body") || !keys.insert(key.to_string())
            || (key == "subject" && value.contains(['\r', '\n'])) {
            return Err("Invalid feedback fields".into());
        }
    }
    if keys.len() != 2 { return Err("Missing feedback fields".into()); }
    open::that_detached(url).map_err(|e| e.to_string())
}

fn start_service(app: &tauri::AppHandle) -> Result<(MusicService, tauri::Url), Box<dyn std::error::Error>> {
    let resource_root = app.path().resource_dir()?.join("runtime");
    let runtime: PathBuf = if resource_root.join("node.exe").is_file() { resource_root }
        else {
            #[cfg(debug_assertions)]
            { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop-runtime") }
            #[cfg(not(debug_assertions))]
            { return Err("缺少 runtime 文件夹，请完整解压便携包后启动".into()); }
        };
    let data = std::env::var_os("RHINE_DESKTOP_DATA_DIR").map(PathBuf::from)
        .unwrap_or(app.path().app_local_data_dir()?.join("music-data"));
    std::fs::create_dir_all(&data)?;
    let log = std::fs::OpenOptions::new().create(true).append(true).open(data.join("service.log"))?;
    let mut command = Command::new(runtime.join("node.exe"));
    command.arg("scripts/desktop-server.mjs").current_dir(&runtime)
        .env("MUSIC_DATA_DIR", &data).env_remove("MUSIC_ROOTS")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
    // Node and FFmpeg must never open console windows behind the player.
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Missing service output")?;
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(address) = line.strip_prefix("RHINE_READY ") { let _ = send.send(address.to_owned()); }
        }
    });
    let service = MusicService(Mutex::new(Some(child)));
    let address = receive.recv_timeout(Duration::from_secs(25)).map_err(|_| "音乐服务启动超时，请查看本地数据目录中的 service.log")?;
    let mut url: tauri::Url = address.parse()?;
    url.set_query(Some("desktop=1"));
    Ok((service, url))
}

fn main() {
    if instance_handoff::forward_existing() { return; }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                tauri::async_runtime::spawn_blocking(move || { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); });
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default()
            // Ignore fullscreen saved by older previews and retain the integrated chrome.
            .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE
                | tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::MAXIMIZED)
            .build())
        .invoke_handler(tauri::generate_handler![desktop_window_action, desktop_request_close, desktop_window_state, desktop_close_preference, desktop_set_close_preference, desktop_close_decision, desktop_pick_folder, desktop_open_link, desktop_open_feedback, taskbar_lyric::update, taskbar_lyric::ready, taskbar_lyric::action, taskbar_lyric::tray_action])
        .setup(|app| {
            let (service, url) = start_service(app.handle())?;
            app.manage(service);
            app.manage(load_close_preference(app.handle()));
            let origin = url.origin().ascii_serialization();
            taskbar_lyric::setup_tray(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.clone()))
                .title("Rhine Music").inner_size(1280.0, 800.0).min_inner_size(800.0, 560.0)
                .decorations(false).resizable(true).fullscreen(false)
                .initialization_script("Object.defineProperty(window, '__RHINE_GPU_REQUEST__', { value: 'system-default' });")
                .background_color(tauri::window::Color(232, 229, 225, 255))
                .on_navigation(move |target| target.origin().ascii_serialization() == origin)
                .build()?;
            taskbar_lyric::setup_taskbar_window(app.handle(), &url).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            taskbar_lyric::setup_tray_controls(app.handle(), &url).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            // OS visibility explicitly suspends only rendering. Audio remains independent.
            // Window getters can synchronously re-enter the UI runtime. Never
            // call them (or eval) while a native event listener is on its stack.
            // One bounded worker coalesces resize/focus bursts outside that stack.
            let view = window.clone();
            let app_for_close = app.handle().clone();
            let (notify, events) = std::sync::mpsc::sync_channel::<()>(1);
            std::thread::spawn(move || {
                while events.recv().is_ok() {
                    let Ok(hidden) = view.is_minimized() else { break; };
                    let Ok(fullscreen) = view.is_fullscreen() else { break; };
                    let Ok(maximized) = view.is_maximized() else { break; };
                    if view.eval(&format!("window.dispatchEvent(new CustomEvent('rhine-desktop-visibility',{{detail:{{hidden:{hidden}}}}}));window.dispatchEvent(new CustomEvent('rhine-desktop-window-state',{{detail:{{fullscreen:{fullscreen},maximized:{maximized}}}}}));")).is_err() { break; }
                }
            });
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)) {
                    let _ = notify.try_send(());
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if EXITING.load(Ordering::Acquire) {
                        return;
                    }
                    api.prevent_close();
                    let behavior = app_for_close
                        .state::<ClosePreference>()
                        .0
                        .lock()
                        .ok()
                        .and_then(|value| *value);
                    match behavior {
                        Some(value) => {
                            let _ = apply_close_behavior(&app_for_close, value);
                        }
                        None => {
                            let _ = app_for_close.emit_to("main", "rhine-close-requested", ());
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Rhine Music desktop initialization failed")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { app.state::<MusicService>().stop(); }
        });
}
