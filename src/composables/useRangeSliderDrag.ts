import { onScopeDispose } from "vue";

export type RangeSliderValueResolver = (event: PointerEvent, rect: DOMRect) => number;

export interface UseRangeSliderDragOptions {
  /** 返回滑块宿主元素（用于坐标换算与指针捕获）。 */
  slider: () => HTMLElement | null;
  /** 根据指针位置与滑块矩形换算滑块数值。 */
  resolveValue: RangeSliderValueResolver;
  /** 拖动过程中的预览回调，不应落盘。 */
  onPreview: (value: number) => void;
  /** 指针释放后的提交回调，负责落盘。 */
  onCommit: (value: number) => void;
}

export interface RangeSliderDrag {
  /** 绑定到滑块宿主的 `pointerdown`。 */
  onPointerDown: (event: PointerEvent) => void;
}

type ActiveDrag = {
  slider: HTMLElement;
  pointerId: number;
  lastValue: number;
};

export function useRangeSliderDrag(options: UseRangeSliderDragOptions): RangeSliderDrag {
  let active: ActiveDrag | null = null;

  function readValue(event: PointerEvent, slider: HTMLElement): number {
    return options.resolveValue(event, slider.getBoundingClientRect());
  }

  function handleMove(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    const value = readValue(event, active.slider);
    active.lastValue = value;
    options.onPreview(value);
  }

  function finish(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    const drag = active;
    active = null;
    drag.slider.removeEventListener("pointermove", handleMove);
    drag.slider.removeEventListener("pointerup", finish);
    drag.slider.removeEventListener("pointercancel", finish);
    if (drag.slider.hasPointerCapture(drag.pointerId)) {
      drag.slider.releasePointerCapture(drag.pointerId);
    }
    options.onPreview(drag.lastValue);
    options.onCommit(drag.lastValue);
  }

  function cleanup(): void {
    if (!active) return;
    const drag = active;
    active = null;
    drag.slider.removeEventListener("pointermove", handleMove);
    drag.slider.removeEventListener("pointerup", finish);
    drag.slider.removeEventListener("pointercancel", finish);
    if (drag.slider.hasPointerCapture(drag.pointerId)) {
      drag.slider.releasePointerCapture(drag.pointerId);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const slider = options.slider();
    if (!slider) return;
    cleanup();
    event.preventDefault();
    const value = readValue(event, slider);
    active = { slider, pointerId: event.pointerId, lastValue: value };
    slider.setPointerCapture(event.pointerId);
    slider.addEventListener("pointermove", handleMove);
    slider.addEventListener("pointerup", finish);
    slider.addEventListener("pointercancel", finish);
    options.onPreview(value);
  }

  onScopeDispose(cleanup);

  return { onPointerDown };
}
