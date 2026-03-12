import { useState, useMemo } from 'react';
import type { SortDescriptor } from '@nextui-org/react';

type SortValueExtractor<T> = (item: T, columnKey: string) => string | number | null;

export function useNodeSort<T>(items: T[], extractSortValue: SortValueExtractor<T>) {
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({} as SortDescriptor);

  const sortedItems = useMemo(() => {
    if (!sortDescriptor.column) return items;

    const col = String(sortDescriptor.column);
    const dir = sortDescriptor.direction === 'descending' ? -1 : 1;

    return [...items].sort((a, b) => {
      const valA = extractSortValue(a, col);
      const valB = extractSortValue(b, col);

      // nulls last
      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      let cmp: number;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
      }

      return cmp * dir;
    });
  }, [items, sortDescriptor, extractSortValue]);

  return { sortedItems, sortDescriptor, setSortDescriptor };
}
