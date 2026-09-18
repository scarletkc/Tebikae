import * as Menu from '@radix-ui/react-dropdown-menu';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isNativeText, useLongPress } from './LongPressTrigger';
import './menus.css';

export interface MenuAction {
  label: string;
  run?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean | 'indeterminate';
  children?: MenuAction[];
  separator?: boolean;
  swatch?: string;
}

function Items({ items }: { items: MenuAction[] }) {
  return items.map((item, index) => (
    <span key={`${item.label}-${index}`} className="context-item-group">
      {item.separator && <Menu.Separator className="context-separator" />}
      {item.children ? (
        <Menu.Sub>
          <Menu.SubTrigger className="context-item" disabled={item.disabled}>
            {item.label}
            <span className="context-arrow" aria-hidden>
              ›
            </span>
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent className="context-menu" collisionPadding={8}>
              <Items items={item.children} />
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
      ) : item.checked !== undefined ? (
        <Menu.CheckboxItem
          className="context-item"
          checked={item.checked}
          disabled={item.disabled}
          onSelect={(e) => {
            e.preventDefault();
            item.run?.();
          }}
        >
          <span className="context-check" aria-hidden>
            {item.checked === 'indeterminate' ? '▣' : item.checked ? '✓' : ''}
          </span>
          {item.swatch && (
            <span className="context-swatch" style={{ backgroundColor: item.swatch }} aria-hidden />
          )}
          {item.label}
        </Menu.CheckboxItem>
      ) : (
        <Menu.Item
          className={`context-item ${item.danger ? 'context-danger' : ''}`}
          disabled={item.disabled}
          onSelect={item.run}
        >
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
  acceptTarget = () => true,
}: {
  triggerLabel?: string;
  className?: string;
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
