import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PixelGrid } from '@splint/shared';
import { Icon } from './Icon';

type Point = { x: number; y: number };
type PaintCell = { index: number; color: number };

export default function ColoringCanvas({ grid, filled, selectedColor, onPaint, disabled, onWrongColor }: {
  grid: PixelGrid;
  filled: Set<number>;
  selectedColor: number;
  onPaint: (cells: PaintCell[]) => void;
  disabled: boolean;
  onWrongColor: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 400, height: 400 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [tool, setTool] = useState<'paint' | 'pan'>('paint');
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ point: Point; pan: Point; zoom: number; distance: number } | null>(null);
  const lastPaint = useRef<Point | null>(null);
  const buffer = useRef(new Map<number, PaintCell>());
  const frame = useRef(0);
  const onPaintRef = useRef(onPaint);
  onPaintRef.current = onPaint;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const baseCell = Math.min(size.width / grid.width, size.height / grid.height) * 0.88;
  const cell = baseCell * zoom;
  const origin = { x: (size.width - grid.width * cell) / 2 + pan.x, y: (size.height - grid.height * cell) / 2 + pan.y };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(42, 31, 64, .08)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 4;
    ctx.fillRect(origin.x, origin.y, grid.width * cell, grid.height * cell);
    ctx.shadowColor = 'transparent';
    const minX = Math.max(0, Math.floor(-origin.x / cell));
    const maxX = Math.min(grid.width, Math.ceil((size.width - origin.x) / cell));
    const minY = Math.max(0, Math.floor(-origin.y / cell));
    const maxY = Math.min(grid.height, Math.ceil((size.height - origin.y) / cell));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${Math.max(6, Math.min(cell * .45, 22))}px ui-monospace, monospace`;
    for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
      const index = y * grid.width + x;
      const px = origin.x + x * cell;
      const py = origin.y + y * cell;
      const color = grid.cells[index] ?? 0;
      if (!grid.mask[index]) {
        ctx.fillStyle = '#f6f4ee';
      } else if (filled.has(index)) {
        ctx.fillStyle = grid.palette[color] ?? '#202020';
      } else {
        ctx.fillStyle = color === selectedColor ? '#e8ddff' : '#fdfcfa';
      }
      ctx.fillRect(px, py, cell + .1, cell + .1);
      if (grid.mask[index] && !filled.has(index)) {
        if (cell >= 7) {
          ctx.fillStyle = color === selectedColor ? '#6941b8' : '#a29baf';
          ctx.fillText(String(color + 1), px + cell / 2, py + cell / 2 + .3);
        }
        ctx.strokeStyle = 'rgba(77, 56, 100, .10)';
        ctx.lineWidth = .5;
        ctx.strokeRect(px + .25, py + .25, cell - .5, cell - .5);
      }
    }
    if (focused && !disabled) {
      ctx.strokeStyle = '#30233f';
      ctx.lineWidth = 2;
      ctx.strokeRect(origin.x + cursor.x * cell + 1, origin.y + cursor.y * cell + 1, cell - 2, cell - 2);
    }
  }, [grid, filled, selectedColor, size, zoom, pan, focused, cursor, disabled, cell, origin.x, origin.y]);

  const flushBuffer = useCallback(() => {
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (buffer.current.size) {
      const cells = [...buffer.current.values()];
      buffer.current.clear();
      onPaintRef.current(cells);
    }
  }, []);
  useEffect(() => () => { flushBuffer(); }, [flushBuffer]);

  const localPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const gridPoint = (point: Point) => ({ x: Math.floor((point.x - origin.x) / cell), y: Math.floor((point.y - origin.y) / cell) });
  const paintCell = (point: Point, reportWrong: boolean) => {
    if (disabled || point.x < 0 || point.y < 0 || point.x >= grid.width || point.y >= grid.height) return;
    const index = point.y * grid.width + point.x;
    if (!grid.mask[index] || filled.has(index) || buffer.current.has(index)) return;
    if (grid.cells[index] !== selectedColor) { if (reportWrong) onWrongColor(); return; }
    buffer.current.set(index, { index, color: selectedColor });
    if (!frame.current) frame.current = window.requestAnimationFrame(flushBuffer);
  };
  const paintLine = (point: Point, first = false) => {
    const next = gridPoint(point);
    const previous = lastPaint.current ?? next;
    const steps = Math.max(Math.abs(next.x - previous.x), Math.abs(next.y - previous.y));
    if (!steps) paintCell(next, first);
    else for (let n = 0; n <= Math.min(steps, 512); n++) paintCell({
      x: Math.round(previous.x + (next.x - previous.x) * n / steps),
      y: Math.round(previous.y + (next.y - previous.y) * n / steps),
    }, first && n === 0);
    lastPaint.current = next;
  };
  const beginGesture = () => {
    const list = [...pointers.current.values()];
    if (list.length >= 2) {
      drag.current = {
        point: { x: (list[0]!.x + list[1]!.x) / 2, y: (list[0]!.y + list[1]!.y) / 2 },
        pan: { ...pan }, zoom,
        distance: Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y),
      };
      lastPaint.current = null;
    } else if (list[0]) drag.current = { point: list[0], pan: { ...pan }, zoom, distance: 0 };
  };
  const changeZoom = useCallback((next: number) => {
    const previous = zoomRef.current;
    const value = Math.max(1, Math.min(8, next));
    zoomRef.current = value;
    setZoom(value);
    setPan(old => ({ x: old.x * value / previous, y: old.y * value / previous }));
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => { event.preventDefault(); changeZoom(zoom * Math.exp(-event.deltaY * .002)); };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, changeZoom]);

  return <div className="canvas-block">
    <div className="canvas-toolbar">
      <div className="segmented-tool" role="group" aria-label="Инструмент холста">
        <button className={tool === 'paint' ? 'is-active' : ''} aria-label="Раскрашивать" aria-pressed={tool === 'paint'} onClick={() => setTool('paint')}><Icon name="brush" size={18} /><span>Кисть</span></button>
        <button className={tool === 'pan' ? 'is-active' : ''} aria-label="Перемещать холст" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Icon name="hand" size={18} /><span>Двигать</span></button>
      </div>
      <span className="canvas-hint">Два пальца — масштаб</span>
    </div>
    <div className={`canvas-host ${tool === 'pan' ? 'is-pan' : ''}`} ref={hostRef}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Холст для раскрашивания по номерам. Выберите цвет. Стрелки перемещают курсор, пробел закрашивает клетку." data-testid="coloring-canvas"
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.preventDefault();
          if (event.key === ' ') { paintCell(cursor, true); flushBuffer(); }
          else if (event.key === 'ArrowLeft') setCursor(old => ({ ...old, x: Math.max(0, old.x - 1) }));
          else if (event.key === 'ArrowRight') setCursor(old => ({ ...old, x: Math.min(grid.width - 1, old.x + 1) }));
          else if (event.key === 'ArrowUp') setCursor(old => ({ ...old, y: Math.max(0, old.y - 1) }));
          else if (event.key === 'ArrowDown') setCursor(old => ({ ...old, y: Math.min(grid.height - 1, old.y + 1) }));
        }}
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = localPoint(event);
          pointers.current.set(event.pointerId, point);
          beginGesture();
          if (pointers.current.size === 1 && tool === 'paint' && event.button !== 1) paintLine(point, true);
        }}
        onPointerMove={event => {
          if (!pointers.current.has(event.pointerId)) return;
          const point = localPoint(event);
          pointers.current.set(event.pointerId, point);
          const list = [...pointers.current.values()];
          const gesture = drag.current;
          if (list.length >= 2 && gesture) {
            const middle = { x: (list[0]!.x + list[1]!.x) / 2, y: (list[0]!.y + list[1]!.y) / 2 };
            const distance = Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y);
            setZoom(Math.max(1, Math.min(8, gesture.zoom * distance / Math.max(1, gesture.distance))));
            setPan({ x: gesture.pan.x + middle.x - gesture.point.x, y: gesture.pan.y + middle.y - gesture.point.y });
          } else if ((tool === 'pan' || event.buttons === 4) && gesture) {
            setPan({ x: gesture.pan.x + point.x - gesture.point.x, y: gesture.pan.y + point.y - gesture.point.y });
          } else if (list.length === 1 && tool === 'paint') paintLine(point);
        }}
        onPointerUp={event => { pointers.current.delete(event.pointerId); lastPaint.current = null; flushBuffer(); beginGesture(); }}
        onPointerCancel={event => { pointers.current.delete(event.pointerId); lastPaint.current = null; flushBuffer(); }}
      />
    </div>
    <div className="canvas-footer">
      <span className="canvas-zoom-label">Масштаб холста</span>
      <div className="zoom-controls" role="group" aria-label="Масштаб холста">
        <button aria-label="Уменьшить масштаб" disabled={zoom <= 1} onClick={() => changeZoom(zoom / 1.5)}><Icon name="minus" size={17} /></button>
        <button className="zoom-value" aria-label="Сбросить масштаб" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button>
        <button aria-label="Увеличить масштаб" disabled={zoom >= 8} onClick={() => changeZoom(zoom * 1.5)}><Icon name="plus" size={17} /></button>
      </div>
    </div>
  </div>;
}
