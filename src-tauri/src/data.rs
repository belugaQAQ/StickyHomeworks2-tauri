use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub(crate) const OTHER_SUBJECT: &str = "其它";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeworkRecord {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(
        default,
        alias = "Content",
        deserialize_with = "deserialize_homework_content"
    )]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
        Self::PlainText {
            text: String::new(),
        }
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
    #[serde(default, alias = "AlwaysOnBottom", alias = "IsBottom")]
    pub(crate) always_on_bottom: bool,
    #[serde(default, alias = "AutoStart")]
    pub(crate) auto_start: bool,
    #[serde(default = "default_background_opacity", alias = "BackgroundOpacity")]
    pub(crate) background_opacity: f64,
    #[serde(default = "default_homework_scale", alias = "HomeworkScale")]
    pub(crate) homework_scale: f64,
    #[serde(default, alias = "IsGlycoproteinEnabled")]
    pub(crate) glycoprotein_enabled: bool,
    #[serde(default = "default_glycoprotein_node_id", alias = "GlycoproteinNodeId")]
    pub(crate) glycoprotein_node_id: String,
    #[serde(default = "default_true", alias = "IsMainWindowVisible")]
    pub(crate) window_visible: bool,
    #[serde(default, alias = "IsMainWindowTopmost")]
    pub(crate) window_topmost: bool,
    #[serde(default, alias = "WindowX")]
    pub(crate) window_x: Option<f64>,
    #[serde(default, alias = "WindowY")]
    pub(crate) window_y: Option<f64>,
    #[serde(default, alias = "WindowWidth")]
    pub(crate) window_width: Option<f64>,
    #[serde(default, alias = "WindowHeight")]
    pub(crate) window_height: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
            auto_start: false,
            background_opacity: default_background_opacity(),
            homework_scale: default_homework_scale(),
            glycoprotein_enabled: false,
            glycoprotein_node_id: default_glycoprotein_node_id(),
            window_visible: true,
            window_topmost: false,
            window_x: None,
            window_y: None,
            window_width: None,
            window_height: None,
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
    settings.background_opacity = normalize_background_opacity(settings.background_opacity);
    settings.homework_scale = normalize_homework_scale(settings.homework_scale);
    settings.glycoprotein_node_id = normalized_glycoprotein_node_id(&settings.glycoprotein_node_id);
    settings.window_x = normalize_window_coordinate(settings.window_x);
    settings.window_y = normalize_window_coordinate(settings.window_y);
    settings.window_width = normalize_window_dimension(settings.window_width);
    settings.window_height = normalize_window_dimension(settings.window_height);
    if settings.window_topmost {
        settings.always_on_bottom = false;
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

fn default_background_opacity() -> f64 {
    100.0
}

fn normalize_background_opacity(value: f64) -> f64 {
    let value = if value.is_finite() {
        value
    } else {
        default_background_opacity()
    };
    value.clamp(0.0, 100.0).round()
}
fn default_homework_scale() -> f64 {
    100.0
}

fn default_glycoprotein_node_id() -> String {
    let uuid = Uuid::new_v4().to_string();
    let random_segment = uuid.split('-').nth(1).unwrap_or("node");
    format!("stickyHomeworks-{random_segment}")
}

fn normalize_homework_scale(value: f64) -> f64 {
    let value = if value.is_finite() {
        value
    } else {
        default_homework_scale()
    };
    (value.clamp(75.0, 200.0) / 5.0).round() * 5.0
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

fn normalized_glycoprotein_node_id(value: &str) -> String {
    let node_id = value.trim();
    if node_id.is_empty() {
        default_glycoprotein_node_id()
    } else {
        node_id.to_owned()
    }
}

fn normalize_window_coordinate(value: Option<f64>) -> Option<f64> {
    value
        .filter(|coordinate| {
            coordinate.is_finite()
                && *coordinate >= i32::MIN as f64
                && *coordinate <= i32::MAX as f64
        })
        .map(f64::round)
}

fn normalize_window_dimension(value: Option<f64>) -> Option<f64> {
    value
        .filter(|dimension| {
            dimension.is_finite()
                && dimension.round() >= 1.0
                && dimension.round() <= u32::MAX as f64
        })
        .map(f64::round)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_include_a_persistent_glycoprotein_identity() {
        let settings = AppSettings::default();

        assert!(!settings.glycoprotein_enabled);
        assert!(settings
            .glycoprotein_node_id
            .starts_with("stickyHomeworks-"));
        assert!(settings.window_visible);
        assert!(!settings.window_topmost);
    }

    #[test]
    fn normalizes_glycoprotein_and_physical_window_settings() {
        let mut settings = AppSettings {
            always_on_bottom: true,
            glycoprotein_node_id: "  ".to_owned(),
            window_topmost: true,
            window_x: Some(12.6),
            window_y: Some(f64::INFINITY),
            window_width: Some(0.4),
            window_height: Some(600.5),
            ..AppSettings::default()
        };

        normalize_settings(&mut settings);

        assert!(!settings.always_on_bottom);
        assert!(settings
            .glycoprotein_node_id
            .starts_with("stickyHomeworks-"));
        assert_eq!(settings.window_x, Some(13.0));
        assert_eq!(settings.window_y, None);
        assert_eq!(settings.window_width, None);
        assert_eq!(settings.window_height, Some(601.0));
    }

    #[test]
    fn reads_legacy_glycoprotein_and_window_aliases() {
        let settings: AppSettings = serde_json::from_value(json!({
            "IsBottom": true,
            "IsGlycoproteinEnabled": true,
            "GlycoproteinNodeId": "legacy-node",
            "IsMainWindowVisible": false,
            "IsMainWindowTopmost": true,
            "WindowX": 10,
            "WindowY": 20,
            "WindowWidth": 300,
            "WindowHeight": 400
        }))
        .expect("legacy settings should deserialize");

        assert!(settings.glycoprotein_enabled);
        assert_eq!(settings.glycoprotein_node_id, "legacy-node");
        assert!(!settings.window_visible);
        assert!(settings.window_topmost);
        assert_eq!(settings.window_x, Some(10.0));
        assert_eq!(settings.window_height, Some(400.0));
    }
}
