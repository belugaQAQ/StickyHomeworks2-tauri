use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LOG_DIRECTORY: &str = "logs";
const LOG_FILE: &str = "app.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const MAX_LOG_FILES: usize = 3;

static LOG_FILE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub(crate) fn install_panic_hook(app: &tauri::AppHandle) {
    let app = app.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("panic payload unavailable");
        let location = panic_info
            .location()
            .map(|value| format!(" at {}:{}", value.file(), value.line()))
            .unwrap_or_default();
        let _ = append_event(
            &app,
            LogEvent {
                level: "error".to_owned(),
                operation: "rust.panic".to_owned(),
                message: format!("{payload}{location}"),
                request_id: None,
            },
        );
        previous(panic_info);
    }));
}

pub(crate) fn record_startup_event(app: &tauri::AppHandle, message: &str) {
    let _ = append_event(
        app,
        LogEvent {
            level: "info".to_owned(),
            operation: "app.startup".to_owned(),
            message: message.to_owned(),
            request_id: None,
        },
    );
}
pub(crate) fn record_startup_error(app: &tauri::AppHandle, error: &str) {
    let _ = append_event(
        app,
        LogEvent {
            level: "error".to_owned(),
            operation: "app.startup".to_owned(),
            message: error.to_owned(),
            request_id: None,
        },
    );
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEvent {
    pub(crate) level: String,
    pub(crate) operation: String,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
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

pub(crate) fn append_event(app: &AppHandle, event: LogEvent) -> Result<(), String> {
    let entry = LogEntry {
        timestamp: timestamp(),
        level: normalize_level(&event.level),
        operation: event.operation.trim().to_owned(),
        message: event.message.trim().to_owned(),
        request_id: event.request_id.map(|value| value.trim().to_owned()),
    };
    append_entry(&log_path(app)?, entry)
}

fn append_entry(path: &Path, entry: LogEntry) -> Result<(), String> {
    let _guard = LOG_FILE_LOCK.lock().map_err(|error| error.to_string())?;
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())? + "\n";
    let line_size = line.len() as u64;
    let directory = path.parent().ok_or("日志路径没有父目录")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;

    if path.exists() {
        let current_size = fs::metadata(path).map_err(|error| error.to_string())?.len();
        if current_size.saturating_add(line_size) > MAX_LOG_BYTES {
            rotate_logs(directory)?;
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())
}
fn log_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LOG_DIRECTORY).join(LOG_FILE))
        .map_err(|error| error.to_string())
}

fn rotate_logs(directory: &Path) -> Result<(), String> {
    for index in (1..MAX_LOG_FILES).rev() {
        let source = directory.join(format!("{LOG_FILE}.{index}"));
        let target = directory.join(format!("{LOG_FILE}.{}", index + 1));
        if source.exists() {
            fs::rename(source, target).map_err(|error| error.to_string())?;
        }
    }
    let current = directory.join(LOG_FILE);
    if current.exists() {
        fs::rename(current, directory.join(format!("{LOG_FILE}.1")))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}
fn normalize_level(level: &str) -> String {
    match level.to_ascii_uppercase().as_str() {
        "DEBUG" => "DEBUG".to_owned(),
        "WARN" | "WARNING" => "WARN".to_owned(),
        "ERROR" => "ERROR".to_owned(),
        _ => "INFO".to_owned(),
    }
}

#[cfg(test)]
mod tests {

    use std::fs;
    use std::path::PathBuf;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{append_entry, normalize_level, LogEntry, MAX_LOG_BYTES};
    #[test]
    fn normalizes_unknown_levels_to_info() {
        assert_eq!(normalize_level("trace"), "INFO");
        assert_eq!(normalize_level("warning"), "WARN");
    }

    #[test]
    fn concurrent_appends_after_rotation_preserve_complete_entries() {
        let directory = temporary_test_directory();
        fs::create_dir_all(&directory).expect("create test directory");
        let path = directory.join("app.log");
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize])
            .expect("fill log to rotation threshold");
        let mut workers = Vec::new();

        for index in 0..16 {
            let path = path.clone();
            workers.push(thread::spawn(move || {
                append_entry(
                    &path,
                    LogEntry {
                        timestamp: index.to_string(),
                        level: "INFO".to_owned(),
                        operation: "logger.test".to_owned(),
                        message: format!("entry-{index}"),
                        request_id: None,
                    },
                )
            }));
        }

        for worker in workers {
            worker
                .join()
                .expect("worker panicked")
                .expect("append failed");
        }

        let entries: Vec<LogEntry> = fs::read_to_string(&path)
            .expect("read current log")
            .lines()
            .map(|line| serde_json::from_str(line).expect("valid log entry"))
            .collect();
        assert_eq!(entries.len(), 16);
        assert!(directory.join("app.log.1").exists());
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    fn temporary_test_directory() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("stickyhomeworks2-logger-{unique}"))
    }
}
