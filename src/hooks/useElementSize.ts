import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Measure a container so D3 can draw to real pixels.
 *
 * The measurement is taken synchronously — once on mount, then on every
 * ResizeObserver callback. It deliberately does *not* defer through
 * requestAnimationFrame: charts render nothing until a non-zero size arrives,
 * so routing the measurement through the frame loop makes every chart on the
 * page depend on that loop running. In a throttled or background tab the
 * callbacks stop and the charts stay blank forever. ResizeObserver already
 * delivers at most one callback per frame, so the extra hop bought nothing.
 *
 * Redundant updates are filtered by the sub-pixel equality check below, which
 * is what actually prevents render loops.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T>,
  Size,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const apply = (width: number, height: number) => {
    setSize((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  };

  // Measure before paint so the first render already has real dimensions.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    apply(r.width, r.height);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      apply(box.width, box.height);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}
