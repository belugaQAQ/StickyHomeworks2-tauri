use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::data::{normalize_app_data, AppData};

const APP_STATE_FILE: &str = "app-state.json";

pub(crate) fn read_app_data(path: &Path) -> Result<AppData, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut data = serde_json::from_str(&source).map_err(|error| error.to_string())?;
    normalize_app_data(&mut data);
    Ok(data)
}

pub(crate) fn write_app_data(path: &Path, data: &mut AppData) -> Result<(), String> {
    normalize_app_data(data);
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
