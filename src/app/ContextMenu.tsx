import * as Menu from '@radix-ui/react-dropdown-menu';
import { type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isNativeText, useLongPress } from './LongPressTrigger';
import './menus.css';

export interface MenuAction {
  label: string;
  icon?: LucideIcon;
  run?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean | 'indeterminate';
  keepOpen?: boolean;
  children?: MenuAction[];
  separator?: boolean;
  swatch?: string;
}

function Icon({ icon: IconComponent, swatch }: Pick<MenuAction, 'icon' | 'swatch'>) {
  if (swatch !== undefined)
    return (
      <span className="context-icon context-swatch" style={{ backgroundColor: swatch }} aria-hidden="true" />
    );
  return IconComponent ? (
    <IconComponent className="context-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
  ) : null;
}

function readTransform(transform: string) {
  const match = transform.match(/^matrix(3d)?\((.+)\)$/);
  if (!match) return null;
  const values = match[2]!.split(',').map(Number);
  return match[1] ? { x: values[12] ?? 0, y: values[13] ?? 0 } : { x: values[4] ?? 0, y: values[5] ?? 0 };
}

function SubContent({ items }: { items: MenuAction[] }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    const wrapper = content?.parentElement;
    if (!content || !wrapper) return;

    let frame: number | null = null;
    const clamp = () => {
      frame = null;
      const rect = content.getBoundingClientRect();
      const padding = 8;
      const right = window.innerWidth - padding;
      const shift = rect.left < padding ? padding - rect.left : rect.right > right ? right - rect.right : 0;
      if (!shift) return;
      const translation = readTransform(getComputedStyle(wrapper).transform);
      if (!translation) return;
      wrapper.style.transform = `translate3d(${translation.x + shift}px, ${translation.y}px, 0)`;
    };
    const schedule = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(clamp);
    };
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(wrapper, { attributes: true, attributeFilter: ['style'] });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(content);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <Menu.SubContent ref={contentRef} className="context-menu context-submenu" collisionPadding={8}>
      <Items items={items} />
    </Menu.SubContent>
  );
}

function Items({ items }: { items: MenuAction[] }) {
  return items.map((item, index) => (
    <span key={`${item.label}-${index}`} className="context-item-group">
      {item.separator && <Menu.Separator className="context-separator" />}
      {item.children ? (
        <Menu.Sub>
          <Menu.SubTrigger className="context-item" disabled={item.disabled}>
            <Icon icon={item.icon} swatch={item.swatch} />
            {item.label}
            <span className="context-arrow" aria-hidden>
              ›
            </span>
          </Menu.SubTrigger>
          <Menu.Portal>
            <SubContent items={item.children} />
          </Menu.Portal>
        </Menu.Sub>
      ) : item.checked !== undefined ? (
        <Menu.CheckboxItem
          className="context-item"
          checked={item.checked}
          disabled={item.disabled}
          onSelect={(e) => {
            if (item.keepOpen !== false) e.preventDefault();
            item.run?.();
          }}
        >
          <Icon icon={item.icon} swatch={item.swatch} />
          {item.label}
        </Menu.CheckboxItem>
      ) : (
        <Menu.Item
          className={`context-item ${item.danger ? 'context-danger' : ''}`}
          disabled={item.disabled}
          onSelect={item.run}
        >
          <Icon icon={item.icon} swatch={item.swatch} />
          {item.label}
        </Menu.Item>
      )}
    </span>
  ));
}

/** Named action buttons remain available; object menus use right-click or long press. */
export function ContextMenu({
  children,
  items,
  allowText = false,
  onPrepare,
  className = '',
  triggerLabel,
  contextName = 'custom',
  acceptTarget = () => true,
}: {
  triggerLabel?: string;
  className?: string;
  contextName?: string;
  children: ReactNode;
  items: MenuAction[];
  allowText?: boolean;
  acceptTarget?: (target: EventTarget) => boolean;
  onPrepare?: (point: { x: number; y: number; preserveSelection?: boolean }) => void;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  const open = (x: number, y: number, preserveSelection = false) => {
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onPrepare?.({ x, y, preserveSelection });
    setPoint({ x, y });
  };
  const press = useLongPress(open, (target) => !(!items.length && !onPrepare) && acceptTarget(target));
  return (
    <Menu.Root
      open={!!point}
      onOpenChange={(value) => {
        if (!value) setPoint(null);
      }}
      modal={false}
    >
      <div
        className={`context-target ${className}`}
        data-context-menu={contextName}
        onContextMenu={(e) => {
          if (e.defaultPrevented || (!items.length && !onPrepare) || !acceptTarget(e.target)) return;
          if ((!allowText || press.touch.current) && isNativeText(e.target)) return;
          if (e.shiftKey) return;
          e.preventDefault();
          e.stopPropagation();
          press.cancel();
          open(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
          if (
            (!allowText && isNativeText(e.target)) ||
            (!items.length && !onPrepare) ||
            !acceptTarget(e.target)
          )
            return;
          e.preventDefault();
          e.stopPropagation();
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          open(rect.left, rect.bottom, true);
        }}
        onPointerDown={press.onPointerDown}
        onClickCapture={press.onClickCapture}
      >
        {children}
        {triggerLabel && (
          <button
            type="button"
            className="button secondary"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              open(rect.left, rect.bottom, true);
            }}
          >
            {triggerLabel}
          </button>
        )}
      </div>
      {createPortal(
        <Menu.Trigger
          className="context-anchor"
          aria-hidden
          tabIndex={-1}
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
        />,
        document.body,
      )}
      <Menu.Portal>
        <Menu.Content
          className="context-menu"
          align="start"
          sideOffset={0}
          collisionPadding={8}
          sticky="always"
          loop
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const active = document.activeElement;
            if (!active || active === document.body || active.closest('[role="menu"]'))
              focus.current?.focus({ preventScroll: true });
          }}
        >
          <Items items={items} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
