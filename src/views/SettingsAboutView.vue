<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import packageJson from "../../package.json";
import SettingsPage from "../components/SettingsPage.vue";
import { EchoCave, type Echo } from "../services/echo-cave";
import { logError, logInfo } from "../services/logging";
import "../styles/settings-view.css";

type Typewriter = {
  deleteAll(speed?: number): Typewriter;
  typeString(text: string): Typewriter;
  start(): Typewriter;
  stop(): Typewriter;
};

const appVersion = ref(packageJson.version);
const echoCave = new EchoCave();
const typewriterElement = ref<HTMLElement | null>(null);
const sourceWriterElement = ref<HTMLElement | null>(null);
const echoLoading = ref(false);
const isContributorsDrawerOpen = ref(false);
const contributorsDrawerPage = ref<"contributors" | "libraries">("contributors");
let typewriter: Typewriter | null = null;
let sourceWriter: Typewriter | null = null;

function openContributorsPage(page: "contributors" | "libraries") {
  contributorsDrawerPage.value = page;
  isContributorsDrawerOpen.value = true;
}

function closeContributorsDrawer() {
  isContributorsDrawerOpen.value = false;
}

function syncContributorsDrawer(event: Event) {
  isContributorsDrawerOpen.value = Boolean((event.currentTarget as HTMLElement & { end?: boolean }).end);
}
onMounted(async () => {
  if (isTauri()) {
    try { appVersion.value = await getVersion(); } catch { /* 保留构建时版本 */ }
  }
  void logInfo("about.page.loaded", "关于页面已加载", undefined, {
    appVersion: appVersion.value,
  });
  const TypewriterClass = (await import("typewriter-effect/dist/core")).default;
  if (!typewriterElement.value || !sourceWriterElement.value) return;
  typewriter = new TypewriterClass(typewriterElement.value, { delay: 50, deleteSpeed: 100 });
  sourceWriter = new TypewriterClass(sourceWriterElement.value, { delay: 10, deleteSpeed: 10, cursor: "" });
  typeQuote("点击此处可以查看社区用户的发言", "点击后会显示下一条回声");
});

onBeforeUnmount(() => {
  typewriter?.stop();
  sourceWriter?.stop();
});

function typeQuote(text: string, source: string) {
  typewriter?.deleteAll(30).typeString(text).start();
  sourceWriter?.deleteAll(20).typeString(source).start();
}

async function showNextEcho() {
  if (echoLoading.value) return;
  echoLoading.value = true;
  try {
    const echo = await echoCave.nextEcho();
    typeQuote(echo?.text ?? "暂时没有可展示的回声，请稍后再试", echo ? `—— ${echo.user}` : "");
    void logInfo(echo ? "echo.display.success" : "echo.display.empty", echo ? "回声获取成功" : "回声列表为空", undefined, { hasEcho: Boolean(echo) });
    if (echo) await copyEcho(echo);
  } catch (error) {
    typeQuote("获取回声失败，请稍后再试", "");
    void logError("echo.display.failed", error);
  } finally {
    echoLoading.value = false;
  }
}

async function openExternal(url: string, operationOverride?: string) {
  const operation = operationOverride ?? (url.includes("github.com")
    ? "about.github.open"
    : url.includes("opensource.org")
      ? "about.license.open"
      : url.includes("qm.qq.com")
        ? "about.qq-group.open"
        : url.includes("ifdian.net")
          ? "about.sponsor.open"
          : "about.external.open");
  try {
    if (isTauri()) {
      await openUrl(url);
      void logInfo(operation, "外部链接已打开", undefined, { url });
      return;
    }
    if (!window.open(url, "_blank", "noopener,noreferrer")) {
      throw new Error("浏览器阻止了外部窗口");
    }
    void logInfo(operation, "外部链接已请求打开", undefined, { url });
  } catch (error) {
    void logError(`${operation}.failed`, error, undefined, { url });
  }
}

