import { ref } from "vue";
import { createRouter, createWebHashHistory, type RouteLocationNormalizedLoaded } from "vue-router";
import HomeworksView from "./views/HomeworksView.vue";
import SettingsBoardView from "./views/SettingsBoardView.vue";
import SettingsExpiryView from "./views/SettingsExpiryView.vue";
import SettingsGeneralView from "./views/SettingsGeneralView.vue";
import SettingsImportView from "./views/SettingsImportView.vue";
import SettingsIndexView from "./views/SettingsIndexView.vue";
import SettingsVocabularyView from "./views/SettingsVocabularyView.vue";
import TemplatesView from "./views/TemplatesView.vue";

export type RouteTransitionName = "route-fade" | "settings-forward" | "settings-back";

declare module "vue-router" {
  interface RouteMeta {
    settingsDepth?: number;
  }
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "homeworks", component: HomeworksView },
    { path: "/templates", name: "templates", component: TemplatesView },
    { path: "/settings", name: "settings", component: SettingsIndexView, meta: { settingsDepth: 0 } },
    { path: "/settings/general", name: "settings-general", component: SettingsGeneralView, meta: { settingsDepth: 1 } },
    { path: "/settings/import", name: "settings-import", component: SettingsImportView, meta: { settingsDepth: 1 } },
    { path: "/settings/vocabulary", name: "settings-vocabulary", component: SettingsVocabularyView, meta: { settingsDepth: 1 } },
    { path: "/settings/expiry", name: "settings-expiry", component: SettingsExpiryView, meta: { settingsDepth: 1 } },
    { path: "/settings/board", name: "settings-board", component: SettingsBoardView, meta: { settingsDepth: 1 } },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

export const routeTransitionName = ref<RouteTransitionName>("route-fade");

router.afterEach((to, from) => {
  routeTransitionName.value = resolveRouteTransition(from, to);
});

function resolveRouteTransition(from: RouteLocationNormalizedLoaded, to: RouteLocationNormalizedLoaded): RouteTransitionName {
  const fromDepth = from.meta.settingsDepth;
  const toDepth = to.meta.settingsDepth;

  if (fromDepth === 0 && toDepth === 1) return "settings-forward";
  if (fromDepth === 1 && toDepth === 0) return "settings-back";
  return "route-fade";
}
