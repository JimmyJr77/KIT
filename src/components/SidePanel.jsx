import { useEffect } from 'react';
import { X } from 'lucide-react';

/** Right-hand slide-out pane, matching the priority editor. */
export default function SidePanel({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} />
      <aside className={`fixed top-0 right-0 z-50 flex h-full w-full ${wide ? 'max-w-xl' : 'max-w-md'} flex-col bg-white shadow-2xl animate-[slidein_.2s_ease-out]`}>
        <style>{'@keyframes slidein{from{transform:translateX(100%)}to{transform:none}}'}</style>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-t border-slate-200 px-5 py-4">{footer}</footer>}
      </aside>
    </>
  );
}
