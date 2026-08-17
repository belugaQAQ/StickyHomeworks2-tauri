<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { openExternalHomeworkLink } from "../services/external-link";
import { hideWebKitGtkDialog, useWebKitGtkDialogExit } from "../composables/useWebKitGtkDialogExit";
type DialogElement = HTMLElement & {
  show: () => void | Promise<void>;
  hide: () => void | Promise<void>;
};

const emit = defineEmits<{
  opened: [href: string];
  cancelled: [];
  failed: [error: unknown, href: string];
}>();

const dialog = ref<DialogElement | null>(null);
const href = ref("");
const linkText = ref("");
const closingForExternal = ref(false);
let closePromise: Promise<void> | null = null;
useWebKitGtkDialogExit(dialog);

function clearContent() {
  href.value = "";
  linkText.value = "";
}

async function closeAndClear() {
  if (!closePromise) {
    closePromise = hideWebKitGtkDialog(dialog.value)
      .then(clearContent)
      .finally(() => { closePromise = null; });
  }
  await closePromise;
}

function open(value: string, text = "") {
  closingForExternal.value = false;
  href.value = value;
  linkText.value = text;
  void dialog.value?.show();
}

function cancel() {
  closingForExternal.value = false;
  void closeAndClear().then(() => emit("cancelled"));
}

async function confirm() {
  const value = href.value;
  closingForExternal.value = true;
  await closeAndClear();
  closingForExternal.value = false;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    await openExternalHomeworkLink(value);
    emit("opened", value);
  } catch (error) {
    emit("failed", error, value);
    M3eSnackbar.open(error instanceof Error ? error.message : "链接打开失败，请重试。");
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible" && closingForExternal.value) void closeAndClear();
}

onMounted(() => document.addEventListener("visibilitychange", handleVisibilityChange));
onBeforeUnmount(() => document.removeEventListener("visibilitychange", handleVisibilityChange));

defineExpose({ open, cancel });
</script>

<template>
  <m3e-dialog ref="dialog" class="homework-link-confirm-dialog" alert dismissible>
    <span slot="header">在浏览器中打开此链接？</span>
    <div class="homework-link-confirm-content">
      <p>链接将交给系统默认浏览器处理，请确认地址可信后再继续。</p>
      <m3e-card variant="filled">
        <div slot="content" class="homework-link-confirm-preview">
          <m3e-heading v-if="linkText" variant="headline" size="small" emphasized>{{ linkText }}</m3e-heading>
          <span class="homework-link-confirm-value" tabindex="0">{{ href }}</span>
        </div>
      </m3e-card>
    </div>
    <div slot="actions" end>
      <m3e-button variant="text" @click="cancel">取消</m3e-button>
      <m3e-button variant="filled" @click="confirm">打开</m3e-button>
    </div>
  </m3e-dialog>
</template>
