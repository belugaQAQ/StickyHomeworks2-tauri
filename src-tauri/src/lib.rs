use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const APP_STATE_FILE: &str = "app-state.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HomeworkRecord {
    #[serde(default)]
    id: String,
    #[serde(default, alias = "Content")]
    content: String,
    #[serde(default, alias = "Subject")]
    subject: String,
    #[serde(default = "today_string", alias = "DueTime")]
    due_time: String,
    #[serde(default, alias = "Tags")]
    tags: Vec<String>,
    #[serde(default, alias = "FirstExpiredShowTime")]
    first_expired_show_time: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default = "default_title", alias = "Title")]
    title: String,
    #[serde(default, alias = "Subjects")]
    subjects: Vec<String>,
    #[serde(default, alias = "Tags")]
    tags: Vec<String>,
    #[serde(default = "default_true", alias = "Autooutwork")]
    auto_outwork: bool,
    #[serde(default, alias = "DelayedCleanupEnabled")]
    delayed_cleanup_enabled: bool,
    #[serde(default, alias = "IsExpiredMarkEnabled")]
    is_expired_mark_enabled: bool,
    #[serde(default = "default_expired_mark_color", alias = "ExpiredMarkColor")]
    expired_mark_color: String,
    #[serde(default = "default_max_panel_width", alias = "MaxPanelWidth")]
    max_panel_width: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppData {
    #[serde(default = "schema_version")]
    schema_version: u8,
    #[serde(default, alias = "Homeworks")]
    homeworks: Vec<HomeworkRecord>,
    #[serde(default)]
    settings: AppSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            title: default_title(),
            subjects: Vec::new(),
            tags: Vec::new(),
            auto_outwork: true,
            delayed_cleanup_enabled: false,
            is_expired_mark_enabled: false,
            expired_mark_color: default_expired_mark_color(),
            max_panel_width: default_max_panel_width(),
        }
    }
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            schema_version: schema_version(),
            homeworks: Vec::new(),
            settings: AppSettings::default(),
        }
    }
}

fn schema_version() -> u8 {
    1
}

fn default_title() -> String {
    "作业".to_owned()
}

fn default_true() -> bool {
    true
}

fn default_expired_mark_color() -> String {
    "#333333".to_owned()
}

fn default_max_panel_width() -> f64 {
    350.0
}

fn today_string() -> String {
    "1970-01-01T00:00:00".to_owned()
}

fn app_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(data_dir.join(APP_STATE_FILE))
}

fn normalize_data(data: &mut AppData) {
    data.schema_version = schema_version();
    for (index, homework) in data.homeworks.iter_mut().enumerate() {
        if homework.id.trim().is_empty() {
            homework.id = format!("legacy-{index}");
        }
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&source).map_err(|error| error.to_string())
}

fn read_legacy_settings(path: &Path) -> Result<AppSettings, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&source).map_err(|error| error.to_string())?;
    let object = value
        .as_object()
        .ok_or("旧 Settings.json 的根节点必须是对象")?;
    let mut settings = AppSettings::default();

    if let Some(value) = object.get("Title").and_then(serde_json::Value::as_str) {
        settings.title = value.to_owned();
    }
    if let Some(value) = object.get("Subjects").and_then(string_array) {
        settings.subjects = value;
    }
    if let Some(value) = object.get("Tags").and_then(string_array) {
        settings.tags = value;
    }
    if let Some(value) = object.get("Autooutwork").and_then(serde_json::Value::as_bool) {
        settings.auto_outwork = value;
    }
    if let Some(value) = object
        .get("DelayedCleanupEnabled")
        .and_then(serde_json::Value::as_bool)
    {
        settings.delayed_cleanup_enabled = value;
    }
    if let Some(value) = object
        .get("IsExpiredMarkEnabled")
        .and_then(serde_json::Value::as_bool)
    {
        settings.is_expired_mark_enabled = value;
    }
    if let Some(value) = object.get("ExpiredMarkColor").and_then(serde_json::Value::as_str) {
        settings.expired_mark_color = value.to_owned();
    }
    if let Some(value) = object.get("MaxPanelWidth").and_then(serde_json::Value::as_f64) {
        settings.max_panel_width = value;
    }

    Ok(settings)
}

fn string_array(value: &serde_json::Value) -> Option<Vec<String>> {
    value.as_array().map(|items| {
        items
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_owned)
            .collect()
    })
}

fn write_json_atomically(path: &Path, data: &AppData) -> Result<(), String> {
    let directory = path.parent().ok_or("应用数据路径没有父目录")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!(
        ".{APP_STATE_FILE}.{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    let contents = serde_json::to_vec_pretty(data).map_err(|error| error.to_string())?;
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error.to_string()
    })
}

#[tauri::command]
fn load_app_data(app: AppHandle) -> Result<AppData, String> {
    let path = app_state_path(&app)?;
    if !path.exists() {
        return Ok(AppData::default());
    }

    let mut data: AppData = read_json(&path)?;
    normalize_data(&mut data);
    Ok(data)
}

#[tauri::command]
fn save_app_data(app: AppHandle, mut data: AppData) -> Result<(), String> {
    normalize_data(&mut data);
    write_json_atomically(&app_state_path(&app)?, &data)
}

#[tauri::command]
fn import_legacy_data(
    app: AppHandle,
    profile_path: String,
    settings_path: Option<String>,
) -> Result<AppData, String> {
    let mut data: AppData = read_json(Path::new(&profile_path))?;
    if let Some(settings_path) = settings_path.filter(|path| !path.trim().is_empty()) {
        data.settings = read_legacy_settings(Path::new(&settings_path))?;
    }
    normalize_data(&mut data);
    write_json_atomically(&app_state_path(&app)?, &data)?;
    Ok(data)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn runtime_layout() -> &'static str {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        "mobile"
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        "desktop"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            runtime_layout,
            load_app_data,
            save_app_data,
            import_legacy_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
