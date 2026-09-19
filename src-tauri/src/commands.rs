use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use serde::Serialize;

use crate::data::AppData;
use crate::diagnostics::{
    diagnostic_report as create_diagnostic_report, DiagnosticDisclosure, DiagnosticEnvironment,
};
use crate::glycoprotein_service::{
    apply_window_settings, GlycoproteinService, GlycoproteinStatus, WindowSettingsPatch,
    WINDOW_SETTINGS_EVENT,
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
    let _guard = coordinator.operation.lock().map_err(|error| {
        record_error(&app, "app-data.lock", error.to_string(), request_id.clone())
    })?;
    let mut data = load_current_app_data(&app)
        .map_err(|error| record_error(&app, "app-data.load", error, request_id.clone()))?;
    let path = app_state_path(&app)
        .map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
    write_app_data(&path, &mut data)
        .map_err(|error| record_error(&app, "app-data.normalize", error, request_id.clone()))?;
    record_info(&app, "app-data.load", "应用数据加载完成", request_id);
    Ok(data)
}

fn load_current_app_data(app: &AppHandle) -> Result<AppData, String> {
    let path = app_state_path(app)?;
    if !path.exists() {
        return Ok(AppData::default());
    }

    read_persisted_app_data(&path)
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
        let _guard = coordinator.operation.lock().map_err(|error| {
            record_error(&app, "app-data.lock", error.to_string(), request_id.clone())
        })?;
        let previous = load_current_app_data(&app).map_err(|error| {
            record_error(&app, "app-data.load-before-save", error, request_id.clone())
        })?;
        let mut data = data;
        let path = app_state_path(&app)
            .map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
        write_app_data(&path, &mut data)
            .map_err(|error| record_error(&app, "app-data.save", error, request_id.clone()))?;
        (previous, data)
    };

    let (data, _) =
        synchronize_runtime(&app, &coordinator, &glycoprotein, data, request_id.clone()).await?;
    if previous.homeworks != data.homeworks {
        glycoprotein
            .emit_homework_changed(&app, data.homeworks.len())
            .await;
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
        let _guard = coordinator.operation.lock().map_err(|error| {
            record_error(&app, "app-data.lock", error.to_string(), request_id.clone())
        })?;
        let current_data = load_current_app_data(&app)
            .map_err(|error| record_error(&app, "legacy-import.load", error, request_id.clone()))?;
        let previous_homeworks = current_data.homeworks.clone();
        let mut result = import_legacy_data_from_sources(
            current_data,
            profile_contents.as_deref(),
            &settings_contents,
        )
        .map_err(|error| record_error(&app, "legacy-import.parse", error, request_id.clone()))?;
        let path = app_state_path(&app)
            .map_err(|error| record_error(&app, "legacy-import.path", error, request_id.clone()))?;
        write_app_data(&path, &mut result.data)
            .map_err(|error| record_error(&app, "legacy-import.save", error, request_id.clone()))?;
        (previous_homeworks, result)
    };

    let (data, _) = synchronize_runtime(
        &app,
        &coordinator,
        &glycoprotein,
        result.data,
        request_id.clone(),
    )
    .await?;
    if previous_homeworks != data.homeworks {
        glycoprotein
            .emit_homework_changed(&app, data.homeworks.len())
            .await;
    }

    record_info(
        &app,
        "legacy-import.complete",
        "旧版数据导入完成",
        request_id,
    );
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
    let data = {
        let _guard = coordinator.operation.lock().map_err(|error| {
            record_error(&app, "app-data.lock", error.to_string(), request_id.clone())
        })?;
        load_current_app_data(&app).map_err(|error| {
            record_error(
                &app,
                "glycoprotein.initialize.load",
                error,
                request_id.clone(),
            )
        })?
    };
    let (_, status) =
        synchronize_runtime(&app, &coordinator, &glycoprotein, data, request_id.clone()).await?;
    record_info(
        &app,
        "glycoprotein.initialize",
        "Glycoprotein 运行时初始化完成",
        request_id,
    );
    Ok(status)
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
    let report =
        create_diagnostic_report(&app, environment, disclosure.unwrap_or_default(), app_data)
            .map_err(|error| {
                record_error(&app, "diagnostic-report.build", error, request_id.clone())
            })?;
    record_info(
        &app,
        "diagnostic-report.build",
        "诊断报告已生成",
        request_id,
    );
    Ok(report)
}

#[tauri::command]
pub(crate) fn export_diagnostic_bundle(
    app: AppHandle,
    environment: DiagnosticEnvironment,
    disclosure: Option<DiagnosticDisclosure>,
    app_data: Option<AppData>,
    request_id: Option<String>,
) -> Result<Vec<u8>, String> {
    let bundle = crate::diagnostics::diagnostic_bundle(
        &app,
        environment,
        disclosure.unwrap_or_default(),
        app_data,
    )
    .map_err(|error| record_error(&app, "diagnostic-bundle.build", error, request_id.clone()))?;
    record_info(&app, "diagnostic-bundle.build", "诊断包已生成", request_id);
    Ok(bundle)
}

#[tauri::command]
pub(crate) fn clear_diagnostic_logs(
    app: AppHandle,
    request_id: Option<String>,
) -> Result<(), String> {
    clear_logs(&app)
        .map_err(|error| record_error(&app, "diagnostic.log.clear", error, request_id.clone()))?;
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
    if !status.running && !data.settings.window_visible {
        data.settings.window_visible = true;
        {
            let _guard = coordinator.operation.lock().map_err(|error| {
                record_error(app, "app-data.lock", error.to_string(), request_id.clone())
            })?;
            let path = app_state_path(app)
                .map_err(|error| record_error(app, "app-data.path", error, request_id.clone()))?;
            write_app_data(&path, &mut data).map_err(|error| {
                record_error(
                    app,
                    "glycoprotein.window-visible.recover",
                    error,
                    request_id.clone(),
                )
            })?;
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

    if let Err(error) = apply_window_settings(app, &data.settings, status.running) {
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
fn record_error(
    app: &AppHandle,
    operation: &str,
    error: String,
    request_id: Option<String>,
) -> String {
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
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join(APP_STATE_FILE))
}
