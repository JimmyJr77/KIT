import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Right-hand slide-out pane, matching the priority editor.
 * `rail` adds a thin menu bar along its left edge, and `drawer` opens an extra pane to the left of that;
 * both add to the width rather than taking from the main pane. Escape calls `onEscape` (default: onClose).
 */
export default function SidePanel({ title, subtitle, onClose, onEscape, children, footer, wide, rail, drawer }) {
  const escape = onEscape || onClose;
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && escape();
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
        <div className={`flex h-full w-screen ${wide ? 'max-w-xl' : 'max-w-md'} min-w-0 flex-col`}>
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
