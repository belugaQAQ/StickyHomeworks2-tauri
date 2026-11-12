/**
 * 生成 Microsoft Store 用的 MSIX 包。
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tauriConfigPath = join(projectRoot, "src-tauri", "tauri.conf.json");
const iconsDirectory = join(projectRoot, "src-tauri", "icons");
const msixDirectory = join(projectRoot, "src-tauri", "target", "msix");
const stagingDirectory = join(msixDirectory, "staging");
const IDENTITY = {
  name: process.env.MSIX_IDENTITY_NAME ?? "ClassIsBand.StickyHomeworks2N",
  publisher: process.env.MSIX_PUBLISHER ?? "CN=F1786C92-9F40-494B-B8C6-4EF550A70AD7",
  publisherDisplayName: process.env.MSIX_PUBLISHER_DISPLAY_NAME ?? "ClassIsBand",
  displayName: process.env.MSIX_DISPLAY_NAME ?? "StickyHomeworks2 · N",
  shortName: process.env.MSIX_SHORT_NAME ?? "SH2·N",
};

const MAX_VERSION_SEGMENT = 65535;

const MSIX_ICON_FILES = [
  "StoreLogo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square150x150Logo.png",
  "Square310x310Logo.png",
];
const OPTIONAL_TILE_ICON = "Wide310x150Logo.png";

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(message);
}

/**
 * Tauri 的版本是三段，MSIX 必须是四段。
 * 预发布后缀（`0.1.0-beta.1`）在 MSIX 版本里没有位置，这里只取数字主干。
 */
function toMsixVersion(tauriVersion) {
  const core = tauriVersion.split(/[-+]/)[0];
  const segments = core.split(".").map((segment) => Number(segment));

  if (segments.length < 3 || segments.some((value) => !Number.isInteger(value) || value < 0)) {
    fail(`无法把版本号 ${JSON.stringify(tauriVersion)} 转成 MSIX 的 4 段格式，请检查 tauri.conf.json`);
  }

  const normalized = [segments[0], segments[1], segments[2], segments[3] ?? 0];
  if (normalized.some((value) => value > MAX_VERSION_SEGMENT)) {
    fail(`版本号 ${tauriVersion} 有一段超过 ${MAX_VERSION_SEGMENT}，MSIX 不接受`);
  }
  return normalized.join(".");
}

function resolveSdkTool(toolName) {
  const binRoot = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!existsSync(binRoot)) {
    fail(`找不到 Windows SDK（${binRoot} 不存在）。MSIX 打包需要它提供 ${toolName}。`);
  }

  const candidates = readdirSync(binRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const a = left.split(".").map(Number);
      const b = right.split(".").map(Number);
      for (let index = 0; index < 4; index += 1) {
        if (a[index] !== b[index]) return b[index] - a[index];
      }
      return 0;
    });

  const toolPath = candidates.map((version) => join(binRoot, version, "x64", toolName)).find(existsSync);
  if (!toolPath) fail(`在 Windows SDK 里找不到 ${toolName}，请确认安装了 "Windows SDK for Desktop C++ x64 Apps"。`);
  return toolPath;
}

function runTool(executable, args, label) {
  info(`\n▸ ${label}`);
  const result = spawnSync(executable, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error) fail(`${label} 无法启动：${result.error.message}`);
  if (result.status !== 0) fail(`${label} 失败（退出码 ${result.status}）`);
}

