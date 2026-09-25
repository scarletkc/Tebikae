import { Children, useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../ui';

// Column widths and gaps mirror GRID_GAP/MIN_GRID_CARD_WIDTH in
// useWorkspaceLayout.ts — keep the two in sync or the masonry measurement and
// the single-column fallback break.
const GRID_COLUMNS =
  'grid-cols-[repeat(auto-fill,minmax(232px,1fr))] min-[1500px]:grid-cols-[repeat(auto-fill,minmax(255px,1fr))] max-[1100px]:grid-cols-[repeat(auto-fill,minmax(218px,1fr))] max-[760px]:grid-cols-2 max-[430px]:grid-cols-1';
const GRID_GAPS = 'gap-4.5 max-[1100px]:gap-3.5 max-[760px]:gap-3';

/** Grid classes shared by NotesGrid and IssuesView. Masonry spans rows of 1px, so only the column gap survives. */
export function notesGridClasses(list: boolean, masonry = false) {
  return cn(
    'notes-grid grid items-start',
    list
      ? cn('notes-list grid-cols-1', GRID_GAPS)
      : cn(
          GRID_COLUMNS,
          masonry
            ? 'notes-masonry gap-x-4.5 gap-y-0 [grid-auto-rows:1px] max-[1100px]:gap-x-3.5 max-[760px]:gap-x-3'
            : GRID_GAPS,
        ),
  );
}

export default function NotesGrid({ children, list }: { children: ReactNode; list: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || list) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      for (const item of Array.from(grid.children) as HTMLElement[]) {
        const card = item.firstElementChild;
        if (card) item.style.gridRowEnd = `span ${Math.ceil(card.getBoundingClientRect().height + gap)}`;
      }
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(grid);
    for (const item of Array.from(grid.children)) {
      if (item.firstElementChild) observer.observe(item.firstElementChild);
    }
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [children, list]);
  return (
    <div ref={ref} className={notesGridClasses(list, true)}>
      {list
        ? children
        : Children.map(children, (child) => <div className="masonry-item min-w-0">{child}</div>)}
    </div>
  );
}
