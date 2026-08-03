use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use serde::Serialize;

use crate::data::AppData;
use crate::legacy_import::import_legacy_data_from_sources;
use crate::persistence::{read_app_data, write_app_data};

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
pub(crate) fn import_legacy_data_contents(
    app: AppHandle,
    profile_contents: Option<String>,
    settings_contents: String,
) -> Result<LegacyImportResult, String> {
    let current_data = load_app_data(app.clone())?;
    let mut result = import_legacy_data_from_sources(
        current_data,
        profile_contents.as_deref(),
        &settings_contents,
    )?;
    write_app_data(&app_state_path(&app)?, &mut result.data)?;

    Ok(LegacyImportResult {
        data: result.data,
        legacy_rich_text_count: result.legacy_rich_text_count,
        removed_tag_reference_count: result.removed_tag_reference_count,
        replaced_subject_count: result.replaced_subject_count,
    })
}

fn app_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join(APP_STATE_FILE))
}
