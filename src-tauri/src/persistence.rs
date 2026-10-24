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

#[cfg(test)]
mod tests {
    use super::{read_app_data, write_app_data};
    use crate::data::{AppData, HomeworkContent, HomeworkRecord};
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn atomic_write_round_trips_and_leaves_no_temporary_file() {
        let directory = std::env::temp_dir().join(format!("stickyhomeworks2-persistence-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temp directory should be created");
        let path = directory.join("app-state.json");
        let mut data = AppData::default();
        data.settings.title = "测试标题".to_owned();
        data.homeworks.push(HomeworkRecord {
            id: Uuid::new_v4().to_string(),
            content: HomeworkContent::PlainText {
                text: "作业内容".to_owned(),
            },
            subject: "数学".to_owned(),
            due_time: "2026-01-01T00:00:00".to_owned(),
            tags: vec!["重点".to_owned()],
            first_expired_show_time: None,
        });

        write_app_data(&path, &mut data).expect("app data should be written");
        let read_back = read_app_data(&path).expect("app data should be read back");

        assert_eq!(read_back, data);
        let temporary_files: Vec<_> = fs::read_dir(&directory)
            .expect("temp directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(temporary_files.is_empty(), "原子写不应残留临时文件");
        fs::remove_dir_all(directory).expect("temp directory should be removed");
    }
}
