import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Object gestures share actions with an explicit menu; editable text retains its native gestures. */
export function ContextMenu({
  children,
  items,
  explicit = false,
  allowText = false,
  onPrepare,
  className = '',
  triggerLabel,
}: {
  triggerLabel?: string;
  className?: string;
  children: ReactNode;
  items: MenuAction[];
  explicit?: boolean;
  allowText?: boolean;
  onPrepare?: (point: { x: number; y: number; preserveSelection?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const touch = useRef(false);
  const focus = useRef<HTMLElement | null>(null);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => {
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
    return () => {
      cancel();
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);
  const open = (x: number, y: number, preserveSelection = false) => {
    cancel();
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onPrepare?.({ x, y, preserveSelection });
    setPoint({ x, y });
  };
  const nativeText = (target: EventTarget) =>
    target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]');
  const blankEditor = (target: EventTarget) =>
    allowText && target instanceof Element && target.getAttribute('contenteditable') === 'true';
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
          if (e.defaultPrevented || (!allowText && nativeText(e.target))) return;
          if (e.shiftKey) return;
          if (allowText && touch.current && nativeText(e.target) && !blankEditor(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          open(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
          if (!allowText && nativeText(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          open(rect.left, rect.bottom, true);
        }}
        onPointerDown={(e) => {
          touch.current = e.pointerType === 'touch';
          suppressClick.current = false;
          if (
            e.pointerType !== 'touch' ||
            (nativeText(e.target) && !blankEditor(e.target)) ||
            e.defaultPrevented
          )
            return;
          e.stopPropagation();
          origin.current = { x: e.clientX, y: e.clientY };
          timer.current = setTimeout(() => {
            suppressClick.current = true;
            open(e.clientX, e.clientY);
          }, 500);
        }}
        onPointerMove={(e) => {
          if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10)
            cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {children}
        {explicit && (
          <button
            type="button"
            className="icon-button context-more"
            aria-label={triggerLabel ?? t('context.more')}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              open(rect.left, rect.bottom, true);
            }}
          >
            {triggerLabel ?? '···'}
          </button>
        )}
      </div>
      <Menu.Trigger
        className="context-anchor"
        aria-hidden
        tabIndex={-1}
        style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
      />
      <Menu.Portal>
        <Menu.Content
          className="context-menu"
          align="start"
          collisionPadding={8}
          loop
          onClick={(e) => e.stopPropagation()}
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
