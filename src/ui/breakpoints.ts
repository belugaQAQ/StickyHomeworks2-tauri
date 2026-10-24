export const MOBILE_LAYOUT_MAX_WIDTH = 950;

/** 设置页左右分栏的最小宽度：低于该值时折叠为单栏。 */
export const SPLIT_LAYOUT_MIN_WIDTH = 700;

/** 设置页内容区舒适显示的最小宽度：低于该值时提示窗口空间不足。 */
export const SETTINGS_RIGHT_PANEL_MIN_WIDTH = 950;

/** 设置详情页的最小宽度：宽窗口下 `/settings` 索引直接跳转到详情页。 */
export const SETTINGS_DETAIL_MIN_WIDTH = 700;

export function isBelow(width: number, breakpoint: number): boolean {
  return width > 0 && width < breakpoint;
}

export function isAtLeast(width: number, breakpoint: number): boolean {
  return width > 0 && width >= breakpoint;
}
