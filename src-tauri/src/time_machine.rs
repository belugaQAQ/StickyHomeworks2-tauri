//! 时间机器：作业与科目/标签词库的历史备份。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, FixedOffset, Offset, TimeZone};
use serde::{Deserialize, Serialize};

use crate::data::{AppData, HomeworkRecord};
use crate::persistence::write_json_atomically;

pub(crate) const TIME_MACHINE_DIRECTORY: &str = "time-machine";

const SNAPSHOT_SCHEMA_VERSION: u8 = 1;
const SNAPSHOT_EXTENSION: &str = "json";
/// 最近三天全部保留。
const RECENT_RETENTION_MS: i64 = 3 * 24 * 60 * 60 * 1000;
/// 一个月内的日子，每天只保留最新的这么多条。
const MONTHLY_DAILY_KEEP: usize = 5;
const MONTHLY_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
/// 一年内更早的日子，每天只留一条。
const YEARLY_DAILY_KEEP: usize = 1;
/// 超过一年全部删除。
const MAX_RETENTION_MS: i64 = 365 * 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SnapshotSource {
    HomeworkCreate,
    HomeworkUpdate,
    HomeworkDelete,
    HomeworkCleanup,
    ExpiryMark,
    CleanupUndo,
    UafImport,
    LegacyImport,
    VocabularyUpdate,
    SnapshotRestore,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotPayload {
    pub(crate) homeworks: Vec<HomeworkRecord>,
    pub(crate) subjects: Vec<String>,
    pub(crate) tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotFile {
    pub(crate) schema_version: u8,
    pub(crate) source: SnapshotSource,
    pub(crate) created_at: i64,
    #[serde(flatten)]
    pub(crate) payload: SnapshotPayload,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotSummary {
    pub(crate) id: String,
    pub(crate) created_at: i64,
    pub(crate) source: SnapshotSource,
    pub(crate) homework_count: usize,
    pub(crate) subject_count: usize,
    pub(crate) tag_count: usize,
    #[serde(default)]
    pub(crate) subjects: Vec<String>,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) search_text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotDetail {
    pub(crate) summary: SnapshotSummary,
    pub(crate) homeworks: Vec<HomeworkRecord>,
    pub(crate) subjects: Vec<String>,
    pub(crate) tags: Vec<String>,
}

pub(crate) fn payload_of(data: &AppData) -> SnapshotPayload {
    SnapshotPayload {
        homeworks: data.homeworks.clone(),
        subjects: data.settings.subjects.clone(),
        tags: data.settings.tags.clone(),
    }
}

/// 作业或词库变了才算变化。与 `payload_of` 等价，但不构造快照负载，
/// 免得为了比较把全部作业（含 base64 图片）克隆一遍。
pub(crate) fn payload_changed(left: &AppData, right: &AppData) -> bool {
    left.homeworks != right.homeworks
        || left.settings.subjects != right.settings.subjects
        || left.settings.tags != right.settings.tags
}

fn payload_matches(data: &AppData, payload: &SnapshotPayload) -> bool {
    payload.homeworks == data.homeworks
        && payload.subjects == data.settings.subjects
        && payload.tags == data.settings.tags
}

pub(crate) fn apply_snapshot(mut current: AppData, detail: SnapshotDetail) -> AppData {
    current.homeworks = detail.homeworks;
    current.settings.subjects = detail.subjects;
    current.settings.tags = detail.tags;
    current
}

pub(crate) fn record_snapshot(
    directory: &Path,
    data: &AppData,
    source: SnapshotSource,
    now_ms: i64,
) -> Result<Option<String>, String> {
    let entries = snapshot_entries(directory)?;

    if let Some((_, latest)) = latest_readable_snapshot(&entries) {
        if payload_matches(data, &latest.payload) {
            return Ok(None);
        }
    }

    let id = next_snapshot_id(&entries, now_ms);
    let file = SnapshotFile {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        source,
        created_at: now_ms,
        payload: payload_of(data),
    };
    write_json_atomically(&snapshot_path(directory, id), &file)?;
    Ok(Some(id.to_string()))
}

pub(crate) fn list_snapshots(directory: &Path) -> Result<(Vec<SnapshotSummary>, Vec<String>), String> {
    let entries = snapshot_entries(directory)?;
    let mut notices = Vec::new();
    let mut readable = Vec::new();
    for (id, path) in &entries {
        match read_snapshot_file(path) {
            Ok(file) => readable.push((*id, file)),
            Err(error) => notices.push(format!("快照 {} 无法读取：{error}", file_name_of(path))),
        }
    }

    readable.sort_by(|left, right| right.1.created_at.cmp(&left.1.created_at).then(right.0.cmp(&left.0)));
    let summaries = readable.iter().map(|(id, file)| summary_of(*id, file)).collect();
    Ok((summaries, notices))
}

pub(crate) fn read_snapshot(directory: &Path, id: &str) -> Result<SnapshotDetail, String> {
    let parsed_id = snapshot_id_from_name(&format!("{id}.{SNAPSHOT_EXTENSION}")).ok_or("快照不存在")?;
    let path = snapshot_path(directory, parsed_id);
    if !path.is_file() {
        return Err("快照不存在".to_owned());
    }
    let file = read_snapshot_file(&path).map_err(|error| format!("快照已损坏：{error}"))?;
    let summary = summary_of(parsed_id, &file);
    Ok(SnapshotDetail {
        summary,
        homeworks: file.payload.homeworks,
        subjects: file.payload.subjects,
        tags: file.payload.tags,
    })
}

pub(crate) fn prune_snapshots(directory: &Path, now_ms: i64) -> Result<usize, String> {
    let entries = snapshot_entries(directory)?;
    let readable: Vec<(i64, i64)> = entries
        .iter()
        .filter(|(id, _)| now_ms.saturating_sub(*id) + 1000 >= RECENT_RETENTION_MS)
        .filter_map(|(id, path)| read_snapshot_file(path).ok().map(|file| (*id, file.created_at)))
        .collect();

    let offset = chrono::Local::now().offset().fix();
    let expired = select_expired(&readable, now_ms, offset);
    let mut removed = 0;
    let mut first_error: Option<String> = None;
    for id in expired {
        match fs::remove_file(snapshot_path(directory, id)) {
            Ok(()) => removed += 1,
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error.to_string());
                }
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(removed),
    }
}

fn select_expired(entries: &[(i64, i64)], now_ms: i64, offset: FixedOffset) -> Vec<i64> {
    let mut expired = Vec::new();
    let mut monthly: HashMap<(i32, u32, u32), Vec<(i64, i64)>> = HashMap::new();
    let mut yearly: HashMap<(i32, u32, u32), Vec<(i64, i64)>> = HashMap::new();

    for (id, created_at) in entries {
        if *created_at > now_ms {
            continue;
        }
        let age = now_ms.saturating_sub(*created_at);
        if age < RECENT_RETENTION_MS {
            continue;
        }
        let Some(day) = local_day(*created_at, offset) else {
            continue;
        };
        let slot = if age > MAX_RETENTION_MS {
            expired.push(*id);
            continue;
        } else if age <= MONTHLY_RETENTION_MS {
            monthly.entry(day).or_default()
        } else {
            yearly.entry(day).or_default()
        };
        slot.push((*created_at, *id));
    }

    for (buckets, keep) in [(monthly, MONTHLY_DAILY_KEEP), (yearly, YEARLY_DAILY_KEEP)] {
        for (_, mut items) in buckets {
            // 新的排前面，超出保留数的从尾巴删。
            items.sort_by(|left, right| right.cmp(left));
            for (index, (_, id)) in items.into_iter().enumerate() {
                if index >= keep {
                    expired.push(id);
                }
            }
        }
    }

    expired
}

fn local_day(timestamp_ms: i64, offset: FixedOffset) -> Option<(i32, u32, u32)> {
    let moment = offset.timestamp_millis_opt(timestamp_ms).single()?;
    let date = moment.date_naive();
    Some((date.year(), date.month(), date.day()))
}

fn summary_of(id: i64, file: &SnapshotFile) -> SnapshotSummary {
    SnapshotSummary {
        id: id.to_string(),
        created_at: file.created_at,
        source: file.source,
        homework_count: file.payload.homeworks.len(),
        subject_count: file.payload.subjects.len(),
        tag_count: file.payload.tags.len(),
        subjects: collect_snapshot_subjects(&file.payload),
        tags: collect_snapshot_tags(&file.payload),
        search_text: extract_payload_search_text(&file.payload),
    }
}

fn collect_snapshot_subjects(payload: &SnapshotPayload) -> Vec<String> {
    let mut items = Vec::new();
    for homework in &payload.homeworks {
        push_unique_trimmed(&mut items, &homework.subject);
    }
    items
}

fn collect_snapshot_tags(payload: &SnapshotPayload) -> Vec<String> {
    let mut items = Vec::new();
    for homework in &payload.homeworks {
        for tag in &homework.tags {
            push_unique_trimmed(&mut items, tag);
        }
    }
    items
}

fn push_unique_trimmed(items: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if !trimmed.is_empty() && !items.iter().any(|existing| existing == trimmed) {
        items.push(trimmed.to_owned());
    }
}

fn extract_payload_search_text(payload: &SnapshotPayload) -> String {
    let mut parts: Vec<String> = Vec::new();
    for homework in &payload.homeworks {
        for tag in &homework.tags {
            push_trimmed(&mut parts, tag);
        }
        match &homework.content {
            crate::data::HomeworkContent::PlainText { text } => push_trimmed(&mut parts, text),
            crate::data::HomeworkContent::TiptapJson { document } => collect_tiptap_text(document, &mut parts),
            crate::data::HomeworkContent::LegacyFlowDocumentXaml { xaml } => {
                let stripped = strip_xml_tags(xaml);
                push_trimmed(&mut parts, &stripped);
            }
        }
    }
    parts.join(" ")
}

fn push_trimmed(parts: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        parts.push(trimmed.to_owned());
    }
}

fn collect_tiptap_text(value: &serde_json::Value, parts: &mut Vec<String>) {
    let Some(object) = value.as_object() else {
        return;
    };
    if object.get("type").and_then(serde_json::Value::as_str) == Some("image") {
        return;
    }
    if let Some(text) = object.get("text").and_then(serde_json::Value::as_str) {
        push_trimmed(parts, text);
    }
    if let Some(content) = object.get("content").and_then(serde_json::Value::as_array) {
        for child in content {
            collect_tiptap_text(child, parts);
        }
    }
}

fn strip_xml_tags(xaml: &str) -> String {
    let mut result = String::with_capacity(xaml.len());
    let mut in_tag = false;
    for ch in xaml.chars() {
        match ch {
            '<' => {
                in_tag = true;
                if !result.ends_with(' ') {
                    result.push(' ');
                }
            }
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
}

fn snapshot_path(directory: &Path, id: i64) -> PathBuf {
    directory.join(format!("{id}.{SNAPSHOT_EXTENSION}"))
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn snapshot_id_from_name(name: &str) -> Option<i64> {
    let digits = name.strip_suffix(&format!(".{SNAPSHOT_EXTENSION}"))?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let id = digits.parse::<i64>().ok()?;
    if id.to_string() != digits {
        return None;
    }
    Some(id)
}

fn snapshot_entries(directory: &Path) -> Result<Vec<(i64, PathBuf)>, String> {
    let mut entries = Vec::new();
    let read_dir = match fs::read_dir(directory) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(error) => return Err(error.to_string()),
    };
    for entry in read_dir.filter_map(Result::ok) {
        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
            continue;
        }
        let Some(id) = entry.file_name().to_str().and_then(snapshot_id_from_name) else {
            continue;
        };
        entries.push((id, entry.path()));
    }
    entries.sort_by_key(|(id, _)| *id);
    Ok(entries)
}

fn read_snapshot_file(path: &Path) -> Result<SnapshotFile, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file: SnapshotFile = serde_json::from_str(&source).map_err(|error| error.to_string())?;
    if file.schema_version != SNAPSHOT_SCHEMA_VERSION {
        return Err(format!("未知的快照版本 {}", file.schema_version));
    }
    Ok(file)
}

fn latest_readable_snapshot(entries: &[(i64, PathBuf)]) -> Option<(i64, SnapshotFile)> {
    entries
        .iter()
        .rev()
        .find_map(|(id, path)| read_snapshot_file(path).ok().map(|file| (*id, file)))
}

fn next_snapshot_id(entries: &[(i64, PathBuf)], now_ms: i64) -> i64 {
    let candidate = now_ms.max(0);
    match entries.iter().map(|(id, _)| *id).max() {
        Some(newest) if newest >= candidate => newest.saturating_add(1),
        _ => candidate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::{AppData, HomeworkContent, HomeworkRecord};
    use serde_json::json;
    use uuid::Uuid;

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            // 部分环境会拒绝写 %TEMP%（os error 5），临时目录落在构建目录内。
            let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("test-tmp")
                .join(format!("time-machine-{}", Uuid::new_v4()));
            fs::create_dir_all(&directory)
                .unwrap_or_else(|error| panic!("temp directory {} should be created: {error}", directory.display()));
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

    fn homework(subject: &str, text: &str) -> HomeworkRecord {
        HomeworkRecord {
            id: Uuid::new_v4().to_string(),
            content: HomeworkContent::PlainText { text: text.to_owned() },
            subject: subject.to_owned(),
            due_time: "2026-01-01T00:00:00".to_owned(),
            tags: Vec::new(),
            first_expired_show_time: None,
        }
    }

    fn data_with(subjects: &[&str], tags: &[&str], homeworks: Vec<HomeworkRecord>) -> AppData {
        let mut data = AppData::default();
        data.homeworks = homeworks;
        data.settings.subjects = subjects.iter().map(|value| (*value).to_owned()).collect();
        data.settings.tags = tags.iter().map(|value| (*value).to_owned()).collect();
        data
    }

    fn read_file(directory: &Path, id: &str) -> SnapshotFile {
        serde_json::from_str(&fs::read_to_string(directory.join(format!("{id}.json"))).unwrap()).unwrap()
    }

    fn ids(directory: &Path) -> Vec<String> {
        list_snapshots(directory)
            .expect("snapshots should list")
            .0
            .into_iter()
            .map(|item| item.id)
            .collect()
    }

    #[test]
    fn records_the_given_state() {
        let directory = TempDirectory::new();
        let data = data_with(&["数学"], &["重点"], vec![homework("数学", "作业")]);

        let created = record_snapshot(directory.path(), &data, SnapshotSource::HomeworkCreate, 1_000)
            .expect("snapshot should be recorded");
        assert_eq!(created.as_deref(), Some("1000"));
        assert_eq!(
            read_file(directory.path(), "1000").source,
            SnapshotSource::HomeworkCreate
        );
        assert_eq!(read_file(directory.path(), "1000").created_at, 1_000);
    }

    #[test]
    fn skips_when_nothing_changed_since_the_latest_snapshot() {
        let directory = TempDirectory::new();
        let data = data_with(&["数学"], &[], vec![homework("数学", "作业")]);
        record_snapshot(directory.path(), &data, SnapshotSource::HomeworkCreate, 1_000).unwrap();

        let repeated = record_snapshot(directory.path(), &data, SnapshotSource::HomeworkUpdate, 2_000)
            .expect("identical payload should be skipped");
        assert!(repeated.is_none());
        assert_eq!(ids(directory.path()), vec!["1000".to_owned()]);
    }

    #[test]
    fn payload_changed_ignores_non_backup_settings() {
        let base = data_with(&["数学"], &["重点"], vec![homework("数学", "A")]);

        let mut same = base.clone();
        same.settings.title = "改标题".to_owned();
        same.settings.homework_scale = 130.0;
        assert!(!payload_changed(&base, &same), "标题/缩放不进快照，不算变化");

        let mut other_homework = base.clone();
        other_homework.homeworks = vec![homework("数学", "B")];
        assert!(payload_changed(&base, &other_homework));

        let mut other_subjects = base.clone();
        other_subjects.settings.subjects = vec!["语文".to_owned()];
        assert!(payload_changed(&base, &other_subjects));

        let mut other_tags = base.clone();
        other_tags.settings.tags = vec!["背诵".to_owned()];
        assert!(payload_changed(&base, &other_tags));
    }

    #[test]
    fn dedupe_looks_at_the_newest_snapshot_only() {
        let directory = TempDirectory::new();
        let oldest = data_with(&["数学"], &[], vec![homework("数学", "旧")]);
        let newest = data_with(&["数学"], &[], vec![homework("数学", "新")]);

        record_snapshot(directory.path(), &oldest, SnapshotSource::HomeworkUpdate, 1_000).unwrap();
        record_snapshot(directory.path(), &newest, SnapshotSource::HomeworkUpdate, 2_000).unwrap();

        assert_eq!(
            record_snapshot(directory.path(), &oldest, SnapshotSource::HomeworkUpdate, 3_000)
                .unwrap()
                .as_deref(),
            Some("3000")
        );
    }

    #[test]
    fn corrupt_newest_file_does_not_block_recording() {
        let directory = TempDirectory::new();
        let data = data_with(&["数学"], &[], vec![homework("数学", "A")]);
        record_snapshot(directory.path(), &data, SnapshotSource::HomeworkCreate, 1_000).unwrap();
        fs::write(directory.file("1000.json"), b"{ broken").unwrap();

        // 最新一份读不出来时不能静默丢记录。
        let changed = data_with(&["数学"], &[], vec![homework("数学", "B")]);
        assert_eq!(
            record_snapshot(directory.path(), &changed, SnapshotSource::HomeworkUpdate, 2_000)
                .unwrap()
                .as_deref(),
            Some("2000")
        );
    }

    #[test]
    fn every_change_keeps_its_own_snapshot() {
        let directory = TempDirectory::new();
        let first = data_with(&["数学"], &[], vec![homework("数学", "A")]);
        let second = data_with(&["数学"], &[], vec![homework("数学", "B")]);
        let third = data_with(&["数学"], &[], vec![homework("数学", "C")]);

        record_snapshot(directory.path(), &first, SnapshotSource::HomeworkUpdate, 1_000).unwrap();
        record_snapshot(directory.path(), &second, SnapshotSource::HomeworkUpdate, 2_000).unwrap();
        record_snapshot(directory.path(), &third, SnapshotSource::HomeworkUpdate, 3_000).unwrap();

        assert_eq!(ids(directory.path()).len(), 3, "连续改动不合并，每次变动后各留一份");
    }

    #[test]
    fn assigns_distinct_ids_within_the_same_millisecond() {
        let directory = TempDirectory::new();
        let first = data_with(&["数学"], &[], vec![homework("数学", "A")]);
        let second = data_with(&["数学"], &[], vec![homework("数学", "B")]);

        record_snapshot(directory.path(), &first, SnapshotSource::HomeworkDelete, 5_000).unwrap();
        let next =
            record_snapshot(directory.path(), &second, SnapshotSource::HomeworkDelete, 5_000).expect("同毫秒应顺延");
        assert_eq!(next.as_deref(), Some("5001"));
        assert_eq!(ids(directory.path()), vec!["5001".to_owned(), "5000".to_owned()]);
    }

    #[test]
    fn ignores_non_canonical_names_and_broken_files() {
        let directory = TempDirectory::new();
        let data = data_with(&["数学"], &[], vec![homework("数学", "A")]);
        record_snapshot(directory.path(), &data, SnapshotSource::HomeworkCreate, 1_000).unwrap();

        fs::write(directory.file("01.json"), b"{}").unwrap();
        fs::write(directory.file("1000.tmp.json"), b"{}").unwrap();
        fs::write(directory.file("abc.json"), b"{}").unwrap();
        fs::create_dir(directory.file("2000.json")).unwrap();

        let (listed, notices) = list_snapshots(directory.path()).expect("listing should succeed");
        assert_eq!(listed.len(), 1);
        assert!(notices.is_empty(), "非快照文件名不应产生提示");

        fs::write(directory.file("3000.json"), b"{ not json").unwrap();
        let (_, notices) = list_snapshots(directory.path()).unwrap();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains("3000.json"));

        let changed = data_with(&["数学"], &[], vec![homework("数学", "B")]);
        let created =
            record_snapshot(directory.path(), &changed, SnapshotSource::HomeworkUpdate, 4_000).expect("仍应新建");
        assert_eq!(created.as_deref(), Some("4000"));
        assert_eq!(fs::read_to_string(directory.file("3000.json")).unwrap(), "{ not json");
    }

    #[test]
    fn rejects_unknown_schema_versions_without_deleting_them() {
        let directory = TempDirectory::new();
        fs::write(
            directory.file("1000.json"),
            serde_json::to_vec(&json!({
                "schemaVersion": 2,
                "source": "homework-update",
                "createdAt": 1000,
                "homeworks": [],
                "subjects": [],
                "tags": []
            }))
            .unwrap(),
        )
        .unwrap();

        let (listed, notices) = list_snapshots(directory.path()).unwrap();
        assert!(listed.is_empty());
        assert!(notices[0].contains("未知的快照版本 2"));
        assert!(read_snapshot(directory.path(), "1000").is_err());
        assert!(directory.file("1000.json").exists(), "未知版本不应被自动删除");
    }

    #[test]
    fn reads_detail_and_reports_missing_or_corrupted() {
        let directory = TempDirectory::new();
        let data = data_with(&["语文"], &["背诵"], vec![homework("语文", "默写")]);
        record_snapshot(directory.path(), &data, SnapshotSource::HomeworkUpdate, 1_000).unwrap();

        let detail = read_snapshot(directory.path(), "1000").expect("detail should load");
        assert_eq!(detail.summary.homework_count, 1);
        assert_eq!(detail.summary.source, SnapshotSource::HomeworkUpdate);
        assert_eq!(detail.subjects, vec!["语文".to_owned()]);
        assert_eq!(detail.tags, vec!["背诵".to_owned()]);
        assert_eq!(detail.homeworks, data.homeworks);

        assert_eq!(read_snapshot(directory.path(), "9999").unwrap_err(), "快照不存在");
        assert_eq!(read_snapshot(directory.path(), "../1000").unwrap_err(), "快照不存在");

        fs::write(directory.file("2000.json"), b"{ broken").unwrap();
        assert!(read_snapshot(directory.path(), "2000")
            .unwrap_err()
            .starts_with("快照已损坏："));
    }

    #[test]
    fn retention_keeps_three_days_whole_five_a_day_for_a_month_and_one_beyond() {
        let offset = FixedOffset::east_opt(8 * 3600).unwrap();
        let hour = 60 * 60 * 1000;
        let day = 24 * hour;
        let now = 400 * day;
        let at = |days: i64, hours: i64| now - days * day + hours * hour;

        let entries = vec![
            (10, at(0, 0)),
            (11, at(2, 0)),
            (20, at(4, 0)),
            (21, at(4, 1)),
            (22, at(4, 2)),
            (23, at(4, 3)),
            (24, at(4, 4)),
            (25, at(4, 5)),
            (30, at(40, 0)),
            (31, at(40, 1)),
            (32, at(40, 2)),
            (40, at(400, 0)),
        ];

        let mut expired = select_expired(&entries, now, offset);
        expired.sort_unstable();
        assert_eq!(expired, vec![20, 30, 31, 40]);
    }

    #[test]
    fn prune_skips_recent_files_without_reading_them() {
        let directory = TempDirectory::new();
        let hour = 60 * 60 * 1000;
        let now = 200 * 24 * hour;
        let data = data_with(&["数学"], &[], vec![homework("数学", "A")]);

        let recent = now - hour;
        record_snapshot(directory.path(), &data, SnapshotSource::HomeworkCreate, recent).unwrap();
        fs::write(directory.file(&format!("{recent}.json")), b"{ broken").unwrap();

        assert_eq!(prune_snapshots(directory.path(), now).expect("prune should succeed"), 0);
        assert!(directory.file(&format!("{recent}.json")).exists(), "近期快照必须保留");
    }

    #[test]
    fn prune_removes_expired_files_and_keeps_unreadable_ones() {
        let directory = TempDirectory::new();
        let data = data_with(&["数学"], &[], vec![homework("数学", "A")]);
        let hour = 60 * 60 * 1000;
        let now = 400 * 24 * hour;
        record_snapshot(
            directory.path(),
            &data,
            SnapshotSource::HomeworkCreate,
            now - 400 * 24 * hour,
        )
        .unwrap();
        fs::write(directory.file("5.json"), b"{ broken").unwrap();

        assert_eq!(prune_snapshots(directory.path(), now).expect("prune should succeed"), 1);
        let (listed, notices) = list_snapshots(directory.path()).unwrap();
        assert!(listed.is_empty(), "超过一年的快照应被删除");
        assert_eq!(notices.len(), 1, "损坏文件留在原位并继续提示");
    }

    #[test]
    fn restore_records_both_sides_so_the_restore_itself_can_be_undone() {
        let directory = TempDirectory::new();
        // 记忆里的旧状态，也是这次恢复的目标。
        let target = data_with(&["历史科目"], &["历史标签"], vec![homework("历史科目", "旧作业")]);
        record_snapshot(directory.path(), &target, SnapshotSource::HomeworkUpdate, 1_000).unwrap();
        let target_detail = read_snapshot(directory.path(), "1000").unwrap();

        // 恢复前的当前数据。
        let current = data_with(&["当前科目"], &["当前标签"], vec![homework("当前科目", "新作业")]);

        record_snapshot(directory.path(), &current, SnapshotSource::SnapshotRestore, 2_000).unwrap();
        let next = apply_snapshot(current.clone(), target_detail);
        record_snapshot(directory.path(), &next, SnapshotSource::SnapshotRestore, 2_001).unwrap();


        assert_eq!(
            ids(directory.path()),
            vec!["2001".to_owned(), "2000".to_owned(), "1000".to_owned()]
        );
        assert_eq!(read_snapshot(directory.path(), "2001").unwrap().homeworks, target.homeworks);
        assert_eq!(read_snapshot(directory.path(), "2000").unwrap().homeworks, current.homeworks);
    }

    #[test]
    fn restore_keeps_the_state_it_replaced_readable() {
        let directory = TempDirectory::new();
        let target = data_with(&["历史科目"], &["历史标签"], vec![homework("历史科目", "旧作业")]);
        record_snapshot(directory.path(), &target, SnapshotSource::HomeworkUpdate, 1_000).unwrap();
        let target_detail = read_snapshot(directory.path(), "1000").unwrap();

        let current = data_with(&["当前科目"], &["当前标签"], vec![homework("当前科目", "新作业")]);
        record_snapshot(directory.path(), &current, SnapshotSource::HomeworkUpdate, 1_500).unwrap();

        record_snapshot(directory.path(), &current, SnapshotSource::SnapshotRestore, 2_000).unwrap();
        let next = apply_snapshot(current.clone(), target_detail);
        record_snapshot(directory.path(), &next, SnapshotSource::SnapshotRestore, 2_001).unwrap();

        assert_eq!(
            ids(directory.path()),
            vec!["2001".to_owned(), "1500".to_owned(), "1000".to_owned()]
        );
        assert_eq!(read_snapshot(directory.path(), "2001").unwrap().homeworks, target.homeworks);
        assert_eq!(read_snapshot(directory.path(), "1500").unwrap().homeworks, current.homeworks);
    }

    #[test]
    fn restore_to_the_same_state_leaves_the_list_alone() {
        let directory = TempDirectory::new();
        let data = data_with(&["数学"], &[], vec![homework("数学", "一样")]);
        let detail = read_snapshot_after_recording(&directory, &data);

        // 恢复到的状态和当前完全一样：安全网与锚点都与最新一份重复，一条都不新增。
        record_snapshot(directory.path(), &data, SnapshotSource::SnapshotRestore, 2_000).unwrap();
        let next = apply_snapshot(data.clone(), detail);
        record_snapshot(directory.path(), &next, SnapshotSource::SnapshotRestore, 2_001).unwrap();

        assert_eq!(ids(directory.path()), vec!["1000".to_owned()]);
    }

    fn read_snapshot_after_recording(directory: &TempDirectory, data: &AppData) -> SnapshotDetail {
        record_snapshot(directory.path(), data, SnapshotSource::HomeworkUpdate, 1_000).unwrap();
        read_snapshot(directory.path(), "1000").unwrap()
    }

    #[test]
    fn apply_snapshot_replaces_only_homeworks_and_vocabulary() {
        let directory = TempDirectory::new();
        let saved = data_with(&["历史科目"], &["历史标签"], vec![homework("历史科目", "旧作业")]);
        record_snapshot(directory.path(), &saved, SnapshotSource::HomeworkUpdate, 1_000).unwrap();
        let detail = read_snapshot(directory.path(), "1000").unwrap();

        let mut current = data_with(&["当前科目"], &["当前标签"], vec![homework("当前科目", "新作业")]);
        current.settings.title = "我的作业".to_owned();
        current.settings.window_visible = false;
        current.settings.homework_scale = 125.0;

        let restored = apply_snapshot(current, detail);
        assert_eq!(restored.homeworks, saved.homeworks);
        assert_eq!(restored.settings.subjects, vec!["历史科目".to_owned()]);
        assert_eq!(restored.settings.tags, vec!["历史标签".to_owned()]);
        assert_eq!(restored.settings.title, "我的作业", "其余设置必须保持不变");
        assert!(!restored.settings.window_visible);
        assert_eq!(restored.settings.homework_scale, 125.0);
    }

    #[test]
    fn snapshot_file_uses_the_camel_case_flat_contract() {
        let directory = TempDirectory::new();
        record_snapshot(
            directory.path(),
            &data_with(&["数学"], &["重点"], vec![homework("数学", "内容")]),
            SnapshotSource::LegacyImport,
            7_000,
        )
        .unwrap();

        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.file("7000.json")).unwrap()).unwrap();
        assert_eq!(value["schemaVersion"], json!(1));
        assert_eq!(value["source"], json!("legacy-import"));
        assert_eq!(value["createdAt"], json!(7_000));
        assert_eq!(value["subjects"], json!(["数学"]));
        assert_eq!(value["homeworks"][0]["content"]["type"], json!("plain-text"));
        assert!(value.get("payload").is_none(), "payload 必须平铺");
        assert!(value.get("reason").is_none(), "不再有 reason 概念");
    }

    #[test]
    fn source_serializes_to_the_frontend_kebab_case_contract() {
        let sources = [
            (SnapshotSource::HomeworkCreate, "homework-create"),
            (SnapshotSource::HomeworkUpdate, "homework-update"),
            (SnapshotSource::HomeworkDelete, "homework-delete"),
            (SnapshotSource::HomeworkCleanup, "homework-cleanup"),
            (SnapshotSource::ExpiryMark, "expiry-mark"),
            (SnapshotSource::CleanupUndo, "cleanup-undo"),
            (SnapshotSource::UafImport, "uaf-import"),
            (SnapshotSource::LegacyImport, "legacy-import"),
            (SnapshotSource::VocabularyUpdate, "vocabulary-update"),
            (SnapshotSource::SnapshotRestore, "snapshot-restore"),
        ];
        for (source, expected) in sources {
            assert_eq!(serde_json::to_value(source).unwrap(), json!(expected));
        }
    }

    #[test]
    fn summary_search_text_extracts_content_and_skips_images() {
        let directory = TempDirectory::new();
        let mut tiptap_hw = homework("物理", "");
        tiptap_hw.tags = vec!["实验".to_owned()];
        tiptap_hw.content = HomeworkContent::TiptapJson {
            document: json!({
                "type": "doc",
                "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "完成力学练习" }] },
                    { "type": "image", "attrs": { "src": "data:image/png;base64,AAAA" } }
                ]
            }),
        };
        let mut xaml_hw = homework("化学", "");
        xaml_hw.content = HomeworkContent::LegacyFlowDocumentXaml {
            xaml: "<FlowDocument><Paragraph>背诵元素周期表</Paragraph></FlowDocument>".to_owned(),
        };
        let data = data_with(&["物理", "化学", "生物"], &["实验", "重要"], vec![tiptap_hw, xaml_hw]);
        record_snapshot(directory.path(), &data, SnapshotSource::HomeworkCreate, 1_000).unwrap();

        let (listed, _) = list_snapshots(directory.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].subjects, vec!["物理".to_owned(), "化学".to_owned()]);
        assert_eq!(listed[0].tags, vec!["实验".to_owned()]);
        let search_text = &listed[0].search_text;
        assert!(!search_text.contains("物理"));
        assert!(!search_text.contains("化学"));
        assert!(!search_text.contains("生物"));
        assert!(search_text.contains("实验"));
        assert!(!search_text.contains("重要"));
        assert!(search_text.contains("完成力学练习"));
        assert!(search_text.contains("背诵元素周期表"));
        assert!(!search_text.contains("base64"));
        assert!(!search_text.contains("FlowDocument"));
    }
}
