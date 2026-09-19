use serde::Serialize;

pub(crate) const STATUS_EVENT: &str = "glycoprotein-status-changed";
pub(crate) const WINDOW_SETTINGS_EVENT: &str = "glycoprotein-window-settings-changed";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlycoproteinStatus {
    pub(crate) supported: bool,
    pub(crate) enabled: bool,
    pub(crate) running: bool,
    pub(crate) node_id: String,
    pub(crate) socket_directory: Option<String>,
    pub(crate) last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowSettingsPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) always_on_bottom: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_topmost: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_height: Option<f64>,
}

#[cfg(desktop)]
mod desktop {
    use chrono::Local;
    use glycoprotein::{
        EventField, GlycoComplex, HandlerError, MethodField, PresenterEvent, UnixDomainMeshConnexon,
    };
    use schemars::JsonSchema;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};
    use tokio::sync::Mutex;
    use tokio::task::JoinHandle;

    use crate::data::AppSettings;
    use crate::logger::{append_event, LogEvent};

    use super::{GlycoproteinStatus, WindowSettingsPatch, STATUS_EVENT, WINDOW_SETTINGS_EVENT};

    const HOMEWORK_CHANGED_EVENT_ID: &str = "homework.changed";

    #[derive(Debug, Serialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct PingResponse {
        message: String,
    }

    #[derive(Debug, Serialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct HomeworkChangedPayload {
        homework_count: i32,
        timestamp: String,
    }

    #[derive(Debug, Deserialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct WindowPositionArgs {
        /// 窗口左上角横坐标 (物理像素)
        x: f64,
        /// 窗口左上角纵坐标 (物理像素)
        y: f64,
    }

    #[derive(Debug, Deserialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct WindowSizeArgs {
        /// 窗口宽度 (物理像素)
        width: f64,
        /// 窗口高度 (物理像素)
        height: f64,
    }

    #[derive(Debug, Deserialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct SetTitleArgs {
        /// 目标标题
        title: String,
    }

    #[derive(Debug, Deserialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct SetTopmostArgs {
        /// 置顶
        topmost: bool,
    }

    #[derive(Debug, Serialize, JsonSchema)]
    #[serde(rename_all = "PascalCase")]
    #[schemars(rename_all = "PascalCase")]
    struct WindowStateResponse {
        visible: bool,
        topmost: bool,
        title: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    #[derive(Default)]
    struct ServiceState {
        node: Option<GlycoComplex>,
        presenter_task: Option<JoinHandle<()>>,
        enabled: bool,
        node_id: String,
        last_error: Option<String>,
    }

    pub(crate) struct GlycoproteinService {
        state: Mutex<ServiceState>,
    }

    impl Default for GlycoproteinService {
        fn default() -> Self {
            Self {
                state: Mutex::new(ServiceState::default()),
            }
        }
    }

    impl GlycoproteinService {
        pub(crate) async fn reconcile(
            &self,
            app: &AppHandle,
            settings: &AppSettings,
        ) -> GlycoproteinStatus {
            let mut state = self.state.lock().await;
            let was_enabled = state.enabled;
            state.enabled = settings.glycoprotein_enabled;
            state.node_id = settings.glycoprotein_node_id.clone();

            if !settings.glycoprotein_enabled {
                let was_running = state.node.is_some();
                stop_node(app, &mut state).await;
                state.last_error = None;
                let status = status_from_state(&state);
                drop(state);
                emit_status(app, &status);
                if was_enabled && !was_running {
                    log(
                        app,
                        "info",
                        "glycoprotein.stop",
                        "Glycoprotein 服务已停用",
                        None,
                    );
                }
                return status;
            }

            if state
                .node
                .as_ref()
                .is_some_and(|node| node.id() == settings.glycoprotein_node_id && node.is_started())
            {
                state.last_error = None;
                let status = status_from_state(&state);
                drop(state);
                emit_status(app, &status);
                return status;
            }

            stop_node(app, &mut state).await;
            match build_node(app, &settings.glycoprotein_node_id) {
                Ok((node, presenter_events)) => match node.start().await {
                    Ok(()) => {
                        let node_id = node.id().to_owned();
                        state.presenter_task =
                            Some(spawn_presenter_logger(app.clone(), presenter_events));
                        state.node = Some(node);
                        state.last_error = None;
                        log(
                            app,
                            "info",
                            "glycoprotein.start",
                            &format!("Glycoprotein 节点已启动，Gid=[{node_id}]"),
                            Some(json!({ "nodeId": node_id })),
                        );
                    }
                    Err(error) => {
                        state.last_error = Some(error.to_string());
                        log(
                            app,
                            "error",
                            "glycoprotein.start",
                            &format!("启动 Glycoprotein 节点失败：{error}"),
                            Some(json!({ "nodeId": settings.glycoprotein_node_id })),
                        );
                    }
                },
                Err(error) => {
                    state.last_error = Some(error.clone());
                    log(
                        app,
                        "error",
                        "glycoprotein.build",
                        &format!("创建 Glycoprotein 节点失败：{error}"),
                        Some(json!({ "nodeId": settings.glycoprotein_node_id })),
                    );
                }
            }

            let status = status_from_state(&state);
            drop(state);
            emit_status(app, &status);
            status
        }

        pub(crate) async fn status(&self) -> GlycoproteinStatus {
            let state = self.state.lock().await;
            status_from_state(&state)
        }

        pub(crate) async fn emit_homework_changed(&self, app: &AppHandle, homework_count: usize) {
            let node = self.state.lock().await.node.clone();
            let Some(node) = node else {
                return;
            };
            let payload = HomeworkChangedPayload {
                homework_count: i32::try_from(homework_count).unwrap_or(i32::MAX),
                timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            match node.emit(HOMEWORK_CHANGED_EVENT_ID, &payload).await {
                Ok(()) => log(
                    app,
                    "info",
                    "glycoprotein.homework.emit",
                    &format!("已广播 {HOMEWORK_CHANGED_EVENT_ID} 事件（作业数：{homework_count}）"),
                    Some(json!({ "homeworkCount": homework_count })),
                ),
                Err(error) => log(
                    app,
                    "warn",
                    "glycoprotein.homework.emit",
                    &format!("广播 {HOMEWORK_CHANGED_EVENT_ID} 事件失败：{error}"),
                    Some(json!({ "homeworkCount": homework_count })),
                ),
            }
        }

        pub(crate) async fn shutdown(&self, app: &AppHandle) {
            let mut state = self.state.lock().await;
            stop_node(app, &mut state).await;
            let status = status_from_state(&state);
            drop(state);
            emit_status(app, &status);
        }
    }

    pub(crate) fn apply_window_settings(
        app: &AppHandle,
        settings: &AppSettings,
        allow_hidden: bool,
    ) -> Result<(), String> {
        let window = main_window(app).map_err(|error| error.to_string())?;
        let mut errors = Vec::new();

        let should_show = settings.window_visible || !allow_hidden;
        let visibility_result = match window.is_visible() {
            Ok(is_visible) if is_visible == should_show => Ok(()),
            _ if should_show => window.show(),
            _ => window.hide(),
        };
        collect_window_result(&mut errors, "visibility", visibility_result);
        collect_window_result(&mut errors, "title", window.set_title(&settings.title));
        collect_window_result(
            &mut errors,
            "always-on-bottom",
            window.set_always_on_bottom(settings.always_on_bottom),
        );
        collect_window_result(
            &mut errors,
            "always-on-top",
            window.set_always_on_top(settings.window_topmost),
        );

        if let (Some(x), Some(y)) = (settings.window_x, settings.window_y) {
            match (coordinate(x, "X"), coordinate(y, "Y")) {
                (Ok(x), Ok(y)) => collect_window_result(
                    &mut errors,
                    "position",
                    window.set_position(Position::Physical(PhysicalPosition::new(x, y))),
                ),
                (x, y) => errors.extend([x.err(), y.err()].into_iter().flatten()),
            }
        }
        if let (Some(width), Some(height)) = (settings.window_width, settings.window_height) {
            match (dimension(width, "Width"), dimension(height, "Height")) {
                (Ok(width), Ok(height)) => collect_window_result(
                    &mut errors,
                    "size",
                    window.set_size(Size::Physical(PhysicalSize::new(width, height))),
                ),
                (width, height) => errors.extend([width.err(), height.err()].into_iter().flatten()),
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    fn collect_window_result<T>(
        errors: &mut Vec<String>,
        operation: &str,
        result: tauri::Result<T>,
    ) {
        if let Err(error) = result {
            errors.push(format!("{operation}: {error}"));
        }
    }

    async fn stop_node(app: &AppHandle, state: &mut ServiceState) {
        if let Some(task) = state.presenter_task.take() {
            task.abort();
        }
        if let Some(node) = state.node.take() {
            let node_id = node.id().to_owned();
            if let Err(error) = node.stop().await {
                log(
                    app,
                    "warn",
                    "glycoprotein.stop",
                    &format!("停止 Glycoprotein 节点失败：{error}"),
                    Some(json!({ "nodeId": node_id })),
                );
            } else {
                log(
                    app,
                    "info",
                    "glycoprotein.stop",
                    "Glycoprotein 节点已停止",
                    Some(json!({ "nodeId": node_id })),
                );
            }
        }
    }

    fn build_node(
        app: &AppHandle,
        node_id: &str,
    ) -> Result<
        (
            GlycoComplex,
            tokio::sync::broadcast::Receiver<PresenterEvent>,
        ),
        String,
    > {
        let node = GlycoComplex::builder(node_id)
            .vendor(format!("StickyHomeworks2N v{}", app.package_info().version))
            .build()
            .map_err(|error| error.to_string())?;

        #[cfg(debug_assertions)]
        {
            let app = app.clone();
            node.register_query(
                MethodField::new("ping")
                    .friendly_name("Ping")
                    .description("测试连通性"),
                move |_| {
                    let app = app.clone();
                    async move {
                        log(
                            &app,
                            "info",
                            "glycoprotein.ping",
                            "收到 Glycoprotein ping 请求",
                            None,
                        );
                        Ok(PingResponse {
                            message: "Pong!".to_owned(),
                        })
                    }
                },
            )
            .map_err(|error| error.to_string())?;
        }

        register_window_actions(&node, app)?;
        node.register_event::<HomeworkChangedPayload>(
            EventField::new(HOMEWORK_CHANGED_EVENT_ID)
                .friendly_name("作业数据变更")
                .description("作业数据发生变更时广播"),
        )
        .map_err(|error| error.to_string())?;

        let presenter_events = node.subscribe_presenters();
        Ok((node, presenter_events))
    }

    fn register_window_actions(node: &GlycoComplex, app: &AppHandle) -> Result<(), String> {
        let action_app = app.clone();
        node.register_action(
            MethodField::new("window.hide")
                .friendly_name("隐藏窗口")
                .description("隐藏 SH2 主窗口"),
            move |_| {
                let app = action_app.clone();
                async move {
                    main_window(&app)?.hide().map_err(handler_error)?;
                    emit_window_patch(
                        &app,
                        WindowSettingsPatch {
                            window_visible: Some(false),
                            ..WindowSettingsPatch::default()
                        },
                    )?;
                    log(
                        &app,
                        "info",
                        "glycoprotein.window.hide",
                        "Glycoprotein：已隐藏主窗口",
                        None,
                    );
                    Ok(())
                }
            },
        )
        .map_err(|error| error.to_string())?;

        let action_app = app.clone();
        node.register_action(
            MethodField::new("window.show")
                .friendly_name("显示窗口")
                .description("显示并激活 SH2 主窗口"),
            move |_| {
                let app = action_app.clone();
                async move {
                    let window = main_window(&app)?;
                    window.show().map_err(handler_error)?;
                    window.set_focus().map_err(handler_error)?;
                    emit_window_patch(
                        &app,
                        WindowSettingsPatch {
                            window_visible: Some(true),
                            ..WindowSettingsPatch::default()
                        },
                    )?;
                    log(
                        &app,
                        "info",
                        "glycoprotein.window.show",
                        "Glycoprotein：已显示主窗口",
                        None,
                    );
                    Ok(())
                }
            },
        )
        .map_err(|error| error.to_string())?;

        let action_app = app.clone();
        node.register_action_with(
            MethodField::new("window.topmost")
                .friendly_name("设置窗口置顶")
                .description("true=置顶, false=取消置顶"),
            move |args: SetTopmostArgs, _| {
                let app = action_app.clone();
                async move {
                    let window = main_window(&app)?;
                    if args.topmost {
                        window.set_always_on_bottom(false).map_err(handler_error)?;
                    }
                    window
                        .set_always_on_top(args.topmost)
                        .map_err(handler_error)?;
                    emit_window_patch(
                        &app,
                        WindowSettingsPatch {
                            always_on_bottom: args.topmost.then_some(false),
                            window_topmost: Some(args.topmost),
                            ..WindowSettingsPatch::default()
                        },
                    )?;
                    log(
                        &app,
                        "info",
                        "glycoprotein.window.topmost",
                        &format!("Glycoprotein：窗口置顶 = {}", args.topmost),
                        Some(json!({ "topmost": args.topmost })),
                    );
                    Ok(())
                }
            },
        )
        .map_err(|error| error.to_string())?;

        let action_app = app.clone();
        node.register_action_with(
            MethodField::new("window.position")
                .friendly_name("设置窗口位置")
                .description("按物理像素设置主窗口位置 (与设置中的 WindowX/WindowY 一致)"),
            move |args: WindowPositionArgs, _| {
                let app = action_app.clone();
                async move {
                    let x = coordinate(args.x, "X").map_err(handler_error)?;
                    let y = coordinate(args.y, "Y").map_err(handler_error)?;
                    main_window(&app)?
                        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
                        .map_err(handler_error)?;
                    emit_window_patch(
                        &app,
                        WindowSettingsPatch {
                            window_x: Some(f64::from(x)),
                            window_y: Some(f64::from(y)),
                            ..WindowSettingsPatch::default()
                        },
                    )?;
                    log(
                        &app,
                        "info",
                        "glycoprotein.window.position",
                        &format!("Glycoprotein：窗口位置 = ({x}, {y})"),
                        Some(json!({ "x": x, "y": y })),
                    );
                    Ok(())
                }
            },
        )
        .map_err(|error| error.to_string())?;

        let action_app = app.clone();
        node.register_action_with(
            MethodField::new("window.size")
                .friendly_name("设置窗口大小")
                .description("按物理像素设置主窗口大小 (与设置中的 WindowWidth/WindowHeight 一致)"),
            move |args: WindowSizeArgs, _| {
                let app = action_app.clone();
                async move {
                    let width = dimension(args.width, "Width").map_err(handler_error)?;
                    let height = dimension(args.height, "Height").map_err(handler_error)?;
                    main_window(&app)?
                        .set_size(Size::Physical(PhysicalSize::new(width, height)))
                        .map_err(handler_error)?;
                    emit_window_patch(
                        &app,
                        WindowSettingsPatch {
                            window_width: Some(f64::from(width)),
                            window_height: Some(f64::from(height)),
                            ..WindowSettingsPatch::default()
                        },
                    )?;
                    log(
                        &app,
                        "info",
                        "glycoprotein.window.size",
                        &format!("Glycoprotein：窗口大小 = {width}x{height}"),
                        Some(json!({ "width": width, "height": height })),
                    );
                    Ok(())
                }
            },
        )
        .map_err(|error| error.to_string())?;

        let action_app = app.clone();
        node.register_action_with(
            MethodField::new("window.title")
                .friendly_name("设置窗口标题")
                .description("修改主窗口标题"),
            move |args: SetTitleArgs, _| {
                let app = action_app.clone();
                async move {
                    let title = normalized_title(&args.title);
                    main_window(&app)?
                        .set_title(&title)
                        .map_err(handler_error)?;
                    emit_window_patch(
                        &app,
                        WindowSettingsPatch {
                            title: Some(title.clone()),
                            ..WindowSettingsPatch::default()
                        },
                    )?;
                    log(
                        &app,
                        "info",
                        "glycoprotein.window.title",
                        &format!("Glycoprotein：窗口标题 = [{title}]"),
                        Some(json!({ "title": title })),
                    );
                    Ok(())
                }
            },
        )
        .map_err(|error| error.to_string())?;

        let query_app = app.clone();
        node.register_query(
            MethodField::new("window.getState")
                .friendly_name("获取窗口状态")
                .description("返回主窗口可见性/置顶/标题/位置大小 (物理像素)"),
            move |_| {
                let app = query_app.clone();
                async move { window_state(&app) }
            },
        )
        .map_err(|error| error.to_string())?;

        Ok(())
    }

    fn window_state(app: &AppHandle) -> Result<WindowStateResponse, HandlerError> {
        let window = main_window(app)?;
        let position = window.outer_position().map_err(handler_error)?;
        let size = window.outer_size().map_err(handler_error)?;
        Ok(WindowStateResponse {
            visible: window.is_visible().map_err(handler_error)?,
            topmost: window.is_always_on_top().map_err(handler_error)?,
            title: window.title().map_err(handler_error)?,
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(size.width),
            height: f64::from(size.height),
        })
    }

    fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, HandlerError> {
        app.get_webview_window("main")
            .ok_or_else(|| HandlerError::new("main window is unavailable"))
    }

    fn emit_window_patch(app: &AppHandle, patch: WindowSettingsPatch) -> Result<(), HandlerError> {
        app.emit(WINDOW_SETTINGS_EVENT, patch)
            .map_err(handler_error)
    }

    fn coordinate(value: f64, name: &str) -> Result<i32, String> {
        if !value.is_finite() || value < i32::MIN as f64 || value > i32::MAX as f64 {
            return Err(format!(
                "{name} must be a finite 32-bit physical pixel coordinate"
            ));
        }
        Ok(value.round() as i32)
    }

    fn dimension(value: f64, name: &str) -> Result<u32, String> {
        let rounded = value.round();
        if !value.is_finite() || rounded < 1.0 || rounded > u32::MAX as f64 {
            return Err(format!(
                "{name} must be a positive 32-bit physical pixel size"
            ));
        }
        Ok(rounded as u32)
    }

    fn normalized_title(value: &str) -> String {
        let value = value.trim();
        if value.is_empty() {
            "作业".to_owned()
        } else {
            value.to_owned()
        }
    }

    fn handler_error(error: impl std::fmt::Display) -> HandlerError {
        HandlerError::new(error.to_string())
    }

    fn status_from_state(state: &ServiceState) -> GlycoproteinStatus {
        GlycoproteinStatus {
            supported: true,
            enabled: state.enabled,
            running: state.node.as_ref().is_some_and(GlycoComplex::is_started),
            node_id: state.node_id.clone(),
            socket_directory: Some(
                UnixDomainMeshConnexon::default_socket_directory()
                    .to_string_lossy()
                    .into_owned(),
            ),
            last_error: state.last_error.clone(),
        }
    }

    fn emit_status(app: &AppHandle, status: &GlycoproteinStatus) {
        if let Err(error) = app.emit(STATUS_EVENT, status) {
            log(
                app,
                "warn",
                "glycoprotein.status.emit",
                &format!("发布 Glycoprotein 状态失败：{error}"),
                None,
            );
        }
    }

    fn spawn_presenter_logger(
        app: AppHandle,
        mut events: tokio::sync::broadcast::Receiver<PresenterEvent>,
    ) -> JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(PresenterEvent::Discovered(beacon)) => log(
                        &app,
                        "info",
                        "glycoprotein.presenter.discovered",
                        &format!("发现 Glycoprotein 节点：[{}]", beacon.id),
                        Some(json!({
                            "nodeId": beacon.id,
                            "vendor": beacon.vendor,
                            "fieldCount": beacon.fields.len(),
                        })),
                    ),
                    Ok(PresenterEvent::Changed { current, .. }) => log(
                        &app,
                        "debug",
                        "glycoprotein.presenter.changed",
                        &format!("Glycoprotein 节点已变化：[{}]", current.id),
                        Some(json!({
                            "nodeId": current.id,
                            "fieldCount": current.fields.len(),
                        })),
                    ),
                    Ok(PresenterEvent::Expired(beacon)) => log(
                        &app,
                        "info",
                        "glycoprotein.presenter.expired",
                        &format!("Glycoprotein 节点已过期：[{}]", beacon.id),
                        Some(json!({ "nodeId": beacon.id })),
                    ),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => log(
                        &app,
                        "warn",
                        "glycoprotein.presenter.lagged",
                        &format!("Glycoprotein 节点事件丢失 {count} 条"),
                        None,
                    ),
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    }

    fn log(app: &AppHandle, level: &str, operation: &str, message: &str, details: Option<Value>) {
        let _ = append_event(
            app,
            LogEvent {
                level: level.to_owned(),
                operation: operation.to_owned(),
                message: message.to_owned(),
                request_id: None,
                details,
            },
        );
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn wire_payloads_keep_the_pascal_case_contract() {
            let event = serde_json::to_value(HomeworkChangedPayload {
                homework_count: 3,
                timestamp: "2026-09-17 12:34:56".to_owned(),
            })
            .expect("event payload should serialize");
            assert_eq!(
                event,
                json!({
                    "HomeworkCount": 3,
                    "Timestamp": "2026-09-17 12:34:56"
                })
            );

            let position: WindowPositionArgs = serde_json::from_value(json!({
                "X": 12.5,
                "Y": -9.25
            }))
            .expect("PascalCase position should deserialize");
            assert_eq!(position.x, 12.5);
            assert_eq!(position.y, -9.25);

            let state = serde_json::to_value(WindowStateResponse {
                visible: true,
                topmost: false,
                title: "作业".to_owned(),
                x: 10.0,
                y: 20.0,
                width: 400.0,
                height: 800.0,
            })
            .expect("window state should serialize");
            assert_eq!(state["Visible"], true);
            assert_eq!(state["Topmost"], false);
            assert_eq!(state["Title"], "作业");
            assert_eq!(state["Width"], 400.0);
        }

        #[test]
        fn window_patch_uses_the_frontend_camel_case_contract() {
            let patch = serde_json::to_value(WindowSettingsPatch {
                window_visible: Some(false),
                window_width: Some(640.0),
                ..WindowSettingsPatch::default()
            })
            .expect("window patch should serialize");

            assert_eq!(
                patch,
                json!({ "windowVisible": false, "windowWidth": 640.0 })
            );
        }

        #[test]
        fn validates_and_rounds_physical_window_geometry() {
            assert_eq!(coordinate(12.6, "X"), Ok(13));
            assert!(coordinate(f64::NAN, "X").is_err());
            assert_eq!(dimension(0.6, "Width"), Ok(1));
            assert!(dimension(0.4, "Width").is_err());
            assert!(dimension(f64::INFINITY, "Width").is_err());
        }

        #[test]
        fn crates_io_transport_rejects_unsafe_node_ids() {
            assert!(GlycoComplex::builder("bad/node").build().is_err());
            assert!(GlycoComplex::builder("stickyHomeworks-test")
                .build()
                .is_ok());
        }

        #[tokio::test]
        async fn crates_io_node_can_start_and_stop() {
            let uuid = uuid::Uuid::new_v4().to_string();
            let node_id = format!(
                "stickyHomeworks-{}",
                uuid.split('-').nth(1).expect("UUID has a second segment")
            );
            let node = GlycoComplex::builder(node_id)
                .build()
                .expect("test node should build");

            node.start().await.expect("test node should start");
            assert!(node.is_started());
            node.stop().await.expect("test node should stop");
            assert!(!node.is_started());
        }
    }
}

#[cfg(mobile)]
mod mobile {
    use tauri::AppHandle;

    use crate::data::AppSettings;

    use super::GlycoproteinStatus;

    #[derive(Default)]
    pub(crate) struct GlycoproteinService;

    impl GlycoproteinService {
        pub(crate) async fn reconcile(
            &self,
            _app: &AppHandle,
            settings: &AppSettings,
        ) -> GlycoproteinStatus {
            unsupported_status(settings)
        }

        pub(crate) async fn status(&self) -> GlycoproteinStatus {
            GlycoproteinStatus {
                supported: false,
                enabled: false,
                running: false,
                node_id: String::new(),
                socket_directory: None,
                last_error: None,
            }
        }

        pub(crate) async fn emit_homework_changed(&self, _app: &AppHandle, _homework_count: usize) {
        }

        pub(crate) async fn shutdown(&self, _app: &AppHandle) {}
    }

    pub(crate) fn apply_window_settings(
        _app: &AppHandle,
        _settings: &AppSettings,
        _allow_hidden: bool,
    ) -> Result<(), String> {
        Ok(())
    }

    fn unsupported_status(settings: &AppSettings) -> GlycoproteinStatus {
        GlycoproteinStatus {
            supported: false,
            enabled: settings.glycoprotein_enabled,
            running: false,
            node_id: settings.glycoprotein_node_id.clone(),
            socket_directory: None,
            last_error: None,
        }
    }
}

#[cfg(desktop)]
pub(crate) use desktop::{apply_window_settings, GlycoproteinService};
#[cfg(mobile)]
pub(crate) use mobile::{apply_window_settings, GlycoproteinService};
