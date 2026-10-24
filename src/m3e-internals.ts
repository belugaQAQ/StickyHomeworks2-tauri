type DialogElements = {
  host: HTMLElement;
  base: HTMLElement | null;
  content: HTMLElement | null;
};

function dialogElements(host: Element | null): DialogElements | null {
  if (!(host instanceof HTMLElement)) return null;
  const root = host.shadowRoot;
  if (!root) return null;
  return {
    host,
    base: root.querySelector<HTMLElement>(".base"),
    content: root.querySelector<HTMLElement>(".content"),
  };
}

export function prepareM3eDialog(host: Element | null): void {
  try {
    const elements = dialogElements(host);
    if (!elements) return;
    const { base, content } = elements;
    if (base) {
      const available = Math.min(window.innerHeight * 0.9, 720);
      base.style.maxHeight = `${Math.max(240, Math.round(available))}px`;
      base.style.display = "flex";
      base.style.flexDirection = "column";
    }
    if (content) {
      content.style.flex = "1 1 auto";
      content.style.minHeight = "0";
      content.style.overflowY = "auto";
    }
  } catch {
    // M3E 内部结构变化：静默退化，不阻断对话框本身。
  }
}

export function setDrawerContentOverflow(host: Element | null, axis: { x: string; y: string }): void {
  try {
    if (!(host instanceof HTMLElement)) return;
    const content = host.shadowRoot?.querySelector<HTMLElement>(".content");
    if (!content) return;
    content.style.overflowX = axis.x;
    content.style.overflowY = axis.y;
  } catch {
    // 忽略
  }
}

/**
 * Vue 对自定义元素可能只写 property，而 M3E 的 Shadow CSS 用属性选择器
 * （`[handle]`、`[detents]`），因此需要在挂载后补一次 attribute。
 */
export function patchM3eAttributes(element: Element | null, attributes: Record<string, string>): void {
  try {
    if (!(element instanceof HTMLElement)) return;
    for (const [name, value] of Object.entries(attributes)) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
  } catch {
    // 忽略
  }
}

/** 把 M3E 展开面板头从 Tab 序列里移除，避免焦点落到不可操作的标题上。 */
export function hideM3eExpansionHeaderFromTabOrder(host: Element | null): void {
  try {
    if (!(host instanceof HTMLElement)) return;
    const header = host.shadowRoot?.querySelector<HTMLElement>("m3e-expansion-header");
    if (header) header.tabIndex = -1;
  } catch {
    // 忽略
  }
}
