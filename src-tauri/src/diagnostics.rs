use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LOG_DIRECTORY: &str = "logs";
const LOG_FILE: &str = "app.log";
const MAX_REPORT_ENTRIES: usize = 80;
const APP_STATE_FILE: &str = "app-state.json";
static DIAGNOSTIC_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    timestamp: String,
    level: String,
    operation: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

pub(crate) fn diagnostic_report(
    app: &AppHandle,
    environment: DiagnosticEnvironment,
) -> Result<String, String> {
    let _guard = DIAGNOSTIC_LOCK.lock().map_err(|error| error.to_string())?;
    create_diagnostic_report(app, &environment)
}

pub(crate) fn export_diagnostic_bundle(
    app: &AppHandle,
    destination: &Path,
    environment: DiagnosticEnvironment,
) -> Result<(), String> {
    let _guard = DIAGNOSTIC_LOCK.lock().map_err(|error| error.to_string())?;
    let report = create_diagnostic_report(app, &environment)?;
    let app_state_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(APP_STATE_FILE);
    write_diagnostic_bundle(destination, &app_state_path, &log_directory(app)?, &report)
}

fn create_diagnostic_report(
    app: &AppHandle,
    environment: &DiagnosticEnvironment,
) -> Result<String, String> {
    let mut entries = Vec::new();
    let directory = log_directory(app)?;
    for suffix in [".2", ".1", ""] {
        let path = directory.join(format!("{LOG_FILE}{suffix}"));
        if !path.exists() {
            continue;
        }
        let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
        for line in source.lines() {
            let Ok(entry) = serde_json::from_str::<LogEntry>(line) else {
                continue;
            };
            if matches!(entry.level.as_str(), "WARN" | "ERROR") {
                entries.push(entry);
            }
        }
    }
    let report_entries = &entries[entries.len().saturating_sub(MAX_REPORT_ENTRIES)..];
    let mut report = format!(
        "StickyHomeworks2 诊断信息\n应用版本：{}\n操作系统：{}\nTauri 运行时：{}\nWebView 运行时：{}\n视口：{}\nschemaVersion：{}\n日志条目：{}\n\n",
        environment.app_version, environment.operating_system, environment.tauri_runtime,
        environment.web_view, environment.viewport, environment.schema_version, report_entries.len()
    );
    for entry in report_entries {
        let request_id = entry
            .request_id
            .as_deref()
            .map(|value| format!(" [{value}]"))
            .unwrap_or_default();
        report.push_str(&format!(
            "{} {} {}{}：{}\n",
            entry.timestamp, entry.level, entry.operation, request_id, entry.message
        ));
    }
    Ok(report)
}

fn log_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LOG_DIRECTORY))
        .map_err(|error| error.to_string())
}

fn write_diagnostic_bundle(
    destination: &Path,
    app_state_path: &Path,
    log_directory: &Path,
    report: &str,
) -> Result<(), String> {
    let parent = destination.parent().ok_or("诊断包路径没有父目录")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(
        ".diagnostic-bundle-{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    let output = File::create(&temporary).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipWriter::new(output);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let result = (|| -> Result<(), String> {
        archive
            .start_file("diagnostic-report.txt", options)
            .map_err(|error| error.to_string())?;
        archive
            .write_all(report.as_bytes())
            .map_err(|error| error.to_string())?;
        if app_state_path.exists() {
            write_bundle_file(&mut archive, "app-state.json", app_state_path, options)?;
        }
        for suffix in [".2", ".1", ""] {
            let path = log_directory.join(format!("{LOG_FILE}{suffix}"));
            if path.exists() {
                write_bundle_file(
                    &mut archive,
                    &format!("logs/{LOG_FILE}{suffix}"),
                    &path,
                    options,
                )?;
            }
        }
        archive.finish().map_err(|error| error.to_string())?;
        replace_bundle_file(&temporary, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn replace_bundle_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    match fs::rename(temporary, destination) {
        Ok(()) => Ok(()),
        Err(error) if destination.exists() => {
            let backup = temporary.with_extension("previous");
            fs::rename(destination, &backup).map_err(|_| error.to_string())?;
            match fs::rename(temporary, destination) {
                Ok(()) => {
                    let _ = fs::remove_file(backup);
                    Ok(())
                }
                Err(replace_error) => {
                    let _ = fs::rename(&backup, destination);
                    Err(replace_error.to_string())
                }
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_bundle_file(
    archive: &mut zip::ZipWriter<File>,
    archive_path: &str,
    source_path: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    archive
        .start_file(archive_path, options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(&fs::read(source_path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}
