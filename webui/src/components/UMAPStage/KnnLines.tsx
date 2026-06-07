import { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { classHex } from '../../data/classColors';
import type { Camera } from './camera';

const MAX_LINES = 8;

/**
 * SVG overlay drawing a thin "constellation" from the selected point to its
 * k-nearest neighbours (FlowFeatureDetail.knn_ids). The reveal uses framer
 * motion's `pathLength` (which animates via the SVG `pathLength="1"` attribute
 * + percentage dash offsets — geometry-independent), staggered per line; the
 * actual endpoint coordinates are pushed in imperatively from a rAF loop so
 * the lines stay glued to their points while the camera pans/zooms.
 */
export default function KnnLines({ cameraRef }: { cameraRef: React.RefObject<Camera | null> }) {
  const selectedFlowId = useStore((s) => s.selectedFlowId);
  const detail = useStore((s) => s.selectedFlowDetail);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);

  const center = useMemo(() => points.find((p) => p.id === selectedFlowId) ?? null, [points, selectedFlowId]);

  const neighbors = useMemo(() => {
    if (!center || !detail) return [];
    const ids = detail.knn_ids.slice(0, MAX_LINES);
    const found = [];
    for (const id of ids) {
      const p = points.find((pp) => pp.id === id);
      if (p) found.push(p);
    }
    return found;
  }, [center, detail, points]);

  const neighborKey = neighbors.map((n) => n.id).join(',');

  useEffect(() => {
    if (!center || neighbors.length === 0) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const camera = cameraRef.current;
      if (!camera) return;
      const c = camera.dataToScreen(center.x, center.y, center.z ?? 0);
      neighbors.forEach((p, i) => {
        const el = lineRefs.current[i];
        if (!el) return;
        const s = camera.dataToScreen(p.x, p.y, p.z ?? 0);
        el.setAttribute('x1', String(c.x));
        el.setAttribute('y1', String(c.y));
        el.setAttribute('x2', String(s.x));
        el.setAttribute('y2', String(s.y));
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- neighborKey is the stable identity for the `neighbors` array
  }, [center?.id, neighborKey, cameraRef]);

  if (!center || neighbors.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
      <AnimatePresence>
        {neighbors.map((p, i) => (
          <motion.line
            key={`${center.id}-${p.id}`}
            ref={(el) => { lineRefs.current[i] = el; }}
            stroke={classHex(classes, p.label)}
            strokeWidth={1.3}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.45 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ pathLength: { duration: 0.5, delay: i * 0.07, ease: 'easeOut' }, opacity: { duration: 0.3, delay: i * 0.07 } }}
          />
        ))}
      </AnimatePresence>
    </svg>
  );
}
