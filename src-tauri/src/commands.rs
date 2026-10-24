use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::{AppHandle, Emitter, Manager, State};

use serde::Serialize;

use crate::data::{AppData, AppSettings};
use crate::diagnostics::{diagnostic_report as create_diagnostic_report, DiagnosticDisclosure, DiagnosticEnvironment};
use crate::glycoprotein_service::{
    apply_window_settings, GlycoproteinService, GlycoproteinStatus, WindowSettingsPatch, WINDOW_SETTINGS_EVENT,
};
use crate::legacy_import::import_legacy_data_from_sources;
use crate::logger::{append_event, clear_logs, LogEvent};
use crate::persistence::{read_app_data as read_persisted_app_data, write_app_data};

const APP_STATE_FILE: &str = "app-state.json";

#[derive(Default)]
pub(crate) struct AppDataCoordinator {
    operation: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyImportResult {
    data: AppData,
    legacy_rich_text_count: usize,
    removed_tag_reference_count: usize,
    replaced_subject_count: usize,
}

#[tauri::command]
pub(crate) fn load_app_data(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    request_id: Option<String>,
) -> Result<AppData, String> {
    let _guard = coordinator
        .operation
        .lock()
        .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
    let mut data =
        load_current_app_data(&app).map_err(|error| record_error(&app, "app-data.load", error, request_id.clone()))?;
    let path = app_state_path(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
    // 写回归一化结果只是 best-effort：写失败不影响本次已读到的数据。
    if let Err(error) = write_app_data(&path, &mut data) {
        let _ = record_error(&app, "app-data.normalize", error, request_id.clone());
    }
    record_info(&app, "app-data.load", "应用数据加载完成", request_id);
    Ok(data)
}

fn load_current_app_data(app: &AppHandle) -> Result<AppData, String> {
    let path = app_state_path(app)?;
    if !path.exists() {
        return Ok(AppData::default());
    }

    match read_persisted_app_data(&path) {
        Ok(data) => Ok(data),
        Err(error) => recover_corrupted_app_data(app, &path, &error),
    }
}

fn recover_corrupted_app_data(app: &AppHandle, path: &Path, error: &str) -> Result<AppData, String> {
    let (data, backup) = recover_corrupted_app_data_files(path);
    let message = match &backup {
        Ok(name) => format!("应用数据损坏，已备份为 {name} 并回落到默认值：{error}"),
        Err(backup_error) => format!("应用数据损坏但备份失败（{backup_error}），保持原文件不动：{error}"),
    };
    let _ = append_event(
        app,
        LogEvent {
            level: "error".to_owned(),
            operation: "app-data.recovery".to_owned(),
            message: message.clone(),
            request_id: None,
            details: None,
        },
    );
    match backup {
        Ok(_) => Ok(data),
        Err(_) => Err(message),
    }
}

/// 可单测的恢复动作：返回默认数据与备份文件路径（`app-state.corrupt-<unix秒>.json`）。
fn recover_corrupted_app_data_files(path: &Path) -> (AppData, Result<String, String>) {
    (AppData::default(), backup_corrupted_app_data(path))
}

fn backup_corrupted_app_data(path: &Path) -> Result<String, String> {
    let directory = path.parent().ok_or("应用数据路径没有父目录")?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let stem = APP_STATE_FILE.strip_suffix(".json").unwrap_or(APP_STATE_FILE);
    let backup = directory.join(format!("{stem}.corrupt-{seconds}.json"));
    fs::rename(path, &backup).map_err(|error| error.to_string())?;
    Ok(backup.to_string_lossy().into_owned())
}
pub(crate) fn persisted_window_visibility(app: &AppHandle) -> Result<bool, String> {
    Ok(load_current_app_data(app)?.settings.window_visible)
}

pub(crate) fn set_persisted_window_visibility(
    app: &AppHandle,
    coordinator: &AppDataCoordinator,
    visible: bool,
) -> Result<(), String> {
    let _guard = coordinator.operation.lock().map_err(|error| error.to_string())?;
    let mut data = load_current_app_data(app)?;
    data.settings.window_visible = visible;
    let path = app_state_path(app)?;
    write_app_data(&path, &mut data)
}

#[tauri::command]
pub(crate) async fn save_app_data(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    glycoprotein: State<'_, GlycoproteinService>,
    data: AppData,
    request_id: Option<String>,
) -> Result<AppData, String> {
    let (previous, data) = {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        let previous = load_current_app_data(&app)
            .map_err(|error| record_error(&app, "app-data.load-before-save", error, request_id.clone()))?;
        let mut data = data;
        let path =
            app_state_path(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
        write_app_data(&path, &mut data)
            .map_err(|error| record_error(&app, "app-data.save", error, request_id.clone()))?;
        (previous, data)
    };

    let (data, _) = synchronize_runtime(&app, &coordinator, &glycoprotein, data, request_id.clone()).await?;
    if previous.homeworks != data.homeworks {
        glycoprotein.emit_homework_changed(&app, data.homeworks.len()).await;
    }
    record_info(&app, "app-data.save", "应用数据已保存", request_id);
    Ok(data)
}

#[tauri::command]
pub(crate) async fn import_legacy_data_contents(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    glycoprotein: State<'_, GlycoproteinService>,
    profile_contents: Option<String>,
    settings_contents: String,
    request_id: Option<String>,
) -> Result<LegacyImportResult, String> {
    let (previous_homeworks, result) = {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        let current_data = load_current_app_data(&app)
            .map_err(|error| record_error(&app, "legacy-import.load", error, request_id.clone()))?;
        let previous_homeworks = current_data.homeworks.clone();
        let mut result = import_legacy_data_from_sources(current_data, profile_contents.as_deref(), &settings_contents)
            .map_err(|error| record_error(&app, "legacy-import.parse", error, request_id.clone()))?;
        let path = app_state_path(&app)
            .map_err(|error| record_error(&app, "legacy-import.path", error, request_id.clone()))?;
        write_app_data(&path, &mut result.data)
            .map_err(|error| record_error(&app, "legacy-import.save", error, request_id.clone()))?;
        (previous_homeworks, result)
    };

    let (data, _) = synchronize_runtime(&app, &coordinator, &glycoprotein, result.data, request_id.clone()).await?;
    if previous_homeworks != data.homeworks {
        glycoprotein.emit_homework_changed(&app, data.homeworks.len()).await;
    }

    record_info(&app, "legacy-import.complete", "旧版数据导入完成", request_id);
    Ok(LegacyImportResult {
        data,
        legacy_rich_text_count: result.legacy_rich_text_count,
        removed_tag_reference_count: result.removed_tag_reference_count,
        replaced_subject_count: result.replaced_subject_count,
    })
}

#[tauri::command]
pub(crate) async fn initialize_glycoprotein(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    glycoprotein: State<'_, GlycoproteinService>,
    request_id: Option<String>,
) -> Result<GlycoproteinStatus, String> {
    let mut data = {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        load_current_app_data(&app)
            .map_err(|error| record_error(&app, "glycoprotein.initialize.load", error, request_id.clone()))?
    };
    correct_window_geometry_from_plugin(&app);
    let migrated = migrate_legacy_window_geometry(&app, &mut data);
    let (mut data, status) = synchronize_runtime(&app, &coordinator, &glycoprotein, data, request_id.clone()).await?;
    if migrated {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        let path =
            app_state_path(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
        if let Err(error) = write_app_data(&path, &mut data) {
            let _ = record_error(&app, "window.geometry.migrate.save", error, request_id.clone());
        }
    }
    record_info(
        &app,
        "glycoprotein.initialize",
        "Glycoprotein 运行时初始化完成",
        request_id,
    );
    Ok(status)
}

/// window-state 插件的状态文件路径（插件默认写在 app config dir 的 `.window-state.json`）。
fn window_state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join(".window-state.json"))
}

fn has_legacy_window_geometry(settings: &AppSettings) -> bool {
    settings.window_x.is_some()
        || settings.window_y.is_some()
        || settings.window_width.is_some()
        || settings.window_height.is_some()
}

fn migrate_legacy_window_geometry(app: &AppHandle, data: &mut AppData) -> bool {
    if !has_legacy_window_geometry(&data.settings) {
        return false;
    }

    let plugin_has_state = window_state_path(app).map(|path| path.exists()).unwrap_or(false);
    if !plugin_has_state {
        let width = data.settings.window_width;
        let height = data.settings.window_height;
        let x = data.settings.window_x;
        let y = data.settings.window_y;
        // 未装饰窗口在第一次 SetWindowPos 之前的 client/window 偏移包含一个标题栏高度，
        // 因此旧值恢复走 apply_window_geometry 的 settle 流程，避免多出一个标题栏。
        apply_window_geometry(app, width, height, x, y, true);
    }

    data.settings.window_x = None;
    data.settings.window_y = None;
    data.settings.window_width = None;
    data.settings.window_height = None;
    let _ = append_event(
        app,
        LogEvent {
            level: "info".to_owned(),
            operation: "window.geometry.migrate".to_owned(),
            message: if plugin_has_state {
                "旧窗口几何字段已清理（插件已有状态文件）".to_owned()
            } else {
                "旧窗口几何已迁移给 window-state 插件".to_owned()
            },
            request_id: None,
            details: None,
        },
    );
    true
}

/// `.window-state.json` 里 `main` 窗口保存的几何（物理像素，inner size + outer position）。
struct SavedWindowGeometry {
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
}

fn read_saved_window_geometry(app: &AppHandle) -> Option<SavedWindowGeometry> {
    let path = window_state_path(app)?;
    let contents = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    let main = value.get("main")?;
    Some(SavedWindowGeometry {
        width: main.get("width")?.as_f64()?,
        height: main.get("height")?.as_f64()?,
        x: main.get("x").and_then(serde_json::Value::as_f64),
        y: main.get("y").and_then(serde_json::Value::as_f64),
    })
}

fn apply_window_geometry(
    app: &AppHandle,
    width: Option<f64>,
    height: Option<f64>,
    x: Option<f64>,
    y: Option<f64>,
    settle_first: bool,
) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if settle_first {
        if let Ok(current) = window.inner_size() {
            let _ = window.set_size(current);
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
    }

    if let (Some(width), Some(height)) = (width, height) {
        let _ = window.set_size(tauri::PhysicalSize::new(
            width.round().max(1.0) as u32,
            height.round().max(1.0) as u32,
        ));
    }
    if let (Some(x), Some(y)) = (x, y) {
        let _ = window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
}

/// 主窗口可恢复的最小尺寸，避免插件里落进历史坏值（如最小化期间的 160x28）后被永久恢复。
const MIN_WINDOW_WIDTH: f64 = 240.0;
const MIN_WINDOW_HEIGHT: f64 = 160.0;

fn correct_window_geometry_from_plugin(app: &AppHandle) {
    if let Some(saved) = read_saved_window_geometry(app) {
        // 插件保存的值没有下限校验，这里补上等价于 `normalize_window_dimension` 的保护。
        let width = saved.width.max(MIN_WINDOW_WIDTH);
        let height = saved.height.max(MIN_WINDOW_HEIGHT);
        apply_window_geometry(app, Some(width), Some(height), saved.x, saved.y, false);
    }
}

#[tauri::command]
pub(crate) async fn glycoprotein_status(
    glycoprotein: State<'_, GlycoproteinService>,
) -> Result<GlycoproteinStatus, String> {
    Ok(glycoprotein.status().await)
}

#[tauri::command]
pub(crate) fn log_event(app: AppHandle, event: LogEvent) -> Result<(), String> {
    append_event(&app, event)
}

#[tauri::command]
pub(crate) fn diagnostic_report(
    app: AppHandle,
    environment: DiagnosticEnvironment,
    disclosure: Option<DiagnosticDisclosure>,
    app_data: Option<AppData>,
    request_id: Option<String>,
) -> Result<String, String> {
    let report = create_diagnostic_report(&app, environment, disclosure.unwrap_or_default(), app_data)
        .map_err(|error| record_error(&app, "diagnostic-report.build", error, request_id.clone()))?;
    record_info(&app, "diagnostic-report.build", "诊断报告已生成", request_id);
    Ok(report)
}

#[tauri::command]
pub(crate) fn export_diagnostic_bundle(
    app: AppHandle,
    environment: DiagnosticEnvironment,
    disclosure: Option<DiagnosticDisclosure>,
    app_data: Option<AppData>,
    request_id: Option<String>,
) -> Result<String, String> {
    let bundle = crate::diagnostics::diagnostic_bundle(&app, environment, disclosure.unwrap_or_default(), app_data)
        .map_err(|error| record_error(&app, "diagnostic-bundle.build", error, request_id.clone()))?;
    record_info(&app, "diagnostic-bundle.build", "诊断包已生成", request_id);
    // 接口约定：返回标准 Base64 字符串，前端用 atob 解码。
    Ok(STANDARD.encode(&bundle))
}

#[tauri::command]
pub(crate) fn clear_diagnostic_logs(app: AppHandle, request_id: Option<String>) -> Result<(), String> {
    clear_logs(&app).map_err(|error| record_error(&app, "diagnostic.log.clear", error, request_id.clone()))?;
    Ok(())
}

async fn synchronize_runtime(
    app: &AppHandle,
    coordinator: &AppDataCoordinator,
    glycoprotein: &GlycoproteinService,
    mut data: AppData,
    request_id: Option<String>,
) -> Result<(AppData, GlycoproteinStatus), String> {
    let status = glycoprotein.reconcile(app, &data.settings).await;
    if status.enabled && !status.running && !data.settings.window_visible {
        data.settings.window_visible = true;
        {
            let _guard = coordinator
                .operation
                .lock()
                .map_err(|error| record_error(app, "app-data.lock", error.to_string(), request_id.clone()))?;
            let path =
                app_state_path(app).map_err(|error| record_error(app, "app-data.path", error, request_id.clone()))?;
            write_app_data(&path, &mut data)
                .map_err(|error| record_error(app, "glycoprotein.window-visible.recover", error, request_id.clone()))?;
        }
        let patch = WindowSettingsPatch {
            window_visible: Some(true),
            ..WindowSettingsPatch::default()
        };
        if let Err(error) = app.emit(WINDOW_SETTINGS_EVENT, patch) {
            let _ = record_error(
                app,
                "glycoprotein.window-visible.emit",
                error.to_string(),
                request_id.clone(),
            );
        }
        let _ = append_event(
            app,
            LogEvent {
                level: "warn".to_owned(),
                operation: "glycoprotein.window-visible.recover".to_owned(),
                message: "Glycoprotein 节点不可用，已强制显示主窗口".to_owned(),
                request_id: request_id.clone(),
                details: None,
            },
        );
    }

    if let Err(error) = apply_window_settings(app, &data.settings) {
        let _ = record_error(app, "window.settings.apply", error, request_id);
    }
    Ok((data, status))
}

fn record_info(app: &AppHandle, operation: &str, message: &str, request_id: Option<String>) {
    let _ = append_event(
        app,
        LogEvent {
            level: "info".to_owned(),
            operation: operation.to_owned(),
            message: message.to_owned(),
            request_id,
            details: None,
        },
    );
}
fn record_error(app: &AppHandle, operation: &str, error: String, request_id: Option<String>) -> String {
    let _ = append_event(
        app,
        LogEvent {
            level: "error".to_owned(),
            operation: operation.to_owned(),
            message: error.clone(),
            request_id,
            details: None,
        },
    );
    error
}

fn app_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(data_dir.join(APP_STATE_FILE))
}

#[cfg(test)]
mod tests {
    use super::recover_corrupted_app_data_files;
    use crate::data::AppData;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn corrupted_app_data_is_backed_up_and_falls_back_to_default() {
        let directory = std::env::temp_dir().join(format!("stickyhomeworks2-recovery-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temp directory should be created");
        let path = directory.join("app-state.json");
        fs::write(&path, b"{ not a valid app state").expect("corrupted fixture should be written");

        let (data, backup) = recover_corrupted_app_data_files(&path);

        // `AppData::default()` 的 glycoprotein 节点 ID 是随机的，比较时先对齐。
        let mut expected = AppData::default();
        expected.settings.glycoprotein_node_id = data.settings.glycoprotein_node_id.clone();
        assert_eq!(data, expected);
        let backup = backup.expect("损坏文件应被备份");
        let backup_name = std::path::Path::new(&backup)
            .file_name()
            .expect("backup should have a file name")
            .to_string_lossy()
            .into_owned();
        assert!(backup_name.starts_with("app-state.corrupt-"));
        assert!(backup_name.ends_with(".json"));
        assert!(!path.exists());
        assert!(std::path::Path::new(&backup).exists());
        fs::remove_dir_all(directory).expect("temp directory should be removed");
    }
}
