mod commands;
mod data;
mod diagnostic_archive;
mod diagnostics;
mod glycoprotein_service;
mod legacy_import;
mod logger;
mod persistence;
mod platform;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_fs::init())
        .manage(commands::AppDataCoordinator::default())
        .manage(glycoprotein_service::GlycoproteinService::default())
        .setup(|app| {
            logger::install_panic_hook(app.handle());
            logger::record_startup_event(app.handle(), "Tauri 应用初始化开始");
            logger::record_startup_event(app.handle(), "主窗口由 Tauri 配置创建");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::runtime_layout,
            platform::clipboard_workaround_required,
            platform::webkitgtk_dialog_exit_workaround_required,
            commands::load_app_data,
            commands::save_app_data,
            commands::import_legacy_data_contents,
            commands::initialize_glycoprotein,
            commands::glycoprotein_status,
            commands::log_event,
            commands::diagnostic_report,
            commands::export_diagnostic_bundle,
            commands::clear_diagnostic_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            use tauri::Manager;
            let service = app.state::<glycoprotein_service::GlycoproteinService>();
            tauri::async_runtime::block_on(service.shutdown(app));
        }
    });
}
