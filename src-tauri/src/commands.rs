use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::{AppHandle, Emitter, Manager, State};

use serde::Serialize;

use crate::data::{normalize_app_data, AppData, AppSettings};
use crate::diagnostics::{diagnostic_report as create_diagnostic_report, DiagnosticDisclosure, DiagnosticEnvironment};
use crate::glycoprotein_service::{
    apply_window_settings, GlycoproteinService, GlycoproteinStatus, WindowSettingsPatch, WINDOW_SETTINGS_EVENT,
};
use crate::legacy_import::import_legacy_data_from_sources;
use crate::logger::{append_event, clear_logs, LogEvent};
use crate::persistence::{read_app_data as read_persisted_app_data, write_app_data, write_app_data_preserving_profile};
use crate::time_machine::{self, SnapshotDetail, SnapshotSource, SnapshotSummary, TIME_MACHINE_DIRECTORY};

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
    let mut data = load_current_app_data(&app, request_id.clone())
        .map_err(|error| record_error(&app, "app-data.load", error, request_id.clone()))?;
    let directory =
        app_data_directory(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
    // 写回归一化结果只是 best-effort：写失败不影响本次已读到的数据。
    if let Err(error) = write_app_data(&directory, &mut data) {
        let _ = record_error(&app, "app-data.normalize", error, request_id.clone());
    }
    record_info(&app, "app-data.load", "应用数据加载完成", request_id);
    Ok(data)
}

fn load_current_app_data(app: &AppHandle, request_id: Option<String>) -> Result<AppData, String> {
    let directory = app_data_directory(app)?;
    let outcome = read_persisted_app_data(&directory).map_err(|error| error.to_string())?;
    for notice in &outcome.notices {
        let _ = append_event(
            app,
            LogEvent {
                level: "warn".to_owned(),
                operation: "app-data.recovery".to_owned(),
                message: notice.clone(),
                request_id: request_id.clone(),
                details: None,
            },
        );
    }
    Ok(outcome.data)
}

pub(crate) fn persisted_window_visibility(app: &AppHandle) -> Result<bool, String> {
    Ok(load_current_app_data(app, None)?.settings.window_visible)
}

pub(crate) fn set_persisted_window_visibility(
    app: &AppHandle,
    coordinator: &AppDataCoordinator,
    visible: bool,
) -> Result<(), String> {
    let _guard = coordinator.operation.lock().map_err(|error| error.to_string())?;
    let mut data = load_current_app_data(app, None)?;
    data.settings.window_visible = visible;
    let directory = app_data_directory(app)?;
    write_app_data(&directory, &mut data)
}

