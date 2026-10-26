import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { fullName } from '../lib/format.js';

/** Single-select user search with a team filter dropdown. */
export default function UserCombobox({ users = [], teams = [], value, onChange, placeholder = 'Search people…', allowClear = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));

  const selected = users.find((u) => u.id === Number(value));
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) =>
      (!team || u.team_id === Number(team)) &&
      (!s || `${fullName(u)} ${u.username} ${u.email} ${u.title || ''}`.toLowerCase().includes(s)));
  }, [users, q, team]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className={selected ? '' : 'text-slate-400'}>{selected ? fullName(selected) : placeholder}</span>
        <span className="flex items-center gap-1 text-slate-400">
          {selected && allowClear && (
            <X size={14} className="hover:text-slate-700" onClick={(e) => { e.stopPropagation(); onChange(null); }} />
          )}
          <ChevronDown size={16} />
        </span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex gap-2 border-b border-slate-100 p-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
              <input autoFocus className="input py-1.5 pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="input w-36 py-1.5" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.map((u) => (
              <li key={u.id}>
                <button type="button" className={`w-full px-3 py-2 text-left text-sm hover:bg-brand-50 ${u.id === Number(value) ? 'bg-brand-50' : ''}`}
                  onClick={() => { onChange(u.id); setOpen(false); setQ(''); }}>
                  <div className="font-medium">{fullName(u)}</div>
                  <div className="text-xs text-slate-500">{[u.title, u.team_name].filter(Boolean).join(' · ')}</div>
                </button>
              </li>
            ))}
            {!filtered.length && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function useClickAway(ref, fn) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fn(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, fn]);
}
