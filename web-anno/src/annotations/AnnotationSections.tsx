import { useEffect, useRef, useState, type ReactNode } from 'react';
import { annotationPanelSplit } from '../viewer/workspaceConfig';

/** Session-only presentation state; resizing never writes annotation data. */
export function AnnotationSections({ list, properties }: { list: ReactNode; properties: ReactNode }) {
  const [share, setShare] = useState(annotationPanelSplit.defaultShare);
  const [height, setHeight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; size: number }>();
  useEffect(() => {
    if (!root.current || !globalThis.ResizeObserver) return;
    const observer = new ResizeObserver(([entry]) => {
      // Collapsing the outer sidebar must not reset its internal layout.
      if (entry.contentRect.height > 0) setHeight(entry.contentRect.height);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const available = Math.max(0, height - annotationPanelSplit.handle);
  const min = Math.min(annotationPanelSplit.minList, available / 2);
  const max = Math.max(min, available - annotationPanelSplit.minProperties);
  const bounded = (value: number) => Math.max(min, Math.min(max, value));
  const size = bounded(available * share / 100);
  const resize = (value: number) => { if (available) setShare(bounded(value) / available * 100); };
  const reset = () => setShare(annotationPanelSplit.defaultShare);
  return <div className="annotation-sections" ref={root} style={{ gridTemplateRows: available ? `${size}px ${annotationPanelSplit.handle}px minmax(0, 1fr)` : `minmax(0, ${share}fr) ${annotationPanelSplit.handle}px minmax(0, ${100 - share}fr)` }}>
    <div className="annotation-list-section">{list}</div>
    <div className="annotation-section-divider" role="separator" tabIndex={0} aria-label="调整对象列表与属性区高度" aria-orientation="horizontal"
      aria-valuemin={available ? Math.round(min / available * 100) : 0}
      aria-valuemax={available ? Math.round(max / available * 100) : 100}
      aria-valuenow={available ? Math.round(size / available * 100) : share}
      aria-valuetext={`对象列表占 ${available ? Math.round(size / available * 100) : share}%`}
      title="上下拖动调整高度 · 双击恢复默认 · 方向键微调"
      onDoubleClick={reset}
      onKeyDown={e => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Home') reset();
        else resize(e.key === 'End' ? max : size + (e.key === 'ArrowDown' ? 24 : -24));
      }}
      onPointerDown={e => {
        if (e.button !== 0 || !available) return;
        e.preventDefault(); e.currentTarget.focus();
        drag.current = { y: e.clientY, size };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => { if (drag.current) resize(drag.current.size + e.clientY - drag.current.y); }}
      onPointerUp={() => { drag.current = undefined; }}
      onPointerCancel={() => { drag.current = undefined; }}
      onLostPointerCapture={() => { drag.current = undefined; }}
    ><span aria-hidden="true" /></div>
    <div className="annotation-property-section">{properties}</div>
  </div>;
}
