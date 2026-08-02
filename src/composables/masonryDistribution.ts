export type MasonryItem = {
  key: string;
  height: number;
};

export type MasonryDistribution<T extends MasonryItem> = {
  columns: T[][];
  columnByKey: Map<string, number>;
};

/**
 * Mirrors the finite-height path of the original WPF MasonryPanel.
 * Items stay in their prior column when it still fits; otherwise the
 * shortest fitting column wins, and a new column is appended only when needed.
 */
export function distributeMasonry<T extends MasonryItem>(
  items: readonly T[],
  maxHeight: number,
  gap: number,
  previousColumns = new Map<string, number>(),
): MasonryDistribution<T> {
  const columns: T[][] = [];
  const columnHeights: number[] = [];
  const columnByKey = new Map<string, number>();

  for (const item of items) {
    const previousColumn = previousColumns.get(item.key);
    let column = canFitInColumn(columns, columnHeights, previousColumn, item.height, maxHeight, gap)
      ? previousColumn!
      : findShortestFittingColumn(columns, columnHeights, item.height, maxHeight, gap);

    if (column === -1) {
      column = columns.length;
      columns.push([]);
      columnHeights.push(0);
    }

    const columnGap = columns[column].length === 0 ? 0 : gap;
    columns[column].push(item);
    columnHeights[column] += columnGap + item.height;
    columnByKey.set(item.key, column);
  }

  return { columns, columnByKey };
}

function canFitInColumn(
  columns: readonly MasonryItem[][],
  columnHeights: readonly number[],
  column: number | undefined,
  itemHeight: number,
  maxHeight: number,
  gap: number,
) {
  if (column === undefined || column < 0 || column >= columns.length) return false;

  return columnHeights[column] + (columns[column].length === 0 ? 0 : gap) + itemHeight <= maxHeight;
}

function findShortestFittingColumn(
  columns: readonly MasonryItem[][],
  columnHeights: readonly number[],
  itemHeight: number,
  maxHeight: number,
  gap: number,
) {
  let result = -1;
  let shortestHeight = Number.POSITIVE_INFINITY;

  for (let index = 0; index < columns.length; index += 1) {
    const nextHeight = columnHeights[index] + (columns[index].length === 0 ? 0 : gap) + itemHeight;
    if (nextHeight <= maxHeight && columnHeights[index] < shortestHeight) {
      result = index;
      shortestHeight = columnHeights[index];
    }
  }

  return result;
}
