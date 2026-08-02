import { invoke } from "@tauri-apps/api/core";
import { onBeforeUnmount, onMounted, type Ref } from "vue";

type M3eDialogElement = HTMLElement & {
  hide: () => void | Promise<void>;
};

const exitClass = "webkitgtk-dialog-exiting";
const exitDurationMs = 150;
const exitFallbackMs = exitDurationMs + 100;

const exitStyles = `
  @keyframes webkitgtk-m3e-dialog-exit {
    from { opacity: 1; transform: translateY(0) scaleY(1); }
    to { opacity: 0; transform: translateY(-3.125rem) scaleY(0.8); }
  }

  @keyframes webkitgtk-m3e-dialog-backdrop-exit {
    from { background-color: color-mix(in srgb, var(--m3e-dialog-scrim-color, #000) var(--m3e-dialog-scrim-opacity, 32%), transparent); }
    to { background-color: color-mix(in srgb, var(--m3e-dialog-scrim-color, #000) 0%, transparent); }
  }

  .base.${exitClass} {
    animation: webkitgtk-m3e-dialog-exit var(--md-sys-motion-duration-short-3, 150ms) var(--md-sys-motion-easing-emphasized, cubic-bezier(0.2, 0, 0, 1)) forwards;
    pointer-events: none;
    transition: none !important;
  }

  .base.${exitClass}::backdrop {
    animation: webkitgtk-m3e-dialog-backdrop-exit var(--md-sys-motion-duration-short-3, 150ms) var(--md-sys-motion-easing-standard, cubic-bezier(0.2, 0, 0, 1)) forwards;
    transition: none !important;
  }
`;

/**
 * WebKitGTK cannot reliably animate a native modal dialog after close() removes it
 * from the top layer. Keep it open for a local keyframe animation, then let M3E close it.
 */
export function useWebKitGtkDialogExit(dialog: Ref<M3eDialogElement | null>) {
  let enabled = false;
  let exitInProgress = false;
  let finalizing = false;
  let fallbackTimer = 0;

  function ensureExitStyles(root: ShadowRoot) {
    if (root.querySelector("style[data-webkitgtk-dialog-exit]")) return;

    const style = document.createElement("style");
    style.dataset.webkitgtkDialogExit = "";
    style.textContent = exitStyles;
    root.append(style);
  }

  function handleClosing(event: Event) {
    if (!enabled || finalizing) return;

    event.preventDefault();
    if (exitInProgress) return;

    const host = dialog.value;
    const base = host?.shadowRoot?.querySelector<HTMLDialogElement>(".base");
    if (!host || !base?.open) return;

    exitInProgress = true;
    ensureExitStyles(host.shadowRoot!);
    base.classList.add(exitClass);

    const finish = () => {
      window.clearTimeout(fallbackTimer);
      base.removeEventListener("animationend", finish);
      base.classList.remove(exitClass);
      // Keep the final visual state through M3E's immediate native close() call.
      base.style.opacity = "0";
      base.style.transform = "translateY(-3.125rem) scaleY(0.8)";
      finalizing = true;

      void Promise.resolve(host.hide()).finally(() => {
        base.style.removeProperty("opacity");
        base.style.removeProperty("transform");
        finalizing = false;
        exitInProgress = false;
      });
    };

    base.addEventListener("animationend", finish, { once: true });
    fallbackTimer = window.setTimeout(finish, exitFallbackMs);
  }

  onMounted(async () => {
    try {
      enabled = await invoke<boolean>("webkitgtk_dialog_exit_workaround_required");
    } catch {
      enabled = false;
    }
    dialog.value?.addEventListener("closing", handleClosing);
  });

  onBeforeUnmount(() => {
    window.clearTimeout(fallbackTimer);
    dialog.value?.removeEventListener("closing", handleClosing);
  });
}
