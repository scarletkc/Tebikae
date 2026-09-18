import { useEffect, useRef, type PointerEvent, type MouseEvent } from 'react';

/** Touch text editing is left to the platform, including empty editable surfaces. */
export function isNativeText(target: EventTarget) {
  return (
    target instanceof Element &&
    !!target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
  );
}

export function useLongPress(
  open: (x: number, y: number) => void,
  accepts: (target: EventTarget) => boolean,
) {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const touch = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  };
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const start = origin.current;
      if (
        start &&
        (event.pointerId !== start.pointerId ||
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
      )
        cancel();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', cancel, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      cancel();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', cancel, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  return {
    touch,
    cancel,
    onPointerDown(event: PointerEvent) {
      cancel();
      touch.current = event.pointerType === 'touch';
      suppressClick.current = false;
      if (!touch.current || isNativeText(event.target) || !accepts(event.target) || event.defaultPrevented)
        return;
      event.stopPropagation();
      const { clientX: x, clientY: y, pointerId } = event;
      origin.current = { x, y, pointerId };
      timer.current = setTimeout(() => {
        suppressClick.current = true;
        open(x, y);
        cancel();
      }, 500);
    },
    onClickCapture(event: MouseEvent) {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    },
  };
}