#[tauri::command]
pub(crate) async fn save_app_data(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    glycoprotein: State<'_, GlycoproteinService>,
    data: AppData,
    source: SnapshotSource,
    request_id: Option<String>,
) -> Result<AppData, String> {
    let (previous, data) = {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        let previous = load_current_app_data(&app, request_id.clone())
            .map_err(|error| record_error(&app, "app-data.load-before-save", error, request_id.clone()))?;
        let mut data = data;
        let directory =
            app_data_directory(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
        // 先归一化再比较，否则比较的是未归一化的输入，会产生假的历史记录。
        normalize_app_data(&mut data);
        write_app_data_preserving_profile(&directory, &mut data, &previous.homeworks)
            .map_err(|error| record_error(&app, "app-data.save", error, request_id.clone()))?;
        record_after_change(&app, &directory, &previous, &data, source, request_id.clone());
        prune_time_machine(&app, &snapshot_root(&directory), request_id.clone());
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
    settings_contents: Option<String>,
    request_id: Option<String>,
) -> Result<LegacyImportResult, String> {
    let (previous_homeworks, result) = {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        let current_data = load_current_app_data(&app, request_id.clone())
            .map_err(|error| record_error(&app, "legacy-import.load", error, request_id.clone()))?;
        let previous_homeworks = current_data.homeworks.clone();
        let previous_data = current_data.clone();
        let mut result =
            import_legacy_data_from_sources(current_data, profile_contents.as_deref(), settings_contents.as_deref())
                .map_err(|error| record_error(&app, "legacy-import.parse", error, request_id.clone()))?;
        let directory = app_data_directory(&app)
            .map_err(|error| record_error(&app, "legacy-import.path", error, request_id.clone()))?;
        normalize_app_data(&mut result.data);
        write_app_data(&directory, &mut result.data)
            .map_err(|error| record_error(&app, "legacy-import.save", error, request_id.clone()))?;
        record_after_change(
            &app,
            &directory,
            &previous_data,
            &result.data,
            SnapshotSource::LegacyImport,
            request_id.clone(),
        );
        prune_time_machine(&app, &snapshot_root(&directory), request_id.clone());
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
        load_current_app_data(&app, request_id.clone())
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
        let directory =
            app_data_directory(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
        if let Err(error) = write_app_data(&directory, &mut data) {
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

/// 记录快照的时间戳统一用 UTC 毫秒；id 也由它派生。
fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn snapshot_root(directory: &Path) -> PathBuf {
    directory.join(TIME_MACHINE_DIRECTORY)
}

///
/// 备份失败只记日志，不连累用户正在做的业务操作；恢复前的那次备份例外，由调用方中止。
fn record_after_change(
    app: &AppHandle,
    directory: &Path,
    previous: &AppData,
    next: &AppData,
    source: SnapshotSource,
    request_id: Option<String>,
) {
    if !time_machine::payload_changed(previous, next) {
        return;
    }
    if let Err(error) = time_machine::record_snapshot(&snapshot_root(directory), next, source, now_millis()) {
        let _ = record_error(app, "time-machine.record", format!("记录快照失败：{error}"), request_id);
    }
}

/// 每次保存后都跑一次清理，而不是只在「这次确实记了快照」时才跑：
/// 用户可能好几天只改设置不动作业，过期快照也需要有机会被删掉。
fn prune_time_machine(app: &AppHandle, root: &Path, request_id: Option<String>) {
    match time_machine::prune_snapshots(root, now_millis()) {
        Ok(0) => {}
        Ok(removed) => record_info(
            app,
            "time-machine.prune",
            &format!("已清理 {removed} 份过期快照"),
            request_id,
        ),
        Err(error) => {
            // 清理失败不回滚已经成功的业务保存。
            let _ = record_error(app, "time-machine.prune", error, request_id);
        }
    }
}

#[tauri::command]
pub(crate) fn list_time_machine_snapshots(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    request_id: Option<String>,
) -> Result<Vec<SnapshotSummary>, String> {
    let _guard = coordinator
        .operation
        .lock()
        .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
    let directory =
        app_data_directory(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
    let (summaries, notices) = time_machine::list_snapshots(&snapshot_root(&directory))
        .map_err(|error| record_error(&app, "time-machine.list", error, request_id.clone()))?;
    for notice in notices {
        let _ = append_event(
            &app,
            LogEvent {
                level: "warn".to_owned(),
                operation: "time-machine.list".to_owned(),
                message: notice,
                request_id: request_id.clone(),
                details: None,
            },
        );
    }
    Ok(summaries)
}

#[tauri::command]
pub(crate) fn read_time_machine_snapshot(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    id: String,
    request_id: Option<String>,
) -> Result<SnapshotDetail, String> {
    let _guard = coordinator
        .operation
        .lock()
        .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
    let directory =
        app_data_directory(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
    time_machine::read_snapshot(&snapshot_root(&directory), &id)
        .map_err(|error| record_error(&app, "time-machine.read", error, request_id.clone()))
}

/// 恢复快照：只替换作业与词库，其他运行时设置不动，因此不调用 `synchronize_runtime`。
#[tauri::command]
pub(crate) async fn restore_time_machine_snapshot(
    app: AppHandle,
    coordinator: State<'_, AppDataCoordinator>,
    glycoprotein: State<'_, GlycoproteinService>,
    id: String,
    request_id: Option<String>,
) -> Result<AppData, String> {
    let (data, homeworks_changed) = {
        let _guard = coordinator
            .operation
            .lock()
            .map_err(|error| record_error(&app, "app-data.lock", error.to_string(), request_id.clone()))?;
        let current = load_current_app_data(&app, request_id.clone())
            .map_err(|error| record_error(&app, "time-machine.restore.load", error, request_id.clone()))?;
        let directory =
            app_data_directory(&app).map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
        let root = snapshot_root(&directory);
        let detail = time_machine::read_snapshot(&root, &id)
            .map_err(|error| record_error(&app, "time-machine.restore.read", error, request_id.clone()))?;

        // 恢复会覆盖数据，所以这次备份必须成功：没有退路就不动用户的数据。
        time_machine::record_snapshot(&root, &current, SnapshotSource::SnapshotRestore, now_millis()).map_err(
            |error| {
                record_error(
                    &app,
                    "time-machine.restore.backup",
                    format!("恢复前备份失败：{error}"),
                    request_id.clone(),
                )
            },
        )?;

        let mut next = time_machine::apply_snapshot(current.clone(), detail);
        let homeworks_changed = next.homeworks != current.homeworks;
        write_app_data_preserving_profile(&directory, &mut next, &current.homeworks)
            .map_err(|error| record_error(&app, "time-machine.restore.save", error, request_id.clone()))?;

        if let Err(error) = time_machine::record_snapshot(&root, &next, SnapshotSource::SnapshotRestore, now_millis()) {
            let _ = record_error(
                &app,
                "time-machine.restore.record",
                format!("恢复后记录快照失败：{error}"),
                request_id.clone(),
            );
        }

        prune_time_machine(&app, &root, request_id.clone());
        (next, homeworks_changed)
    };

    if homeworks_changed {
        glycoprotein.emit_homework_changed(&app, data.homeworks.len()).await;
    }
    record_info(&app, "time-machine.restore", "已恢复时间机器快照", request_id);
    Ok(data)
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
            let directory = app_data_directory(app)
                .map_err(|error| record_error(app, "app-data.path", error, request_id.clone()))?;
            write_app_data(&directory, &mut data)
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

fn app_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}
