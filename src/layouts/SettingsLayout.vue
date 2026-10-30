<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import "../styles/settings-view.css";
import { useAppContext } from "../app-context";
import { routeTransitionName } from "../router";
import { settingsSectionByPath, visibleSettingsSections } from "../settings/sections";
import { SETTINGS_RIGHT_PANEL_MIN_WIDTH, SPLIT_LAYOUT_MIN_WIDTH, isAtLeast, isBelow } from "../ui/breakpoints";

const router = useRouter();
const route = useRoute();
const { isMobileRuntime, settingsError } = useAppContext();
const viewportWidth = ref(0);

const activeSection = computed(() => settingsSectionByPath.get(route.path));
const isIndexRoute = computed(() => activeSection.value === undefined);
const pageTitle = computed(() => activeSection.value?.title ?? "设置");
const headingId = computed(() =>
  activeSection.value ? `settings-${activeSection.value.id}-title` : "settings-index-title",
);
const visibleSections = computed(() => visibleSettingsSections(isMobileRuntime.value));

const isNarrowSplitLayout = computed(
  () => !isIndexRoute.value && !isMobileRuntime.value && isBelow(viewportWidth.value, SPLIT_LAYOUT_MIN_WIDTH),
);

const isRightPanelInsufficient = computed(
  () =>
    !isIndexRoute.value &&
    !isMobileRuntime.value &&
    isAtLeast(viewportWidth.value, SPLIT_LAYOUT_MIN_WIDTH) &&
    isBelow(viewportWidth.value, SETTINGS_RIGHT_PANEL_MIN_WIDTH),
);

const isMobileNarrowLayout = computed(
  () => !isIndexRoute.value && isMobileRuntime.value && isBelow(viewportWidth.value, SETTINGS_RIGHT_PANEL_MIN_WIDTH),
);

const showBackButton = computed(() => !isIndexRoute.value && (isMobileNarrowLayout.value || isNarrowSplitLayout.value));

const transitionName = computed(() => routeTransitionName.value);
const transitionMode = computed<"out-in" | undefined>(() =>
  routeTransitionName.value === "settings-detail" ? undefined : "out-in",
);

function updateViewportWidth() {
  viewportWidth.value = window.innerWidth;
}

onMounted(() => {
  updateViewportWidth();
  window.addEventListener("resize", updateViewportWidth);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewportWidth);
});
</script>

<template>
  <section
    class="settings-page"
    :class="{
      'settings-page--split': !isIndexRoute,
      'settings-page--index': isIndexRoute,
      'settings-page--mobile': isMobileNarrowLayout,
      'settings-page--narrow': isNarrowSplitLayout,
    }"
  >
    <div class="settings-layout">
      <nav class="settings-layout__sidebar" aria-label="设置分类">
        <m3e-heading variant="title" size="large" level="2">设置</m3e-heading>
        <m3e-action-list variant="segmented" class="settings-navigation__list">
          <m3e-list-action
            v-for="section in visibleSections"
            :key="section.path"
            class="settings-navigation__item"
            :class="{ 'settings-navigation__item--active': route.path === section.path }"
            :href="`#${section.path}`"
            :aria-current="route.path === section.path ? 'page' : undefined"
          >
            <m3e-icon slot="leading" :name="section.icon"></m3e-icon>
            {{ section.title }}
            <span slot="supporting-text">{{ section.detail }}</span>
          </m3e-list-action>
        </m3e-action-list>
      </nav>
      <section class="settings-layout__content">
        <div class="settings-layout__content-inner">
          <header class="settings-page__header">
            <m3e-icon-button
              v-if="showBackButton"
              aria-label="返回设置"
              title="返回设置"
              @click="router.replace('/settings')"
            >
              <m3e-icon name="arrow_back"></m3e-icon>
            </m3e-icon-button>
            <m3e-heading :id="headingId" variant="headline" size="large" level="1">{{ pageTitle }}</m3e-heading>
          </header>
          <div class="settings-pane-host">
            <RouterView v-slot="{ Component }">
              <Transition :name="transitionName" :mode="transitionMode">
                <div :key="route.path" class="settings-pane">
                  <component :is="Component" />
                </div>
              </Transition>
            </RouterView>
          </div>
          <p v-if="settingsError" class="editor-error" role="alert">{{ settingsError }}</p>
        </div>
        <Teleport to="body">
          <Transition name="settings-insufficient">
            <div v-if="isRightPanelInsufficient" class="settings-insufficient-overlay" role="alert" aria-live="polite">
              <m3e-card variant="elevated" class="settings-insufficient-content">
                <div slot="header" class="settings-insufficient-header">
                  <m3e-heading class="settings-insufficient-title" variant="title" size="large" level="2"
                    >窗口空间不足</m3e-heading
                  >
                  <m3e-icon class="settings-insufficient-arrow" name="arrow_forward" aria-hidden="true"></m3e-icon>
                </div>
                <p slot="content" class="settings-insufficient-desc">
                  当前窗口宽度不足以舒适显示设置内容，请继续缩放窗口后使用。
                </p>
              </m3e-card>
            </div>
          </Transition>
        </Teleport>
      </section>
    </div>
  </section>
</template>
