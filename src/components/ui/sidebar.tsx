import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from './utils';

export function Sidebar({
  collapsed,
  className,
  children,
}: {
  collapsed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.aside
      className={cn('sidebar', className)}
      data-collapsed={collapsed ? 'true' : 'false'}
      animate={{ width: collapsed ? 72 : 'var(--sidebar-width)' }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.aside>
  );
}
