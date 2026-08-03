use serde::Deserialize;

use crate::data::{normalize_app_data, normalize_settings, AppData, AppSettings, OTHER_SUBJECT};

#[derive(Debug)]
pub(crate) struct LegacyImport {
    pub(crate) data: AppData,
    pub(crate) legacy_rich_text_count: usize,
    pub(crate) removed_tag_reference_count: usize,
    pub(crate) replaced_subject_count: usize,
}

pub(crate) fn import_legacy_data_from_sources(
    current_data: AppData,
    profile_source: Option<&str>,
    settings_source: &str,
) -> Result<LegacyImport, String> {
    let (mut data, legacy_rich_text_count) = match profile_source {
        Some(source) => import_profile(source)?,
        None => (current_data, 0),
    };

    data.settings = read_legacy_settings_source(settings_source)?;
    normalize_settings(&mut data.settings);
    let (removed_tag_reference_count, replaced_subject_count) =
        reconcile_homework_vocabulary(&mut data);
    normalize_app_data(&mut data);

    Ok(LegacyImport {
        data,
        legacy_rich_text_count,
        removed_tag_reference_count,
        replaced_subject_count,
    })
}

fn import_profile(source: &str) -> Result<(AppData, usize), String> {
    let profile_value: serde_json::Value = parse_json(source, "旧 Profile.json")?;
    validate_legacy_profile(&profile_value)?;
    let data: AppData = serde_json::from_value(profile_value).map_err(|error| error.to_string())?;
    let rich_text_count = data
        .homeworks
        .iter()
        .filter(|homework| homework.content.contains("<FlowDocument"))
        .count();
    Ok((data, rich_text_count))
}

fn reconcile_homework_vocabulary(data: &mut AppData) -> (usize, usize) {
    let mut removed_tag_reference_count = 0;
    let mut replaced_subject_count = 0;

    for homework in &mut data.homeworks {
        let tag_count = homework.tags.len();
        homework.tags.retain(|tag| data.settings.tags.contains(tag));
        removed_tag_reference_count += tag_count - homework.tags.len();

        if !data.settings.subjects.contains(&homework.subject) {
            homework.subject = OTHER_SUBJECT.to_owned();
            replaced_subject_count += 1;
        }
    }

    if replaced_subject_count > 0
        && !data
            .settings
            .subjects
            .iter()
            .any(|subject| subject == OTHER_SUBJECT)
    {
        data.settings.subjects.push(OTHER_SUBJECT.to_owned());
    }

    (removed_tag_reference_count, replaced_subject_count)
}

fn read_legacy_settings_source(source: &str) -> Result<AppSettings, String> {
    let value: serde_json::Value = parse_json(source, "旧 Settings.json")?;
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
    if let Some(value) = object
        .get("Autooutwork")
        .and_then(serde_json::Value::as_bool)
    {
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
    if let Some(value) = object
        .get("ExpiredMarkColor")
        .and_then(serde_json::Value::as_str)
    {
        settings.expired_mark_color = value.to_owned();
    }
    if let Some(value) = object
        .get("MaxPanelWidth")
        .and_then(serde_json::Value::as_f64)
    {
        settings.max_panel_width = value;
    }

    Ok(settings)
}

fn parse_json<T: for<'de> Deserialize<'de>>(source: &str, file_name: &str) -> Result<T, String> {
    serde_json::from_str(source).map_err(|error| format!("{file_name} 不是有效的 JSON：{error}"))
}

fn validate_legacy_profile(value: &serde_json::Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or("旧 Profile.json 的根节点必须是对象")?;
    let homeworks = object
        .get("Homeworks")
        .or_else(|| object.get("homeworks"))
        .ok_or("旧 Profile.json 缺少 Homeworks 字段")?;

    if !homeworks.is_array() {
        return Err("旧 Profile.json 的 Homeworks 字段必须是数组".to_owned());
    }

    Ok(())
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

#[cfg(all(test, feature = "local-tests"))]
#[path = "local_tests/legacy_import.rs"]
mod local_tests;
