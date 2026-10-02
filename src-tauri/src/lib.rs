mod commands;
mod data;
mod diagnostic_archive;
mod diagnostics;
mod glycoprotein_service;
mod legacy_import;
mod logger;
mod persistence;
mod platform;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::Position;
#[cfg(desktop)]
use tauri::WindowEvent;

#[tauri::command]
fn window_visibility(app: tauri::AppHandle) -> Result<bool, String> {
    commands::persisted_window_visibility(&app)
}
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    set_window_visibility(true, app)
}

#[tauri::command]
fn set_window_visibility(visible: bool, app: tauri::AppHandle) -> Result<(), String> {
    commands::set_persisted_window_visibility(&app, visible)?;
    let window = app.get_webview_window("main").ok_or_else(|| "主窗口不存在".to_owned())?;
    (if visible { window.show() } else { window.hide() })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_application(app: tauri::AppHandle) { app.exit(0); }

#[tauri::command]
fn navigate_main_window(path: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit_to("main", "main-navigate", path)
        .map_err(|error| error.to_string())
}
#[tauri::command]
fn hide_tray_menu(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("tray-menu")
        .ok_or_else(|| "托盘菜单窗口不存在".to_owned())?
        .hide()
        .map_err(|error| error.to_string())
}

#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(menu) = app.get_webview_window("tray-menu") {
        let menu_for_event = menu.clone();
        let app_for_event = app.clone();
        menu.on_window_event(move |window_event| {
            if let WindowEvent::Focused(false) = window_event {
                let main_is_focused = app_for_event
                    .get_webview_window("main")
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false);
                if !main_is_focused {
                    let _ = menu_for_event.hide();
                }
            }
        });
    }
    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().ok_or_else(|| tauri::Error::AssetNotFound("默认窗口图标不可用".to_owned()))?)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left | MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event {
                if let Some(menu) = tray.app_handle().get_webview_window("tray-menu") {
                    let _ = menu.set_position(Position::Physical(tauri::PhysicalPosition {
                        x: position.x as i32 - 160,
                        y: position.y as i32 - 260,
                    }));
                    let _ = menu.show();
                    let _ = menu.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    {
        app = app.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ));
    }
    let app = app
        .plugin(tauri_plugin_fs::init())
        .manage(commands::AppDataCoordinator::default())
        .manage(glycoprotein_service::GlycoproteinService::default())
        .setup(|app| {
            logger::install_panic_hook(app.handle());
            logger::record_startup_event(app.handle(), "Tauri 应用初始化开始");
            logger::record_startup_event(app.handle(), "主窗口由 Tauri 配置创建");
            #[cfg(desktop)]
            setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_visibility,
            set_window_visibility,
            show_main_window,
            navigate_main_window,
            hide_tray_menu,
            quit_application,
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
