import { useState } from 'react';
import { MapPin, Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import { api } from '../lib/api.js';

// Territory tags have their own color, apart from teams (blue), team leads (amber) and site admins (red).
const TERRITORY = 'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-teal-50 text-teal-800 ring-teal-200';

/** One tag per territory someone covers. With `onRemove`, each tag can be removed. */
export function TerritoryTags({ territories = [], onRemove }) {
  return territories.map((t) => (
    <span key={t.id} className={TERRITORY} title={`Territory: ${t.name}`}>
      <MapPin size={11} className="shrink-0" /> {t.name}
      {onRemove && (
        <button type="button" onClick={() => onRemove(t.id)} aria-label={`Remove ${t.name} territory`} className="-mr-0.5 opacity-60 hover:opacity-100"><X size={12} /></button>
      )}
    </span>
  ));
}

/** A select listing the territories someone doesn't cover yet; picking one adds it. */
export function AddTerritorySelect({ territories = [], value = [], onAdd, className = '' }) {
  const rest = territories.filter((t) => !value.includes(t.id));
  if (!rest.length) return null;
  return (
    <select className={`input py-1 text-xs ${className}`} value="" aria-label="Add a territory"
      onChange={(e) => e.target.value && onAdd(Number(e.target.value))}>
      <option value="">+ Add territory</option>
      {rest.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

/** Save the territories one person covers. */
export const saveUserTerritories = (userId, ids) => api.put(`/territories/people/${userId}`, { territory_ids: ids });

/** The territory list: add, rename and remove. For admins and BD team leads; `territories` is a useApi('/territories') result. */
export function TerritoriesPanel({ territories, onChanged }) {
  const list = territories.data?.territories || [];
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }
  const [error, setError] = useState('');
  const run = async (fn) => {
    setError('');
    try { await fn(); territories.reload(); onChanged?.(); return true; } catch (e) { setError(e.message); return false; }
  };
  const add = async (e) => {
    e.preventDefault();
    if (await run(() => api.post('/territories', { name }))) setName('');
  };
  const rename = async (e) => {
    e.preventDefault();
    if (await run(() => api.put(`/territories/${editing.id}`, { name: editing.name }))) setEditing(null);
  };
  const remove = (t) => {
    const uses = [t.people && `${t.people} ${t.people === 1 ? 'person' : 'people'}`, t.tickets && `${t.tickets} ticket${t.tickets === 1 ? '' : 's'}`].filter(Boolean);
    if (!confirm(`Remove the ${t.name} territory?${uses.length ? ` It comes off ${uses.join(' and ')}.` : ''}`)) return;
    run(() => api.del(`/territories/${t.id}`));
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><MapPin size={16} className="text-teal-600" /> Territories</h2>
      <p className="text-xs text-slate-500">The customer areas BD directors cover. Each bid ticket belongs to one territory.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {list.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            {editing?.id === t.id ? (
              <form onSubmit={rename} className="flex flex-1 items-center gap-2">
                <input autoFocus className="input py-1 text-sm" value={editing.name} aria-label="Territory name"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                <button className="btn-ghost p-1.5 text-emerald-700" title="Save" aria-label="Save name"><Check size={15} /></button>
                <button type="button" className="btn-ghost p-1.5" onClick={() => setEditing(null)} title="Cancel" aria-label="Cancel"><X size={15} /></button>
              </form>
            ) : (
              <>
                <span className={TERRITORY}><MapPin size={11} /> {t.name}</span>
                <span className="mr-auto text-xs text-slate-400">
                  {t.people} {t.people === 1 ? 'person' : 'people'} · {t.tickets} ticket{t.tickets === 1 ? '' : 's'}
                </span>
                <button type="button" className="btn-ghost p-1.5 text-slate-500 hover:text-slate-800" onClick={() => setEditing({ id: t.id, name: t.name })}
                  title={`Rename ${t.name}`} aria-label={`Rename ${t.name}`}><Pencil size={14} /></button>
                <button type="button" className="btn-ghost p-1.5 text-red-600" onClick={() => remove(t)}
                  title={`Remove ${t.name}`} aria-label={`Remove ${t.name}`}><Trash2 size={14} /></button>
              </>
            )}
          </li>
        ))}
        {territories.data && !list.length && <li className="px-3 py-4 text-center text-sm text-slate-400">No territories yet.</li>}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input className="input max-w-sm py-1.5 text-sm" placeholder="New territory name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New territory name" required />
        <button className="btn px-3 py-1.5 text-sm"><Plus size={14} /> Add territory</button>
      </form>
    </div>
  );
}
