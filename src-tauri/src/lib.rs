mod commands;
mod data;
mod diagnostic_archive;
mod diagnostics;
mod legacy_import;
mod logger;
mod persistence;
mod platform;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            logger::install_panic_hook(app.handle());
            logger::record_startup_event(app.handle(), "Tauri 应用初始化开始");
            platform::create_main_window(app).map_err(|error| {
                logger::record_startup_error(app.handle(), &error.to_string());
                Box::new(error) as Box<dyn std::error::Error>
            })?;
            logger::record_startup_event(app.handle(), "主窗口创建完成");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::runtime_layout,
            platform::clipboard_workaround_required,
            platform::webkitgtk_dialog_exit_workaround_required,
            commands::load_app_data,
            commands::save_app_data,
            commands::import_legacy_data_contents,
            commands::log_event,
            commands::diagnostic_report,
            commands::export_diagnostic_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
