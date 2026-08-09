import { logWarn } from "./logging";

const ECHOES_URL = "https://api.classisband.xyz/api/echoes";

export type Echo = {
  text: string;
  user: string;
};

export class EchoCave {
  private queue: Echo[] = [];

  async nextEcho(): Promise<Echo | null> {
    if (this.queue.length === 0) {
      this.queue = await this.loadQueue();
    }
    return this.queue.shift() ?? null;
  }

  private async loadQueue(): Promise<Echo[]> {
    try {
      const response = await fetch(ECHOES_URL, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value: unknown = await response.json();
      if (!Array.isArray(value)) throw new Error("响应不是回声数组");
      return shuffle(value.flatMap(normalizeEcho));
    } catch (error) {
      await logWarn("echo.fetch.failed", "获取回声洞内容失败", undefined, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
function normalizeEcho(value: unknown): Echo[] {
  if (typeof value !== "object" || value === null) return [];
  const item = value as { text?: unknown; user?: unknown };
  if (typeof item.text !== "string" || item.text.trim() === "") return [];
  return [{ text: item.text.trim(), user: typeof item.user === "string" ? item.user.trim() : "匿名用户" }];
}

function shuffle(items: Echo[]): Echo[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
