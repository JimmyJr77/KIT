import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Panel widths grow with the screen instead of stopping at a fixed size, so the editor is
 * neither a thin strip on a large monitor nor wider than the screen on a phone.
 * Normal: 28rem up to 44rem (about 36% of the screen). Wide: 36rem up to 64rem (about 48%).
 * Each panel opens at this default; the user can then drag its left edge to resize it.
 */
export const PANEL_WIDTH = 'w-[min(100vw,clamp(28rem,36vw,44rem))]';
export const PANEL_WIDTH_WIDE = 'w-[min(100vw,clamp(36rem,48vw,64rem))]';

const openPanels = []; // every SidePanel on screen, in the order they opened
const MIN_WIDTH = 320;
const KEY_STEP = 32;
const EDGE_GAP = 24;

/**
 * Lets the user resize a slide-out pane by dragging its left edge. Returns the inline style for the
 * pane (empty until the user resizes, so the default width class applies) and the handle to render
 * inside it. The pane needs `relative`. The width is not remembered: every panel opens at the default.
 */
export function usePanelResize() {
  const ref = useRef(null);
  const [width, setWidth] = useState(null);

  // The pane may sit beside a rail or drawer; those keep their width, so the pane can take the rest.
  const limits = () => {
    const pane = ref.current;
    const aside = pane?.parentElement?.tagName === 'ASIDE' ? pane.parentElement : null;
    const extra = aside ? aside.getBoundingClientRect().width - pane.getBoundingClientRect().width : 0;
    // Leave a strip of page showing so the handle stays easy to grab and a click outside still closes.
    const max = Math.max(MIN_WIDTH, window.innerWidth - extra - EDGE_GAP);
    return { min: Math.min(MIN_WIDTH, max), max };
  };
  const clamp = (w) => { const { min, max } = limits(); return Math.round(Math.min(max, Math.max(min, w))); };

  const onPointerDown = (e) => {
    if (e.button !== 0 || !ref.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = ref.current.getBoundingClientRect().width;
    const { body } = document;
    const prev = { cursor: body.style.cursor, userSelect: body.style.userSelect };
    body.style.cursor = 'col-resize';
    body.style.userSelect = 'none';
    const move = (ev) => setWidth(clamp(startWidth + (startX - ev.clientX)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      Object.assign(body.style, prev);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e) => {
    if (!ref.current) return;
    const current = ref.current.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') setWidth(clamp(current + KEY_STEP));
    else if (e.key === 'ArrowRight') setWidth(clamp(current - KEY_STEP));
    else if (e.key === 'Home' || e.key === 'Enter') setWidth(null);
    else return;
    e.preventDefault();
  };

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel. Drag, or use the arrow keys. Double-click to reset."
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(null)}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize touch-none outline-none sm:block"
    >
      <div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-brand-500/60 group-focus-visible:bg-brand-500 group-active:bg-brand-500" />
    </div>
  );

  return { ref, style: width ? { width, maxWidth: '100vw' } : undefined, handle };
}

/**
 * Right-hand slide-out pane, matching the priority editor.
 * `rail` adds a thin menu bar along its left edge, and `drawer` opens an extra pane to the left of that;
 * both add to the width rather than taking from the main pane. Escape calls `onEscape` (default: onClose).
 */
export default function SidePanel({ title, subtitle, onClose, onEscape, children, footer, wide, rail, drawer }) {
  const escape = onEscape || onClose;
  const resize = usePanelResize();
  // Panels can open over one another (a form from a ticket, a scheduler from that form): Escape closes only the top one.
  const token = useRef(null);
  useEffect(() => {
    const mine = (token.current = {});
    openPanels.push(mine);
    return () => { openPanels.splice(openPanels.indexOf(mine), 1); };
  }, []);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && openPanels[openPanels.length - 1] === token.current && escape();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [escape]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 flex h-full max-w-full bg-white shadow-2xl animate-[slidein_.2s_ease-out]">
        <style>{'@keyframes slidein{from{transform:translateX(100%)}to{transform:none}}'}</style>
        {drawer && <section className="flex h-full w-[28rem] max-w-[90vw] shrink-0 flex-col border-r border-slate-200 bg-slate-50">{drawer}</section>}
        {rail && <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-slate-50 py-3">{rail}</nav>}
        <div ref={resize.ref} style={resize.style} className={`relative flex h-full ${wide ? PANEL_WIDTH_WIDE : PANEL_WIDTH} min-w-0 flex-col`}>
          {resize.handle}
          <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-semibold">{title}</h2>
              {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
            </div>
            <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="border-t border-slate-200 px-5 py-4">{footer}</footer>}
        </div>
      </aside>
    </>
  );
}
