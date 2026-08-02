use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::data::{read_app_data, read_legacy_data, write_app_data, AppData};

const APP_STATE_FILE: &str = "app-state.json";

#[tauri::command]
pub(crate) fn load_app_data(app: AppHandle) -> Result<AppData, String> {
    let path = app_state_path(&app)?;
    if !path.exists() {
        return Ok(AppData::default());
    }

    read_app_data(&path)
}

#[tauri::command]
pub(crate) fn save_app_data(app: AppHandle, mut data: AppData) -> Result<(), String> {
    write_app_data(&app_state_path(&app)?, &mut data)
}

#[tauri::command]
pub(crate) fn import_legacy_data(
    app: AppHandle,
    profile_path: String,
    settings_path: Option<String>,
) -> Result<AppData, String> {
    let settings_path = settings_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from);
    let mut data = read_legacy_data(Path::new(&profile_path), settings_path.as_deref())?;
    write_app_data(&app_state_path(&app)?, &mut data)?;
    Ok(data)
}

fn app_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join(APP_STATE_FILE))
}
