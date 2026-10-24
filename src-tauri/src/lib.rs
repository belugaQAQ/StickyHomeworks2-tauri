mod commands;
mod data;
mod diagnostic_archive;
mod diagnostics;
mod glycoprotein_service;
mod legacy_import;
mod logger;
mod persistence;
mod platform;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::Position;
#[cfg(desktop)]
use tauri::WebviewWindowBuilder;
#[cfg(desktop)]
use tauri::WindowEvent;
use tauri::{Emitter, Manager, State};
#[cfg(desktop)]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
#[cfg(desktop)]
const WINDOW_STATE_FLAGS: StateFlags = StateFlags::POSITION.union(StateFlags::SIZE);

#[tauri::command]
fn window_visibility(app: tauri::AppHandle) -> Result<bool, String> {
    commands::persisted_window_visibility(&app)
}
#[tauri::command]
fn show_main_window(app: tauri::AppHandle, coordinator: State<'_, commands::AppDataCoordinator>) -> Result<(), String> {
    set_window_visibility(true, app, coordinator)
}

#[tauri::command]
fn set_window_visibility(
    visible: bool,
    app: tauri::AppHandle,
    coordinator: State<'_, commands::AppDataCoordinator>,
) -> Result<(), String> {
    commands::set_persisted_window_visibility(&app, coordinator.inner(), visible)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_owned())?;
    (if visible { window.show() } else { window.hide() }).map_err(|error| error.to_string())?;
    let _ = app.emit(
        glycoprotein_service::WINDOW_SETTINGS_EVENT,
        glycoprotein_service::WindowSettingsPatch {
            window_visible: Some(visible),
            ..Default::default()
        },
    );
    Ok(())
}

#[tauri::command]
fn quit_application(app: tauri::AppHandle) {
    #[cfg(desktop)]
    let _ = app.save_window_state(WINDOW_STATE_FLAGS);
    app.exit(0);
}

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
    if let Some(tray_config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "tray-menu")
    {
        WebviewWindowBuilder::from_config(app, tray_config)?.build()?;
    }
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
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("默认窗口图标不可用".to_owned()))?,
        )
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left | MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--autostart"]),
    ));
    let app = app.plugin(tauri_plugin_fs::init());
    // tray-menu 是托盘弹出菜单，不参与位置/尺寸恢复，因此列入 denylist。
    #[cfg(desktop)]
    let app = app.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(WINDOW_STATE_FLAGS)
            .with_denylist(&["tray-menu"])
            .build(),
    );
    // single-instance 官方建议最先注册；这里放在末尾也能工作——插件在 init 阶段就结束
    // 第二个进程，`setup` 与窗口创建都不会执行，只是前面的插件会先初始化一次。
    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        match app.get_webview_window("main") {
            Some(window) => {
                let _ = window.show();
                let _ = window.set_focus();
                // 与托盘隐藏状态对齐：窗口已回到前台，持久化 visible=true 并通知前端，
                // 避免“显示出来的窗口在下次保存时又被 apply_window_settings 隐藏”。
                let _ = commands::set_persisted_window_visibility(
                    app,
                    app.state::<commands::AppDataCoordinator>().inner(),
                    true,
                );
                let patch = glycoprotein_service::WindowSettingsPatch {
                    window_visible: Some(true),
                    ..Default::default()
                };
                let _ = app.emit(glycoprotein_service::WINDOW_SETTINGS_EVENT, patch);
            }
            None => {
                // 没有主窗口可唤起（异常状态）：直接退出，避免第二个进程静默驻留。
                app.exit(0);
            }
        }
    }));
    let app = app
        .manage(commands::AppDataCoordinator::default())
        .manage(glycoprotein_service::GlycoproteinService::default())
        .setup(|app| {
            logger::install_panic_hook(app.handle());
            logger::record_startup_event(app.handle(), "Tauri 应用初始化开始");
            logger::record_startup_event(app.handle(), "主窗口由 Tauri 配置创建");
            #[cfg(desktop)]
            setup_tray(app.handle())?;
            // 主窗口关闭 = 退出应用。
            // `tray-menu` 是启动时就创建好的隐藏窗口，如果只关闭主窗口，进程会留在后台，
            // 并被 single-instance 判定为“已在运行”，导致下一次启动看起来毫无反应。
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::CloseRequested { .. }) {
                        let _ = app_handle.save_window_state(WINDOW_STATE_FLAGS);
                        app_handle.exit(0);
                    }
                });
            }
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
            platform::runtime_layout,
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
            // 退出前再存一次窗口状态（正常路径上插件也会存，这里是兜底）。
            #[cfg(desktop)]
            let _ = app.save_window_state(WINDOW_STATE_FLAGS);
            // 退出兜底：Glycoprotein 节点停止或 WebView 清理若卡住，5 秒后强制结束进程，
            // 避免“关闭后仍有后台进程”进而让 single-instance 挡住下一次启动。
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(5));
                std::process::exit(0);
            });
            let service = app.state::<glycoprotein_service::GlycoproteinService>();
            tauri::async_runtime::block_on(service.shutdown(app));
        }
    });
}
