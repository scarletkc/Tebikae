import { Children, useLayoutEffect, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export default function NotesGrid({ children, list }: { children: ReactNode; list: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
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
    <div ref={ref} className={`notes-grid ${list ? 'notes-list' : 'notes-masonry'}`}>
      {list
        ? children
        : Children.map(children, (child) => (
            <motion.div
              layout="position"
              transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}
              className="masonry-item"
            >
              {child}
            </motion.div>
          ))}
    </div>
  );
}
