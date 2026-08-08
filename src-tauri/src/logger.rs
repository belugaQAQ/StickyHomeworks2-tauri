use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub(crate) const LOG_DIRECTORY: &str = "logs";
pub(crate) const LOG_FILE: &str = "app.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
static LOG_FILE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub(crate) struct DiagnosticLogSnapshot {
    pub(crate) entries: Vec<LogEntry>,
    pub(crate) files: Vec<(String, Vec<u8>)>,
}

pub(crate) fn install_panic_hook(app: &AppHandle) {
    let app = app.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("panic payload unavailable");
        let location = "";
        let _ = append_event(&app, LogEvent {
            level: "error".into(),
            operation: "rust.panic".into(),
            message: format!("{payload}{location}"),
            request_id: None,
            details: None,
        });
        previous(info);
    }));
}
pub(crate) fn record_startup_event(app: &AppHandle, message: &str) {
    let _ = append_event(app, LogEvent {
        level: "info".into(),
        operation: "app.startup".into(),
        message: message.into(),
        request_id: None,
        details: None,
    });
}

pub(crate) fn record_startup_error(app: &AppHandle, error: &str) {
    let _ = append_event(app, LogEvent {
        level: "error".into(),
        operation: "app.startup".into(),
        message: error.into(),
        request_id: None,
        details: None,
    });
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEvent {
    pub(crate) level: String,
    pub(crate) operation: String,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
    pub(crate) details: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    pub(crate) timestamp: String,
    pub(crate) level: String,
    pub(crate) operation: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) details: Option<serde_json::Value>,
}

pub(crate) fn append_event(app: &AppHandle, event: LogEvent) -> Result<(), String> {
    let entry = LogEntry {
        timestamp: timestamp(),
        level: normalize_level(&event.level),
        operation: limit_text(event.operation.trim(), 256),
        message: limit_text(&event.message.replace(['\r', '\n'], " "), 4096),
        request_id: event.request_id.map(|value| limit_text(value.trim(), 128)),
        details: event.details,
    };
    append_entry(&log_path(app)?, entry)
}