async function copyEcho(echo: Echo) {
  try {
    await writeText(`${echo.text}\n—— ${echo.user}`);
    void logInfo("echo.copy.success", "回声已复制", undefined, { user: echo.user });
  } catch (error) {
    void logError("echo.copy.failed", error);
  }
}
</script>

<template>
  <SettingsPage title="关于" heading-id="settings-about-title" show-back>
    <section class="settings-about" aria-labelledby="settings-about-intro-title">
      <m3e-card variant="outlined" class="settings-about__hero">
        <div slot="content" class="settings-about__hero-content">
          <div class="settings-about__icon" aria-hidden="true"><m3e-icon name="sticky_note_2"></m3e-icon></div>
          <div>
            <div class="settings-about__title-row">
              <m3e-heading id="settings-about-intro-title" variant="headline" size="small" level="2">StickyHomeworks2 · N</m3e-heading>
              <m3e-chip variant="outlined">v{{ appVersion }}</m3e-chip>
            </div>
            <p>跨平台作业记录工具</p>
          </div>
        </div>
      </m3e-card>
      <section class="settings-group settings-about__group" aria-labelledby="settings-about-description-title">
        <m3e-heading id="settings-about-description-title" variant="title" size="large" level="2">简介</m3e-heading>
        <p class="settings-about__description">Stickyhomeworks2 · N 是一款跨平台作业记录工具，帮助你按科目整理作业、跟踪截止日期，并快速查看即将到期和已经过期的任务。</p>
      </section>
      <section class="settings-group settings-about__group" aria-labelledby="settings-about-acknowledgements-title">
        <m3e-heading id="settings-about-acknowledgements-title" variant="title" size="large" level="2">鸣谢</m3e-heading>
        <m3e-action-list variant="segmented" class="settings-about__links-list">
          <m3e-list-action @click="openContributorsPage('contributors')">
            <m3e-icon slot="leading" name="group"></m3e-icon>贡献人员
            <span slot="supporting-text">查看项目贡献人员</span><m3e-icon slot="trailing" name="chevron_right"></m3e-icon>
          </m3e-list-action>
          <m3e-list-action @click="openContributorsPage('libraries')">
            <m3e-icon slot="leading" name="library_books"></m3e-icon>第三方库
            <span slot="supporting-text">查看项目使用的第三方开源库</span><m3e-icon slot="trailing" name="chevron_right"></m3e-icon>
          </m3e-list-action>
        </m3e-action-list>
      </section>
      <section class="settings-group settings-about__group" aria-labelledby="settings-about-links-title">
        <m3e-heading id="settings-about-links-title" variant="title" size="large" level="2">相关链接</m3e-heading>
        <m3e-action-list variant="segmented" class="settings-about__links-list">
          <m3e-list-action @click="openExternal('https://github.com/belugaQAQ/StickyHomeworks2-tauri')"><m3e-icon slot="leading" name="code"></m3e-icon>GitHub 项目<span slot="supporting-text">查看源代码与项目说明</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://opensource.org/license/mit')"><m3e-icon slot="leading" name="description"></m3e-icon>MIT License<span slot="supporting-text">查看项目许可证</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://qm.qq.com/q/2VUfjJuVq8')"><m3e-icon slot="leading" name="chat"></m3e-icon>加入QQ群<span slot="supporting-text">与开发者和其他人一起交流</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://ifdian.net/a/classisband')"><m3e-icon slot="leading" name="favorite" filled class="settings-about__sponsor-icon"></m3e-icon>为爱发电<span slot="supporting-text">帮助创作者们更好的开发与创作</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
        </m3e-action-list>
      </section>
      <section class="settings-group settings-about__group" aria-labelledby="settings-about-echo-title">
        <m3e-heading id="settings-about-echo-title" variant="title" size="large" level="2">回声洞</m3e-heading>
        <m3e-card variant="outlined" class="settings-about__echo" role="button" tabindex="0" :aria-busy="echoLoading" @click="showNextEcho" @keydown.enter="showNextEcho" @keydown.space.prevent="showNextEcho">
          <div slot="content" class="settings-about__echo-content" aria-live="polite"><p ref="typewriterElement" class="settings-about__echo-text"></p><p ref="sourceWriterElement" class="settings-about__echo-user"></p></div>
        </m3e-card>
      </section>
      <p class="settings-about__footer">感谢大家有史以来对StickyHomeworks2项目的支持  Orz</p>
    </section>
  </SettingsPage>
  <Teleport to="body">
    <m3e-drawer-container
      class="settings-about__contributors-drawer"
      :end="isContributorsDrawerOpen"
      end-mode="over"
      @change="syncContributorsDrawer"
    >
      <div slot="end" class="settings-about__contributors-panel" aria-labelledby="contributors-drawer-title">
        <div class="settings-about__contributors-header">
          <m3e-heading id="contributors-drawer-title" variant="title" size="large" level="2">
            {{ contributorsDrawerPage === "contributors" ? "贡献人员" : "第三方库" }}
          </m3e-heading>
          <m3e-icon-button aria-label="关闭" title="关闭" @click="closeContributorsDrawer"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
        </div>
        <m3e-list v-if="contributorsDrawerPage === 'contributors'" variant="segmented">
          <m3e-list-action @click="openExternal('https://github.com/belugaQAQ')"><m3e-avatar slot="leading" aria-label="ClassIsBand 的头像"><img src="/ClassIsBand.jpeg" alt="" /></m3e-avatar>ClassIsBand<span slot="supporting-text">主开发者，屎山创建者</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://github.com/liuyuhengNB')"><m3e-avatar slot="leading" aria-label="liuyuhengNB 的头像"><img src="/liuyuhengNB.png" alt="" /></m3e-avatar>liuyuhengNB<span slot="supporting-text">移动端 BUG 测试者</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://github.com/CTL-XG')"><m3e-avatar slot="leading" aria-label="CTL-XG 的头像"><img src="/CTL-XG.jpg" alt="" /></m3e-avatar>CTL-XG<span slot="supporting-text">iOS 端测试者，移动端维护者</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://github.com/jizilin6732')"><m3e-avatar slot="leading" aria-label="jizilin6732 的头像"><img src="/jizilin6732.png" alt="" /></m3e-avatar>jizilin6732<span slot="supporting-text">吉祥物</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
        </m3e-list>
        <m3e-list v-else variant="segmented">
          <m3e-list-action @click="openExternal('https://vuejs.org/', 'about.library.vue.open')"><m3e-icon slot="leading" name="code"></m3e-icon>Vue<span slot="supporting-text">渐进式 JavaScript 框架</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://www.typescriptlang.org/', 'about.library.typescript.open')"><m3e-icon slot="leading" name="code"></m3e-icon>TypeScript<span slot="supporting-text">JavaScript 的类型化超集</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://tiptap.dev/', 'about.library.tiptap.open')"><m3e-icon slot="leading" name="edit"></m3e-icon>Tiptap<span slot="supporting-text">富文本编辑器框架</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://tauri.app/', 'about.library.tauri.open')"><m3e-icon slot="leading" name="desktop_windows"></m3e-icon>Tauri<span slot="supporting-text">跨平台桌面应用框架</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
          <m3e-list-action @click="openExternal('https://github.com/typewriter-effect/typewriter-effect', 'about.library.typewriter.open')"><m3e-icon slot="leading" name="text_fields"></m3e-icon>Typewriter Effect<span slot="supporting-text">文字动画库</span><m3e-icon slot="trailing" name="open_in_new"></m3e-icon></m3e-list-action>
        </m3e-list>
      </div>
    </m3e-drawer-container>
  </Teleport>
</template>
