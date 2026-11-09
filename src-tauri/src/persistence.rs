use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::data::{normalize_app_data, AppData, AppSettings, HomeworkRecord, SCHEMA_VERSION};

pub(crate) const PROFILE_FILE: &str = "profile.json";
pub(crate) const APP_DATA_FILE: &str = "app-data.json";
pub(crate) const LEGACY_APP_STATE_FILE: &str = "app-state.json";

pub(crate) struct LoadOutcome {
    pub(crate) data: AppData,
    pub(crate) notices: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileFile {
    #[serde(default = "schema_version")]
    #[allow(dead_code)]
    schema_version: u8,
    #[serde(default, alias = "Homeworks")]
    homeworks: Vec<HomeworkRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateFile {
    #[serde(default = "schema_version")]
    #[allow(dead_code)]
    schema_version: u8,
    #[serde(default)]
    settings: AppSettings,
    #[serde(default, alias = "Homeworks")]
    homeworks: Vec<HomeworkRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileFileRef<'a> {
    schema_version: u8,
    homeworks: &'a [HomeworkRecord],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateFileRef<'a> {
    schema_version: u8,
    settings: &'a AppSettings,
}

pub(crate) fn read_app_data(directory: &Path) -> Result<LoadOutcome, String> {
    let mut notices = Vec::new();
    let state = read_state_file(directory, &mut notices);
    let profile = read_profile_file(directory, &mut notices);

    let mut data = AppData::default();
    let mut homeworks = Vec::new();
    let mut migrated_homeworks = false;

    if let Some((state, from_legacy_name)) = state {
        data.settings = state.settings;
        if from_legacy_name {
            notices.push(format!(
                "已把 {LEGACY_APP_STATE_FILE} 迁移为 {APP_DATA_FILE}，下次保存时删除旧文件"
            ));
        }
        if !state.homeworks.is_empty() {
            homeworks = state.homeworks;
            migrated_homeworks = true;
        }
    }
    if let Some(profile) = profile {
        homeworks = profile.homeworks;
        migrated_homeworks = false;
    }

    data.homeworks = homeworks;
    normalize_app_data(&mut data);

    if migrated_homeworks {
        notices.push(format!(
            "已从 {APP_DATA_FILE} 读取旧作业数据，将在下次保存时迁移到 {PROFILE_FILE}"
        ));
    }

    Ok(LoadOutcome { data, notices })
}

pub(crate) fn write_app_data(directory: &Path, data: &mut AppData) -> Result<(), String> {
    normalize_app_data(data);
    write_app_data_inner(directory, data, true)
}

pub(crate) fn write_app_data_preserving_profile(
    directory: &Path,
    data: &mut AppData,
    previous_homeworks: &[HomeworkRecord],
) -> Result<(), String> {
    normalize_app_data(data);
    let changed = data.homeworks != previous_homeworks;
    write_app_data_inner(directory, data, changed)
}

fn write_app_data_inner(directory: &Path, data: &AppData, write_profile: bool) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;

    let profile_path = directory.join(PROFILE_FILE);
    if write_profile || !profile_path.exists() {
        write_json_atomically(
            &profile_path,
            &ProfileFileRef {
                schema_version: SCHEMA_VERSION,
                homeworks: &data.homeworks,
            },
        )?;
    }
    write_json_atomically(
        &directory.join(APP_DATA_FILE),
        &StateFileRef {
            schema_version: SCHEMA_VERSION,
            settings: &data.settings,
        },
    )?;

    let legacy_path = directory.join(LEGACY_APP_STATE_FILE);
    if legacy_path.exists() {
        let _ = fs::remove_file(legacy_path);
    }
    Ok(())
}

fn read_state_file(directory: &Path, notices: &mut Vec<String>) -> Option<(StateFile, bool)> {
    let current = directory.join(APP_DATA_FILE);
    if current.exists() {
        return read_state_at(&current, notices).map(|state| (state, false));
    }

    let legacy = directory.join(LEGACY_APP_STATE_FILE);
    if legacy.exists() {
        return read_state_at(&legacy, notices).map(|state| (state, true));
    }
    None
}

fn read_state_at(path: &Path, notices: &mut Vec<String>) -> Option<StateFile> {
    match read_json::<StateFile>(path) {
        Ok(state) => Some(state),
        Err(error) => {
            notices.push(record_corrupted(path, &error, "设置数据"));
            None
        }
    }
}

fn read_profile_file(directory: &Path, notices: &mut Vec<String>) -> Option<ProfileFile> {
    let path = directory.join(PROFILE_FILE);
    if !path.exists() {
        return None;
    }
    match read_json::<ProfileFile>(&path) {
        Ok(profile) => Some(profile),
        Err(error) => {
            notices.push(record_corrupted(&path, &error, "作业数据"));
            None
        }
    }
}

fn record_corrupted(path: &Path, error: &str, label: &str) -> String {
    match backup_corrupted(path) {
        Ok(name) => format!("{label}损坏，已备份为 {name} 并回落到默认值：{error}"),
        Err(backup_error) => format!("{label}损坏但备份失败（{backup_error}），保持原文件不动：{error}"),
    }
}

fn backup_corrupted(path: &Path) -> Result<String, String> {
    let directory = path.parent().ok_or("应用数据路径没有父目录")?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let stem = path.file_stem().and_then(|stem| stem.to_str()).ok_or("应用数据文件名无效")?;
    let backup = directory.join(format!("{stem}.corrupt-{seconds}.json"));
    fs::rename(path, &backup).map_err(|error| error.to_string())?;
    Ok(backup
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| backup.to_string_lossy().into_owned()))
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&source).map_err(|error| error.to_string())
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let directory = path.parent().ok_or("应用数据路径没有父目录")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let file_name = path.file_name().and_then(|name| name.to_str()).ok_or("应用数据文件名无效")?;
    let temporary = directory.join(format!(
        ".{file_name}.{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error.to_string()
    })
}

