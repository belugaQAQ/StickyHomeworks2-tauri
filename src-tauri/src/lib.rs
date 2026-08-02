mod commands;
mod data;
mod platform;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            platform::create_main_window(app)
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::runtime_layout,
            platform::clipboard_workaround_required,
            platform::webkitgtk_dialog_exit_workaround_required,
            commands::load_app_data,
            commands::save_app_data,
            commands::import_legacy_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
