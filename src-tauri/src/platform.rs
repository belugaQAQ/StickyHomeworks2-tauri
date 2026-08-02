#[tauri::command]
pub(crate) fn runtime_layout() -> &'static str {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        "mobile"
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        "desktop"
    }
}

#[tauri::command]
pub(crate) fn clipboard_workaround_required() -> bool {
    cfg!(target_os = "linux")
}

#[tauri::command]
pub(crate) fn webkitgtk_dialog_exit_workaround_required() -> bool {
    cfg!(target_os = "linux")
}

pub(crate) fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("stickyhomeworks2")
        .inner_size(800.0, 600.0)
        // Required by Tauri/Wry for Linux and Windows WebView clipboard shortcuts.
        .enable_clipboard_access()
        .build()?;
    Ok(())
}