fn schema_version() -> u8 {
    SCHEMA_VERSION
}

#[cfg(test)]
mod tests {
    use super::{
        read_app_data, write_app_data, write_app_data_preserving_profile, APP_DATA_FILE, LEGACY_APP_STATE_FILE,
        PROFILE_FILE,
    };
    use crate::data::{AppData, HomeworkContent, HomeworkRecord};
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!("stickyhomeworks2-persistence-{}", Uuid::new_v4()));
            fs::create_dir_all(&directory).expect("temp directory should be created");
            Self(directory)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn file(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_data() -> AppData {
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
        data
    }

    #[test]
    fn writes_homeworks_into_profile_and_settings_into_app_data() {
        let directory = TempDirectory::new();
        let mut data = sample_data();

        write_app_data(directory.path(), &mut data).expect("app data should be written");
        let outcome = read_app_data(directory.path()).expect("app data should be read back");

        assert_eq!(outcome.data, data);
        assert!(outcome.notices.is_empty(), "正常读写不应产生提示");

        let profile: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.file(PROFILE_FILE)).unwrap()).unwrap();
        assert_eq!(profile["homeworks"].as_array().map(Vec::len), Some(1));
        assert!(profile.get("settings").is_none(), "profile.json 不应包含设置");

        let state: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.file(APP_DATA_FILE)).unwrap()).unwrap();
        assert!(state.get("homeworks").is_none(), "app-data.json 不应再写入作业");
        assert_eq!(state["settings"]["title"], json!("测试标题"));
        assert!(!directory.file(LEGACY_APP_STATE_FILE).exists(), "不应再产生 app-state.json");
    }

    #[test]
    fn settings_only_saves_skip_rewriting_the_profile() {
        let directory = TempDirectory::new();
        let mut data = sample_data();
        write_app_data(directory.path(), &mut data).expect("app data should be written");

        let marker = r#"{ "homeworks": [] }"#;
        fs::write(directory.file(PROFILE_FILE), marker).unwrap();

        data.settings.title = "只改了设置".to_owned();
        let previous = data.homeworks.clone();
        write_app_data_preserving_profile(directory.path(), &mut data, &previous).expect("settings should save");

        assert_eq!(
            fs::read_to_string(directory.file(PROFILE_FILE)).unwrap(),
            marker,
            "作业没变时不应重写 profile.json"
        );
        let state: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.file(APP_DATA_FILE)).unwrap()).unwrap();
        assert_eq!(state["settings"]["title"], json!("只改了设置"));
    }

    #[test]
    fn homework_changes_rewrite_the_profile() {
        let directory = TempDirectory::new();
        let mut data = sample_data();
        write_app_data(directory.path(), &mut data).expect("app data should be written");
        fs::write(directory.file(PROFILE_FILE), r#"{ "homeworks": [] }"#).unwrap();

        let previous = data.homeworks.clone();
        data.homeworks.clear();
        write_app_data_preserving_profile(directory.path(), &mut data, &previous).expect("homeworks should save");

        let profile: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.file(PROFILE_FILE)).unwrap()).unwrap();
        assert_eq!(profile["homeworks"].as_array().map(Vec::len), Some(0));
    }

    #[test]
    fn missing_profile_is_rebuilt_even_without_homework_changes() {
        let directory = TempDirectory::new();
        let mut data = sample_data();
        write_app_data(directory.path(), &mut data).expect("app data should be written");
        fs::remove_file(directory.file(PROFILE_FILE)).unwrap();

        let previous = data.homeworks.clone();
        write_app_data_preserving_profile(directory.path(), &mut data, &previous).expect("settings should save");

        assert!(directory.file(PROFILE_FILE).exists(), "profile.json 丢失后应被重建");
        let outcome = read_app_data(directory.path()).expect("rebuilt profile should be readable");
        assert_eq!(outcome.data.homeworks.len(), 1);
    }

    #[test]
    fn leaves_no_temporary_files_behind() {
        let directory = TempDirectory::new();
        let mut data = sample_data();

        write_app_data(directory.path(), &mut data).expect("app data should be written");

        let temporary_files: Vec<_> = fs::read_dir(directory.path())
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(temporary_files.is_empty(), "原子写不应残留临时文件");
    }

    #[test]
    fn migrates_legacy_app_state_file_and_its_homeworks() {
        let directory = TempDirectory::new();
        let legacy = json!({
            "schemaVersion": 1,
            "homeworks": [{
                "id": Uuid::new_v4().to_string(),
                "content": "旧作业内容",
                "subject": "语文",
                "dueTime": "2026-02-02T00:00:00",
                "tags": [],
                "firstExpiredShowTime": null
            }],
            "settings": { "title": "旧标题" }
        });
        fs::write(directory.file(LEGACY_APP_STATE_FILE), serde_json::to_vec(&legacy).unwrap()).unwrap();

        let mut outcome = read_app_data(directory.path()).expect("legacy state should be readable");
        assert_eq!(outcome.data.homeworks.len(), 1);
        assert_eq!(outcome.data.settings.title, "旧标题");
        assert_eq!(outcome.data.homeworks[0].subject, "语文");
        assert!(
            outcome.notices.iter().any(|notice| notice.contains("迁移为 app-data.json")),
            "旧文件名应产生一条改名提示"
        );
        assert!(
            outcome.notices.iter().any(|notice| notice.contains("迁移到 profile.json")),
            "旧作业应产生一条迁移提示"
        );

        write_app_data(directory.path(), &mut outcome.data).expect("migration should persist");

        assert!(
            !directory.file(LEGACY_APP_STATE_FILE).exists(),
            "保存后旧文件名应被清掉"
        );
        let state: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.file(APP_DATA_FILE)).unwrap()).unwrap();
        assert!(state.get("homeworks").is_none(), "迁移后 app-data.json 不应再带作业");

        let relaunch = read_app_data(directory.path()).expect("migrated data should be readable");
        assert_eq!(relaunch.data.homeworks.len(), 1);
        assert!(relaunch.notices.is_empty(), "迁移完成后不应再提示");
    }

    #[test]
    fn legacy_app_state_file_without_homeworks_is_just_renamed() {
        let directory = TempDirectory::new();
        fs::write(
            directory.file(LEGACY_APP_STATE_FILE),
            r#"{ "settings": { "title": "只有设置" } }"#,
        )
        .unwrap();

        let mut outcome = read_app_data(directory.path()).expect("legacy state should be readable");
        assert_eq!(outcome.data.settings.title, "只有设置");
        assert!(outcome.data.homeworks.is_empty());

        write_app_data(directory.path(), &mut outcome.data).expect("rename should persist");

        assert!(!directory.file(LEGACY_APP_STATE_FILE).exists(), "旧文件名应被清掉");
        assert!(directory.file(APP_DATA_FILE).exists(), "应生成 app-data.json");
        assert!(directory.file(PROFILE_FILE).exists(), "应生成 profile.json");
    }

    #[test]
    fn profile_wins_over_leftovers_in_app_data() {
        let directory = TempDirectory::new();
        let state = json!({
            "homeworks": [{ "id": Uuid::new_v4().to_string(), "content": "残留", "subject": "化学" }],
            "settings": {}
        });
        fs::write(directory.file(APP_DATA_FILE), serde_json::to_vec(&state).unwrap()).unwrap();
        fs::write(directory.file(PROFILE_FILE), r#"{ "homeworks": [] }"#).unwrap();

        let outcome = read_app_data(directory.path()).expect("profile should be readable");

        assert!(
            outcome.data.homeworks.is_empty(),
            "profile.json 存在时应忽略 app-data.json 里的残留"
        );
    }

    #[test]
    fn corrupted_profile_is_backed_up_without_losing_settings() {
        let directory = TempDirectory::new();
        fs::write(directory.file(APP_DATA_FILE), r#"{ "settings": { "title": "保留我" } }"#).unwrap();
        fs::write(directory.file(PROFILE_FILE), b"{ not a valid profile").unwrap();

        let outcome = read_app_data(directory.path()).expect("corrupted profile should fall back");

        assert_eq!(outcome.data.settings.title, "保留我");
        assert!(outcome.data.homeworks.is_empty());
        assert!(outcome.notices.iter().any(|notice| notice.contains("作业数据损坏")));
        assert!(!directory.file(PROFILE_FILE).exists(), "损坏文件应被改名备份");
        let backups: Vec<_> = fs::read_dir(directory.path())
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("profile.corrupt-") && name.ends_with(".json"))
            .collect();
        assert_eq!(backups.len(), 1, "应生成一份 profile.corrupt-*.json 备份");
    }

    #[test]
    fn corrupted_app_data_keeps_homeworks_loadable() {
        let directory = TempDirectory::new();
        let mut data = sample_data();
        write_app_data(directory.path(), &mut data).expect("app data should be written");
        fs::write(directory.file(APP_DATA_FILE), b"{ not a valid state").unwrap();

        let outcome = read_app_data(directory.path()).expect("corrupted state should fall back");

        assert_eq!(outcome.data.homeworks, data.homeworks, "设置损坏不应连带丢作业");
        assert!(outcome.notices.iter().any(|notice| notice.contains("设置数据损坏")));
    }
}
