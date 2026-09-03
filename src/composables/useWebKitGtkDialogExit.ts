import { invoke } from "@tauri-apps/api/core";
import { onBeforeUnmount, onMounted, type Ref } from "vue";

type M3eDialogElement = { hide: () => void | Promise<void> };
type DialogRefElement = HTMLElement & M3eDialogElement;
type ExitState = { enabled: boolean; resolve: (() => void) | null };
const exitStates = new WeakMap<M3eDialogElement, ExitState>();

export async function hideWebKitGtkDialog(dialog: M3eDialogElement | null | undefined): Promise<void> {
  if (!dialog) return;
  const state = exitStates.get(dialog);
  if (!state || !state.enabled) {
    await dialog.hide();
    return;
  }
  await new Promise<void>((resolve) => {
    state.resolve = resolve;
    void Promise.resolve(dialog.hide()).catch(resolve);
  });
}

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
  .base.${exitClass} { animation: webkitgtk-m3e-dialog-exit var(--md-sys-motion-duration-short-3, 150ms) var(--md-sys-motion-easing-emphasized, cubic-bezier(0.2, 0, 0, 1)) forwards; pointer-events: none; transition: none !important; }
  .base.${exitClass}::backdrop { animation: webkitgtk-m3e-dialog-backdrop-exit var(--md-sys-motion-duration-short-3, 150ms) var(--md-sys-motion-easing-standard, cubic-bezier(0.2, 0, 0, 1)) forwards; transition: none !important; }
`;

export function useWebKitGtkDialogExit(dialog: Ref<DialogRefElement | null>) {
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
      base.style.opacity = "0";
      base.style.transform = "translateY(-3.125rem) scaleY(0.8)";
      finalizing = true;
      void Promise.resolve(host.hide()).finally(() => {
        base.style.removeProperty("opacity");
        base.style.removeProperty("transform");
        finalizing = false;
        exitInProgress = false;
        exitStates.get(host)?.resolve?.();
        if (exitStates.has(host)) exitStates.get(host)!.resolve = null;
      });
    };
    base.addEventListener("animationend", finish, { once: true });
    fallbackTimer = window.setTimeout(finish, exitFallbackMs);
  }
  onMounted(async () => {
    const host = dialog.value;
    if (host) exitStates.set(host, { enabled: false, resolve: null });
    try { enabled = await invoke<boolean>("webkitgtk_dialog_exit_workaround_required"); } catch { enabled = false; }
    if (host) exitStates.get(host)!.enabled = enabled;
    dialog.value?.addEventListener("closing", handleClosing);
  });
  onBeforeUnmount(() => {
    window.clearTimeout(fallbackTimer);
    dialog.value?.removeEventListener("closing", handleClosing);
    if (dialog.value) exitStates.delete(dialog.value);
  });
}
