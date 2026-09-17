import { useState } from 'react';

export function useNoteSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setAnchor] = useState<string | null>(null);
  const selectedIds = new Set(ids.filter((id) => selected.has(id)));
  const select = (id: string) => {
    setSelected((old) => new Set([...old, id]));
    setAnchor(id);
  };
  const toggle = (id: string) => {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  };
  return {
    selectedIds,
    selectionAnchor,
    selectedCount: selectedIds.size,
    isSelected: (id: string) => selectedIds.has(id),
    select,
    toggle,
    selectRange: (id: string) => {
      const a = ids.indexOf(selectionAnchor ?? id),
        b = ids.indexOf(id);
      if (a < 0 || b < 0) return select(id);
      setSelected((old) => new Set([...old, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]));
    },
    selectAll: () => setSelected(new Set(ids)),
    clear: () => {
      setSelected(new Set());
      setAnchor(null);
    },
  };
}
