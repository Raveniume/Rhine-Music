fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_window_state",
            "desktop_window_action",
            "desktop_request_close",
            "desktop_pick_folder",
            "desktop_open_link",
            "desktop_open_feedback",
            "desktop_taskbar_lyric_update",
            "desktop_taskbar_action",
            "desktop_taskbar_lyric_ready",
            "desktop_tray_action",
        ]),
    ))
    .expect("desktop permission manifest");
}
