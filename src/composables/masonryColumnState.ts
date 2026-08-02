export type MasonryColumnGroup = {
  name: string;
};

export function hasSameMasonryColumns(
  current: readonly MasonryColumnGroup[][],
  next: readonly MasonryColumnGroup[][],
) {
  return current.length === next.length
    && current.every((column, columnIndex) => column.length === next[columnIndex].length
      && column.every((group, groupIndex) => group.name === next[columnIndex][groupIndex].name));
}

export function shouldRefreshMasonryColumns(
  current: readonly MasonryColumnGroup[][],
  next: readonly MasonryColumnGroup[][],
) {
  if (!hasSameMasonryColumns(current, next)) return true;

  return current.some((column, columnIndex) =>
    column.some((group, groupIndex) => group !== next[columnIndex][groupIndex]));
}