pub(crate) fn clear_logs(app: &AppHandle) -> Result<(), String> {
    let _guard = LOG_FILE_LOCK.lock().map_err(|error| error.to_string())?;
    let directory = log_directory(app)?;
    for suffix in [".2", ".1", "", ".3"] {
        let path = directory.join(format!("{LOG_FILE}{suffix}"));
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn diagnostic_log_snapshot(
    app: &AppHandle,
    max_entries: usize,
) -> Result<DiagnosticLogSnapshot, String> {
    let _guard = LOG_FILE_LOCK.lock().map_err(|error| error.to_string())?;
    let directory = log_directory(app)?;
    let mut entries = Vec::new();
    let mut files = Vec::new();
    for suffix in [".2", ".1", ""] {
        let path = directory.join(format!("{LOG_FILE}{suffix}"));
        if !path.exists() {
            continue;
        }
        let contents = fs::read(&path).map_err(|error| error.to_string())?;
        for line in String::from_utf8_lossy(&contents).lines() {
            if let Ok(entry) = serde_json::from_str::<LogEntry>(line) {
                if matches!(entry.level.as_str(), "WARN" | "ERROR") {
                    entries.push(entry);
                }
            }
        }
        files.push((format!("logs/{LOG_FILE}{suffix}"), contents));
    }
    if entries.len() > max_entries {
        let start = entries.len() - max_entries;
        entries.drain(..start);
    }
    Ok(DiagnosticLogSnapshot { entries, files })
}

fn append_entry(path: &Path, entry: LogEntry) -> Result<(), String> {
    let _guard = LOG_FILE_LOCK.lock().map_err(|error| error.to_string())?;
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())? + "\n";
    let directory = path.parent().ok_or("日志路径没有父目录")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    if path.exists()
        && fs::metadata(path).map_err(|error| error.to_string())?.len()
            .saturating_add(line.len() as u64) > MAX_LOG_BYTES
    {
        rotate_logs(directory)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(line.as_bytes()).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> { Ok(log_directory(app)?.join(LOG_FILE)) }
fn log_directory(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map(|directory| directory.join(LOG_DIRECTORY)).map_err(|error| error.to_string()) }
fn rotate_logs(directory: &Path) -> Result<(), String> {
    let current = directory.join(LOG_FILE);
    let one = directory.join(format!("{LOG_FILE}.1"));
    let two = directory.join(format!("{LOG_FILE}.2"));
    let stale = directory.join(format!("{LOG_FILE}.3"));
    let backup_current = directory.join(format!(".{LOG_FILE}.rotate-current"));
    let backup_one = directory.join(format!(".{LOG_FILE}.rotate-one"));
    let backup_two = directory.join(format!(".{LOG_FILE}.rotate-two"));
    for backup in [&backup_current, &backup_one, &backup_two] {
        if backup.exists() { fs::remove_file(backup).map_err(|error| error.to_string())?; }
    }
    if current.exists() { fs::rename(&current, &backup_current).map_err(|error| error.to_string())?; }
    if one.exists() { fs::rename(&one, &backup_one).map_err(|error| error.to_string())?; }
    if two.exists() { fs::rename(&two, &backup_two).map_err(|error| error.to_string())?; }
    let result = (|| {
        if backup_one.exists() { fs::rename(&backup_one, &two).map_err(|error| error.to_string())?; }
        if backup_current.exists() { fs::rename(&backup_current, &one).map_err(|error| error.to_string())?; }
        if stale.exists() { fs::remove_file(&stale).map_err(|error| error.to_string())?; }
        if backup_two.exists() { fs::remove_file(&backup_two).map_err(|error| error.to_string())?; }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&current);
        let _ = fs::remove_file(&one);
        let _ = fs::remove_file(&two);
        if backup_current.exists() { let _ = fs::rename(&backup_current, &current); }
        if backup_one.exists() { let _ = fs::rename(&backup_one, &one); }
        if backup_two.exists() { let _ = fs::rename(&backup_two, &two); }
    }
    result
}

fn timestamp() -> String { let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default(); format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis()) }
fn normalize_level(level: &str) -> String { match level.to_ascii_uppercase().as_str() { "DEBUG" => "DEBUG".into(), "WARN" | "WARNING" => "WARN".into(), "ERROR" => "ERROR".into(), _ => "INFO".into() } }
fn limit_text(value: &str, max: usize) -> String { value.chars().take(max).collect() }

#[cfg(test)]
mod tests {
    use super::{append_entry, normalize_level, rotate_logs, LogEntry, MAX_LOG_BYTES};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn levels_normalize() { assert_eq!(normalize_level("trace"), "INFO"); assert_eq!(normalize_level("warning"), "WARN"); }

    #[test]
    fn rotation_keeps_only_expected_files() {
        let directory = temp();
        fs::create_dir_all(&directory).unwrap();
        for suffix in ["", ".1", ".2", ".3"] { fs::write(directory.join(format!("app.log{suffix}")), b"old").unwrap(); }
        rotate_logs(&directory).unwrap();
        assert!(!directory.join("app.log").exists());
        assert!(directory.join("app.log.1").exists());
        assert!(directory.join("app.log.2").exists());
        assert!(!directory.join("app.log.3").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn concurrent_appends_preserve_entries() {
        let directory = temp();
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("app.log");
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        let workers: Vec<_> = (0..16).map(|index| { let path = path.clone(); std::thread::spawn(move || append_entry(&path, LogEntry { timestamp: index.to_string(), level: "INFO".into(), operation: "logger.test".into(), message: format!("entry-{index}"), request_id: None, details: None })) }).collect();
        for worker in workers { worker.join().unwrap().unwrap(); }
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), 16);
        fs::remove_dir_all(directory).unwrap();
    }

    fn temp() -> PathBuf { let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(); std::env::temp_dir().join(format!("stickyhomeworks2-logger-{nanos}")) }
}
