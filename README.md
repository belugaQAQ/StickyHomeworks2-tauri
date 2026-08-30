<div align="center"><h1>StickyHomeworks2·N</h1>
</div>

> 将零散信息收进一个看板，好看、好玩、好用

StickyHomeworks2·N 是一个基于 Tauri 2 的跨平台作业看板，面向需要在班级大屏等不同设备上持续整理作业的人。  
StickyHomeworks2·N 在作业大显身手，却不止于作业

## 你可以用它做什么

- [X] 登记、修改和删除作业
- [X] 按科目分组作业
- [X] 为作业添加标签
- [X] 作业截止日期和过期状态显示
- [X] 主界面看板宽度设置
- [X] 主题和过期标记设置
- [X] 冻结作业操作
- [X] 桌面端和移动端响应式布局
- [X] 导入原版配置文件
- [X] 富文本编辑
- [x] 插入图片
- [X] 插入链接
- [ ] 自动清理过期作业
- [ ] 导出作业截图
- [ ] 时间机器
- [ ] 托盘菜单
- [ ] oobe

> 当前项目处于从原版 StickyHomeworks2 迁移的开发阶段。自动清理过期作业、作业截图、时间机器、托盘菜单和模板页面仍未完成。

## 快速开始

### 环境

- Node.js 与 npm
- Rust 工具链
- Tauri 2 对应的系统依赖
- Linux 运行时需要 WebKitGTK、GTK 等依赖

### 安装并运行

```bash
npm install
npm run dev
```

仅启动前端预览时，访问 Vite 输出的本地地址即可。需要运行完整桌面应用时，另开终端执行：

```bash
npm run tauri dev
```

### 构建

```bash
# 类型检查 + Vite 生产构建
npm run build

# Tauri 桌面/移动目标构建入口
npm run tauri build
```

## 数据与旧版兼容

应用数据采用版本化内容联合模型：

| 内容类型 | 用途 |
| --- | --- |
| `plain-text` | 旧纯文本与编辑器降级文本 |
| `tiptap-json@1` | 当前富文本编辑器保存格式 |
| `legacy-flowdocument-xaml` | 原版 WPF `FlowDocument` XAML 原文，仅作为迁移输入保存 |

旧字符串会按内容识别为纯文本或 `FlowDocument` XAML。编辑并保存后进入新的内容格式；XAML 不会直接注入 WebView，当前兼容路径只提取可见文本作为编辑器回退内容。

图片以嵌入式 `data:` 保存，支持 PNG、JPEG、GIF、WebP，单张上限 2 MB。链接展示前会进行协议校验；外部打开需要确认。

旧版导入入口位于设置页：`Settings.json` 是必需文件，`Profile.json` 可选。导入过程中会报告旧富文本数量，以及被移除的标签引用和被替换的科目数量。

## 技术栈与目录

- [Tauri 2](https://tauri.app/)：桌面与移动运行时
- [Rust](https://www.rust-lang.org/)：持久化、迁移、日志和诊断
- [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/)：应用界面与状态编排
- [M3E Web Components](https://matraic.github.io/m3e/)：Material 3 风格控件
- [Tiptap](https://tiptap.dev/)：富文本文档编辑

```text
src/                 Vue 前端入口与路由
src/components/      可复用对话框与布局组件
src/composables/     编辑器、看板、持久化和平台组合逻辑
src/domain/          作业、设置、词库领域逻辑
src/services/        数据、日志、诊断和平台服务
src/views/           作业、模板和设置页面
src/styles/          应用壳、看板和设置样式
src-tauri/src/       Tauri commands、数据模型与 Rust 服务
assets/readme/       README 专用视觉资产
```

## 相关链接

- [M3E 组件文档](https://matraic.github.io/m3e/)
- [Tauri 文档](https://tauri.app/)

## 参与开发

欢迎通过 [Pull Request](https://github.com/StickyHomeworks2/StickyHomeworks2/pulls) 提交改进。涉及 Tauri 行为时，请同时区分浏览器预览与实际桌面/移动运行时的验证结果。

## 开发

本应用目前的开发状态：

- 正在[`master`](https://github.com/belugaQAQ/StickyHomeworks2-tauri/tree/master)分支上开发本应用

要在本地编译调试应用，您需要安装以下负载和工具：
- [Rust](https://rust-lang.org/zh-CN/tools/install/)
- [Node.js](https://nodejs.org/zh-cn)
- [RustRover](https://www.jetbrains.com/rust/)

我们欢迎想要为本应用实现新功能或进行改进的同学提交 [Pull Request](https://github.com/belugaQAQ/StickyHomeworks2-tauri/pulls)

## 致谢

本项目基于原版 [StickyHomeworks2](https://github.com/StickyHomeworks2/StickyHomeworks2) 进行跨平台迁移开发。  
感谢原版项目及其贡献者为作业展示和管理场景提供的设计与实现基础。

## 许可证

本应用使用 ` GNU AGPL v3`许可协议
