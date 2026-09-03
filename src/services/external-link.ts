import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isSafeHomeworkLink } from "../utils/homework-content";

export async function openExternalHomeworkLink(href: string): Promise<void> {
  if (!isSafeHomeworkLink(href)) throw new Error("链接协议不受支持或地址无效。");
  if (isTauri()) {
    await openUrl(href);
    return;
  }
  if (!window.open(href, "_blank", "noopener,noreferrer")) {
    throw new Error("浏览器阻止了外部窗口。");
  }
}
