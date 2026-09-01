import { useCallback, useRef, useState } from 'react';
import type { TooltipModel, TooltipPosition } from '@/components/tooltips/Tooltip';

/**
 * Shared hover plumbing for every chart.
 *
 * Position updates are written on an animation frame so a fast pointer sweep
 * across a dense scatter does not queue one React render per pointermove.
 */
export function useChartTooltip() {
  const [model, setModel] = useState<TooltipModel | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const frame = useRef(0);
  const pending = useRef<{ m: TooltipModel; p: TooltipPosition } | null>(null);

  const show = useCallback((m: TooltipModel, e: { clientX: number; clientY: number }) => {
    pending.current = { m, p: { x: e.clientX, y: e.clientY } };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) {
        setModel(pending.current.m);
        setPosition(pending.current.p);
      }
    });
  }, []);

  const hide = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = null;
    setModel(null);
    setPosition(null);
  }, []);

  return { model, position, show, hide };
}