function buildManifest(version, architecture, hasWideTile) {
  const tileAttributes = hasWideTile
    ? `
          Wide310x150Logo="Assets\\${OPTIONAL_TILE_ICON}"
          Square310x310Logo="Assets\\Square310x310Logo.png"
          ShortName="${IDENTITY.shortName}"`
    : `
          ShortName="${IDENTITY.shortName}"`;

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- 由 scripts/msix.mjs 生成，不要手改；改脚本或 Identity 常量。 -->
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="${IDENTITY.name}"
    Publisher="${IDENTITY.publisher}"
    Version="${version}"
    ProcessorArchitecture="${architecture}" />

  <Properties>
    <DisplayName>${IDENTITY.displayName}</DisplayName>
    <PublisherDisplayName>${IDENTITY.publisherDisplayName}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily
      Name="Windows.Desktop"
      MinVersion="10.0.17763.0"
      MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Resources>
    <Resource Language="zh-CN" />
  </Resources>

  <Applications>
    <Application
      Id="App"
      Executable="stickyhomeworks2.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${IDENTITY.displayName}"
        Description="跨平台作业记录工具"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile${tileAttributes} />
      </uap:VisualElements>
    </Application>
  </Applications>

  <Capabilities>
    <!-- Win32 桌面应用转 MSIX 的标准做法：以完整信任运行，不受 UWP 沙箱限制 -->
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

const RUST_TRIPLES = {
  x64: "x86_64-pc-windows-msvc",
  arm64: "aarch64-pc-windows-msvc",
  x86: "i686-pc-windows-msvc",
};

function prepareStaging(architecture) {
  const triple = RUST_TRIPLES[architecture];
  if (!triple) fail(`不支持的架构 ${architecture}，可选：${Object.keys(RUST_TRIPLES).join(" / ")}`);
  const targetRoot = join(projectRoot, "src-tauri", "target");
  const executableCandidates = [
    join(targetRoot, triple, "release", "stickyhomeworks2.exe"),
    join(targetRoot, "release", "stickyhomeworks2.exe"),
  ];
  const sourceExecutable = executableCandidates.find(existsSync);
  if (!sourceExecutable) {
    fail(
      `找不到 release 产物，请先运行 \`npm run tauri -- build --no-bundle\`。查找过：\n  ${executableCandidates.join("\n  ")}`,
    );
  }

  rmSync(stagingDirectory, { recursive: true, force: true });
  mkdirSync(join(stagingDirectory, "Assets"), { recursive: true });
  cpSync(sourceExecutable, join(stagingDirectory, "stickyhomeworks2.exe"));

  for (const icon of MSIX_ICON_FILES) {
    const iconPath = join(iconsDirectory, icon);
    if (!existsSync(iconPath)) fail(`缺少图标 ${icon}，请先运行 \`npm run tauri -- icon\` 或手动补齐 src-tauri/icons。`);
    cpSync(iconPath, join(stagingDirectory, "Assets", icon));
  }

  const wideTileSource = join(iconsDirectory, OPTIONAL_TILE_ICON);
  const hasWideTile = existsSync(wideTileSource);
  if (hasWideTile) cpSync(wideTileSource, join(stagingDirectory, "Assets", OPTIONAL_TILE_ICON));

  return { sourceExecutable, hasWideTile };
}

function resolveSigningThumbprint() {
  const thumbprint = process.env.MSIX_CERT_THUMBPRINT;
  if (!thumbprint) {
    fail(
      "用了 --sign 但没有给证书。请设置 MSIX_CERT_THUMBPRINT 环境变量（本地测试证书的 SHA1 指纹）。\n" +
        "  证书 Subject 必须逐字等于 Identity 的 Publisher，否则装不上。",
    );
  }
  return thumbprint.replace(/\s/g, "");
}

function main() {
  const wantsSignature = process.argv.includes("--sign");

  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const version = toMsixVersion(tauriConfig.version);
  const architecture = process.env.MSIX_ARCH ?? "x64";

  info("MSIX 打包");
  info(`  Identity : ${IDENTITY.name}`);
  info(`  Publisher: ${IDENTITY.publisher}`);
  info(`  Version  : ${version}（由 ${tauriConfig.version} 推导）`);
  info(`  架构     : ${architecture}`);
  info(`  签名     : ${wantsSignature ? "是（本地测试，不可提交 Store）" : "否（可直接提交 Store）"}`);

  const { sourceExecutable, hasWideTile } = prepareStaging(architecture);
  info(`\n  产物来源 : ${sourceExecutable}`);
  if (!hasWideTile) info("  宽磁贴   : 未提供 Wide310x150Logo.png，已省略 310 磁贴");

  writeFileSync(join(stagingDirectory, "AppxManifest.xml"), buildManifest(version, architecture, hasWideTile), "utf8");

  mkdirSync(msixDirectory, { recursive: true });
  const outputPath = join(msixDirectory, `stickyhomeworks2_${version}_${architecture}.msix`);
  rmSync(outputPath, { force: true });

  // 打印出来是为了 CI 排查：不同机器装着的 SDK 版本不一样。
  const makeappx = resolveSdkTool("makeappx.exe");
  info(`\n  makeappx : ${makeappx}`);
  runTool(makeappx, ["pack", "/d", stagingDirectory, "/p", outputPath, "/o"], "makeappx pack");

  if (wantsSignature) {
    const thumbprint = resolveSigningThumbprint();
    runTool(
      resolveSdkTool("signtool.exe"),
      ["sign", "/fd", "SHA256", "/sha1", thumbprint, "/d", IDENTITY.displayName, outputPath],
      "signtool sign",
    );
  }

  const sizeMb = (statSync(outputPath).size / (1024 * 1024)).toFixed(1);
  info(`\n✔ 完成：${outputPath}`);
  info(`  大小：${sizeMb} MB`);
  if (!wantsSignature) info("  包里没有签名，符合 Store 提交要求。");
  info(`  本地安装验证（自签证书需要先导入 LocalMachine\\TrustedPeople）：`);
  info(`    Add-AppxPackage -Path "${outputPath}"`);
}

main();
