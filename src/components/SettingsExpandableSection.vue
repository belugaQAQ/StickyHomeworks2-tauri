<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { hideM3eExpansionHeaderFromTabOrder } from "../m3e-internals";
import "../styles/settings-view.css";

type ExpansionPanelElement = HTMLElement & { updateComplete: Promise<boolean> };

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const root = ref<HTMLElement | null>(null);

function preventExpansionToggle(event: Event) {
  const path = event.composedPath();
  const isPanelHeaderEvent = path.some(
    (node) => node instanceof HTMLElement && node.localName === "m3e-expansion-header",
  );
  const isSwitchEvent = path.some((node) => node instanceof HTMLElement && node.localName === "m3e-switch");
  if (isPanelHeaderEvent && !isSwitchEvent) event.stopPropagation();
}
function handleSwitchChange(event: Event) {
  const target = event.currentTarget as HTMLElement & { checked?: boolean };
  if (typeof target.checked === "boolean") emit("update:open", target.checked);
}

async function removePanelHeaderFromTabOrder() {
  await nextTick();
  const panel = root.value?.querySelector("m3e-expansion-panel") as ExpansionPanelElement | null;
  if (!panel) return;
  await panel.updateComplete;
  // Shadow DOM 访问统一走 m3e-internals（结构变化时静默退化，不阻断设置页）。
  hideM3eExpansionHeaderFromTabOrder(panel);
}

onMounted(() => void removePanelHeaderFromTabOrder());
</script>

<template>
  <div
    ref="root"
    class="settings-expandable-section"
    @click.capture="preventExpansionToggle"
    @keydown.capture="preventExpansionToggle"
  >
    <m3e-expansion-panel class="settings-expiry-panel" hide-toggle :open="props.open">
      <div class="settings-expiry-panel__header" slot="header" @click.stop @keydown.stop>
        <span class="settings-expiry-panel__title"><slot name="title"></slot></span>
        <small><slot name="description"></slot></small>
        <m3e-switch
          aria-label="切换展开状态"
          icons="selected"
          :checked="props.open"
          @click.stop
          @keydown.stop
          @change="handleSwitchChange"
        ></m3e-switch>
      </div>
      <slot></slot>
    </m3e-expansion-panel>
  </div>
</template>
