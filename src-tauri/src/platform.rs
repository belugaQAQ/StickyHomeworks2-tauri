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
