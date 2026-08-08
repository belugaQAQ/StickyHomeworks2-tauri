use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use serde::Serialize;

use crate::data::AppData;
use crate::diagnostics::{
    diagnostic_report as create_diagnostic_report, export_diagnostic_bundle, DiagnosticDisclosure,
    DiagnosticEnvironment,
};
use crate::legacy_import::import_legacy_data_from_sources;
use crate::logger::{append_event, clear_logs, LogEvent};
use crate::persistence::{read_app_data as read_persisted_app_data, write_app_data};

const APP_STATE_FILE: &str = "app-state.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyImportResult {
    data: AppData,
    legacy_rich_text_count: usize,
    removed_tag_reference_count: usize,
    replaced_subject_count: usize,
}

#[tauri::command]
pub(crate) fn load_app_data(app: AppHandle, request_id: Option<String>) -> Result<AppData, String> {
    let data = load_current_app_data(&app)
        .map_err(|error| record_error(&app, "app-data.load", error, request_id.clone()))?;
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
pub(crate) fn save_app_data(
    app: AppHandle,
    data: AppData,
    request_id: Option<String>,
) -> Result<(), String> {
    let path = app_state_path(&app)
        .map_err(|error| record_error(&app, "app-data.path", error, request_id.clone()))?;
    let mut data = data;
    write_app_data(&path, &mut data)
        .map_err(|error| record_error(&app, "app-data.save", error, request_id.clone()))?;
    record_info(&app, "app-data.save", "应用数据已保存", request_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn import_legacy_data_contents(
    app: AppHandle,
    profile_contents: Option<String>,
    settings_contents: String,
    request_id: Option<String>,
) -> Result<LegacyImportResult, String> {
    let current_data = load_current_app_data(&app)
        .map_err(|error| record_error(&app, "legacy-import.load", error, request_id.clone()))?;
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

    record_info(
        &app,
        "legacy-import.complete",
        "旧版数据导入完成",
        request_id,
    );
    Ok(LegacyImportResult {
        data: result.data,
        legacy_rich_text_count: result.legacy_rich_text_count,
        removed_tag_reference_count: result.removed_tag_reference_count,
        replaced_subject_count: result.replaced_subject_count,
    })
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
    let report = create_diagnostic_report(&app, environment, disclosure.unwrap_or_default(), app_data).map_err(|error| {
        record_error(&app, "diagnostic-report.build", error, request_id.clone())
    })?;
    record_info(&app, "diagnostic-report.build", "诊断报告已生成", request_id);
    Ok(report)
}

#[tauri::command]
pub(crate) fn export_diagnostic_bundle_to_path(
    app: AppHandle,
    destination: PathBuf,
    environment: DiagnosticEnvironment,
    disclosure: Option<DiagnosticDisclosure>,
    app_data: Option<AppData>,
    request_id: Option<String>,
) -> Result<(), String> {
    export_diagnostic_bundle(&app, &destination, environment, disclosure.unwrap_or_default(), app_data).map_err(|error| {
        record_error(&app, "diagnostic-bundle.export", error, request_id.clone())
    })?;
    record_info(&app, "diagnostic-bundle.export", "诊断包已导出", request_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn clear_diagnostic_logs(
    app: AppHandle,
    request_id: Option<String>,
) -> Result<(), String> {
    clear_logs(&app).map_err(|error| {
        record_error(&app, "diagnostic.log.clear", error, request_id.clone())
    })?;
    Ok(())
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
