import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { onBeforeUnmount, onMounted, ref } from "vue";

export function useLinuxClipboardWorkaround() {
  const enabled = ref(false);

  function getCopiedText(target: EventTarget | null) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      return start === null || end === null ? "" : target.value.slice(start, end);
    }

    return document.getSelection()?.toString() ?? "";
  }

  function removeSelectedInputText(target: EventTarget | null) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start === null || end === null || start === end) return;

    target.setRangeText("", start, end, "start");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function copyThroughTauri(event: ClipboardEvent) {
    if (!enabled.value) return;

    const text = getCopiedText(event.target);
    if (!text) return;

    event.preventDefault();
    void writeText(text).catch((error: unknown) => {
      console.error("Failed to copy text through Tauri clipboard manager", error);
    });
  }

  function cutThroughTauri(event: ClipboardEvent) {
    if (!enabled.value) return;

    const text = getCopiedText(event.target);
    if (!text) return;

    event.preventDefault();
    void writeText(text)
      .then(() => removeSelectedInputText(event.target))
      .catch((error: unknown) => {
        console.error("Failed to cut text through Tauri clipboard manager", error);
      });
  }

  onMounted(async () => {
    try {
      enabled.value = await invoke<boolean>("clipboard_workaround_required");
    } catch {
      enabled.value = false;
    }
    document.addEventListener("copy", copyThroughTauri, true);
    document.addEventListener("cut", cutThroughTauri, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("copy", copyThroughTauri, true);
    document.removeEventListener("cut", cutThroughTauri, true);
  });
}
