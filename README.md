# StickyHomeworks2·N

> **StickyHomeworks2·N 是一款支持作业管理的跨平台作业看板工具**  
> **适用于多场景展示文本的场景**


## 功能

- [X] 登记、修改和删除作业
- [X] 按科目分组作业
- [X] 为作业添加标签
- [X] 作业截止日期和过期状态显示
- [X] 主界面看板宽度设置
- [X] 主题和过期标记设置
- [X] 冻结作业操作
- [X] 桌面端和移动端响应式布局
- [X] 导入原版 `Settings.json`
- [X] 可选导入原版 `Profile.json`
- [X] 富文本编辑
- [X] 插入与管理表情包（编辑器原生 Emoji 输入）
- [ ] 插入图片
- [X] 插入链接
- [ ] 自动清理过期作业
- [ ] 导出作业截图
- [ ] 时间机器
- [ ] 托盘菜单
- [ ] oobe

## 开始使用

### 1. 检查设备需求

StickyHomeworks2·N 基于 Tauri 2 开发，支持桌面端和移动端运行目标

开发或从源码运行前，请确保设备已安装：

- Node.js 和 npm
- Rust 工具链
- Tauri 2 对应的系统依赖
- Linux 环境所需的 WebKitGTK、GTK 等依赖

### 2. 安装依赖

```bash
npm install
```

### 3. 启动软件

启动前端开发服务器：

```bash
npm run dev
```

启动 Tauri 应用：

```bash
npm run tauri dev
```

## 开发

本应用目前正在进行从原版 StickyHomeworks2 到跨平台 Tauri 应用的迁移。

本项目使用以下技术：

- [Tauri 2](https://tauri.app/)
- [Rust](https://www.rust-lang.org/)
- [Vue 3](https://vuejs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [M3E Web Components](https://github.com/m3e-web/m3e-web)

要在本地检查并编译前端，需要执行：

```bash
npm run build
```

该命令会执行 Vue/TypeScript 类型检查和 Vite 生产构建。

构建 Tauri 应用：

```bash
npm run tauri build
```

调试 Tauri 应用：

```bash
npm run tauri dev
```

欢迎为本应用实现新功能或进行改进，并提交 [Pull Request](https://github.com/StickyHomeworks2/StickyHomeworks2/pulls)。

## 数据兼容

应用内容采用版本化联合模型：

- `plain-text`：旧纯文本以及编辑器降级文本。
- `tiptap-json@1`：当前编辑器保存格式，文档存储为 Tiptap JSON。
- `legacy-flowdocument-xaml`：旧 WPF FlowDocument 原文，仅作为迁移输入保存，不注入 WebView。

旧字符串读取时会按内容识别为纯文本或 FlowDocument XAML；编辑并保存后转为新版本格式。FlowDocument 转换仅提取可见文本，无法映射的结构不得静默执行或注入。

图片首版以内嵌 `data:image/*` 保存，允许 PNG/JPEG/GIF/WebP，大小上限 2 MB。链接仅允许 `http:` 和 `https:`，展示时经过协议校验并使用 `noopener noreferrer`。

应用正式运行时将数据保存到 Tauri 的 `app_data_dir`；浏览器 `localStorage` 仅用于预览回退。

## 目录

```text
src/                 Vue 前端
src-tauri/           Tauri 和 Rust 后端
src/components/      可复用组件
src/composables/     Vue 组合式逻辑
src/domain/          作业领域逻辑
src/layouts/         应用布局
src/services/        应用数据和日志服务
src/views/           页面
src/styles/          样式
```

## 相关文档

- [原版 README](StickyHomeworks2-old/README.md)
- [M3E 组件库](https://matraic.github.io/m3e/)
- [Tauri 开发文档](https://tauri.app/)

## 致谢

本项目基于原版 [StickyHomeworks2](https://github.com/StickyHomeworks2/StickyHomeworks2) 进行跨平台迁移开发。

感谢原版项目及其贡献者为作业展示和管理场景提供的设计与实现基础。

## 许可证

本项目的许可证及原版项目的授权信息以仓库中的许可证文件为准。
