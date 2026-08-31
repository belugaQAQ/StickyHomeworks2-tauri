use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub(crate) const OTHER_SUBJECT: &str = "其它";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeworkRecord {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default, alias = "Content", deserialize_with = "deserialize_homework_content")]
    pub(crate) content: HomeworkContent,
    #[serde(default, alias = "Subject")]
    pub(crate) subject: String,
    #[serde(default = "default_due_time", alias = "DueTime")]
    pub(crate) due_time: String,
    #[serde(default, alias = "Tags")]
    pub(crate) tags: Vec<String>,
    #[serde(default, alias = "FirstExpiredShowTime")]
    pub(crate) first_expired_show_time: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
pub(crate) enum HomeworkContent {
    #[serde(rename = "plain-text")]
    PlainText { text: String },
    #[serde(rename = "tiptap-json@1")]
    TiptapJson { document: Value },
    #[serde(rename = "legacy-flowdocument-xaml")]
    LegacyFlowDocumentXaml { xaml: String },
}

impl Default for HomeworkContent {
    fn default() -> Self {
        Self::PlainText { text: String::new() }
    }
}

fn deserialize_homework_content<'de, D>(deserializer: D) -> Result<HomeworkContent, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    if let Value::String(text) = value {
        if text.trim_start().starts_with("<FlowDocument") {
            return Ok(HomeworkContent::LegacyFlowDocumentXaml { xaml: text });
        }
        return Ok(HomeworkContent::PlainText { text });
    }
    serde_json::from_value(value).map_err(serde::de::Error::custom)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    #[serde(default = "default_title", alias = "Title")]
    pub(crate) title: String,
    #[serde(default, alias = "Subjects")]
    pub(crate) subjects: Vec<String>,
    #[serde(default, alias = "Tags")]
    pub(crate) tags: Vec<String>,
    #[serde(default = "default_true", alias = "Autooutwork")]
    pub(crate) auto_outwork: bool,
    #[serde(default, alias = "DelayedCleanupEnabled")]
    pub(crate) delayed_cleanup_enabled: bool,
    #[serde(default, alias = "IsExpiredMarkEnabled")]
    pub(crate) is_expired_mark_enabled: bool,
    #[serde(default = "default_expired_mark_color", alias = "ExpiredMarkColor")]
    pub(crate) expired_mark_color: String,
    #[serde(default = "default_max_panel_width", alias = "MaxPanelWidth")]
    pub(crate) max_panel_width: f64,
    #[serde(default, alias = "AlwaysOnBottom")]
    pub(crate) always_on_bottom: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppData {
    #[serde(default = "schema_version")]
    pub(crate) schema_version: u8,
    #[serde(default, alias = "Homeworks")]
    pub(crate) homeworks: Vec<HomeworkRecord>,
    #[serde(default)]
    pub(crate) settings: AppSettings,
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
            always_on_bottom: false,
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

pub(crate) fn normalize_app_data(data: &mut AppData) {
    data.schema_version = schema_version();
    normalize_settings(&mut data.settings);

    for homework in &mut data.homeworks {
        if Uuid::parse_str(&homework.id).is_err() {
            homework.id = Uuid::new_v4().to_string();
        }
    }
}

pub(crate) fn normalize_settings(settings: &mut AppSettings) {
    settings.title = normalized_title(&settings.title);
    settings.subjects = unique_vocabulary(std::mem::take(&mut settings.subjects));
    settings.tags = unique_vocabulary(std::mem::take(&mut settings.tags));
    settings.max_panel_width = normalize_panel_width(settings.max_panel_width);
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

fn default_due_time() -> String {
    "1970-01-01T00:00:00".to_owned()
}

fn normalized_title(value: &str) -> String {
    let title = value.trim();
    if title.is_empty() {
        default_title()
    } else {
        title.to_owned()
    }
}

fn unique_vocabulary(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if !value.is_empty() && !normalized.iter().any(|item| item == value) {
            normalized.push(value.to_owned());
        }
    }
    normalized
}

fn normalize_panel_width(value: f64) -> f64 {
    let value = if value.is_finite() {
        value
    } else {
        default_max_panel_width()
    };
    (value.clamp(160.0, 2000.0) / 10.0).round() * 10.0
}

#[cfg(all(test, feature = "local-tests"))]
#[path = "local_tests/data.rs"]
mod local_tests;
