use serde::Deserialize;

use tauri::AppHandle;

use crate::data::AppData;
use crate::diagnostic_archive::write_diagnostic_bundle;
use crate::logger::diagnostic_log_snapshot;

const MAX_REPORT_ENTRIES: usize = 80;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DiagnosticDisclosure {
    Standard,
    Extended,
    Full,
}

impl Default for DiagnosticDisclosure {
    fn default() -> Self { Self::Standard }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticEnvironment {
    pub(crate) app_version: String,
    pub(crate) operating_system: String,
    pub(crate) tauri_runtime: String,
    pub(crate) web_view: String,
    pub(crate) viewport: String,
    pub(crate) schema_version: u32,
}

pub(crate) fn diagnostic_report(
    app: &AppHandle,
    environment: DiagnosticEnvironment,
    disclosure: DiagnosticDisclosure,
    app_data: Option<AppData>,
) -> Result<String, String> {
    let snapshot = diagnostic_log_snapshot(app, MAX_REPORT_ENTRIES)?;
    Ok(format_report(&environment, &snapshot.entries, disclosure, app_data.as_ref()))
}

pub(crate) fn export_diagnostic_bundle(
    app: &AppHandle,
    destination: &std::path::Path,
    environment: DiagnosticEnvironment,
    disclosure: DiagnosticDisclosure,
    app_data: Option<AppData>,
) -> Result<(), String> {
    let snapshot = diagnostic_log_snapshot(app, MAX_REPORT_ENTRIES)?;
    let report = format_report(&environment, &snapshot.entries, disclosure, app_data.as_ref());
    let app_state = if disclosure == DiagnosticDisclosure::Full {
        app_data.map(|data| serde_json::to_vec_pretty(&data).map_err(|error| error.to_string())).transpose()?
    } else {
        None
    };
    let log_files = if disclosure == DiagnosticDisclosure::Full { snapshot.files } else { Vec::new() };
    write_diagnostic_bundle(destination, app_state.as_deref(), &log_files, &report)
}

fn format_report(
    environment: &DiagnosticEnvironment,
    entries: &[crate::logger::LogEntry],
    disclosure: DiagnosticDisclosure,
    app_data: Option<&AppData>,
) -> String {
    let mut report = format!(
        "StickyHomeworks2 诊断信息\n应用版本：{}\n操作系统：{}\nTauri 运行时：{}\nWebView 运行时：{}\n视口：{}\nschemaVersion：{}\n诊断级别：{}\n日志条目：{}\n\n",
        environment.app_version,
        environment.operating_system,
        environment.tauri_runtime,
        environment.web_view,
        environment.viewport,
        environment.schema_version,
        disclosure_name(disclosure),
        entries.len()
    );
    for entry in entries {
        let request_id = if disclosure == DiagnosticDisclosure::Standard { String::new() } else {
            entry.request_id.as_deref().map(|value| format!(" [{value}]" )).unwrap_or_default()
        };
        let details = if disclosure == DiagnosticDisclosure::Standard { String::new() } else {
            entry.details.as_ref().map(|value| format!(" {}", value)).unwrap_or_default()
        };
        report.push_str(&format!("{} {} {}{}：{}{}\n", entry.timestamp, entry.level, entry.operation, request_id, entry.message, details));
    }
    if disclosure == DiagnosticDisclosure::Full {
        if let Some(data) = app_data {
            if let Ok(contents) = serde_json::to_string_pretty(data) {
                report.push_str("\n当前 AppData：\n");
                report.push_str(&contents);
                report.push('\n');
            }
        }
    }
    report
}

fn disclosure_name(disclosure: DiagnosticDisclosure) -> &'static str {
    match disclosure { DiagnosticDisclosure::Standard => "standard", DiagnosticDisclosure::Extended => "extended", DiagnosticDisclosure::Full => "full" }
}
