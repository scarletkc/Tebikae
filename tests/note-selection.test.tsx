import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useNoteSelection } from '../src/features/notes/useNoteSelection';

it('range uses the full filtered order and select all includes unloaded notes', () => {
  const ids = Array.from({ length: 150 }, (_, i) => String(i));
  const { result, rerender } = renderHook(({ ids }) => useNoteSelection(ids), { initialProps: { ids } });
  act(() => result.current.toggle('98'));
  act(() => result.current.selectRange('103'));
  expect([...result.current.selectedIds]).toEqual(['98', '99', '100', '101', '102', '103']);
  act(() => result.current.selectAll());
  expect(result.current.selectedCount).toBe(150);
  rerender({ ids: ['100', '103'] });
  expect(result.current.selectedCount).toBe(2);
  act(() => result.current.clear());
  expect(result.current.selectedCount).toBe(0);
  expect(result.current.selectionAnchor).toBeNull();
});
