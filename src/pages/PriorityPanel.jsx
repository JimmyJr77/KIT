import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Search, Ticket } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import MultiSelect from '../components/MultiSelect.jsx';

const EMPTY_TICKET = { opportunity_title: '', organization: '', pipeline_status: '', value: '' };

/** Slide-out panel for creating or editing a priority card (and its ticket). */
export default function PriorityPanel({ card, defaultAssignee, users, statuses, teamId, weekStart, readOnly, onClose, onSaved }) {
  const { user } = useAuth();
  const isNew = !card;
  const [ticketMode, setTicketMode] = useState('new'); // 'new' | 'existing' (new cards only)
  const [ticketId, setTicketId] = useState(card?.ticket_id ?? null);
  const [ticket, setTicket] = useState(card ? {
    opportunity_title: card.opportunity_title, organization: card.organization || '', pipeline_status: card.pipeline_status || '', value: card.value ?? '',
  } : EMPTY_TICKET);
  const [form, setForm] = useState({
    title: card?.title || '',
    due_date: card?.due_date || '',
    checklist: card?.checklist || [],
    notes: card?.notes || '',
    completed: !!card?.completed,
    assignees: card ? card.assignees.map((a) => a.user_id) : [defaultAssignee || user.id],
  });
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setT = (k, v) => setTicket((t) => ({ ...t, [k]: v }));

  const save = async () => {
    setError('');
    if (!form.assignees.length) return setError('Assign at least one person');
    if (!ticket.opportunity_title.trim()) return setError(ticketMode === 'existing' && !ticketId ? 'Select an existing ticket' : 'Opportunity Title is required');
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/priorities/cards', {
          ...form, team_id: teamId, week_start: weekStart, ticket,
          ticket_id: ticketMode === 'existing' ? ticketId : null,
        });
      } else {
        await api.put(`/priorities/cards/${card.id}`, { ...form, ticket });
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this priority card? The ticket is kept.')) return;
    await api.del(`/priorities/cards/${card.id}`);
    onSaved();
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    set('checklist', [...form.checklist, { text: newItem.trim(), done: false }]);
    setNewItem('');
  };

  const ro = readOnly;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-[slidein_.2s_ease-out]">
        <style>{'@keyframes slidein{from{transform:translateX(100%)}to{transform:none}}'}</style>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold">{isNew ? 'New priority' : 'Priority details'}</h2>
            {!isNew && (
              <p className="text-xs text-slate-500">
                Ticket #{card.ticket_id} · {card.is_planned ? 'Planned at check-in' : 'New work after check-in'}
              </p>
            )}
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Ticket */}
          <section className="space-y-3 rounded-lg bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Ticket size={13} /> Ticket</span>
              {isNew && !ro && (
                <div className="flex rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200">
                  {[['new', 'New ticket'], ['existing', 'Existing ticket']].map(([m, l]) => (
                    <button key={m} type="button" onClick={() => { setTicketMode(m); setTicketId(null); setTicket(EMPTY_TICKET); }}
                      className={`rounded px-2 py-1 ${ticketMode === m ? 'bg-brand-600 text-white' : 'text-slate-600'}`}>{l}</button>
                  ))}
                </div>
              )}
            </div>
            {isNew && ticketMode === 'existing' && !ticketId ? (
              <TicketSearch onPick={(t) => {
                setTicketId(t.id);
                setTicket({ opportunity_title: t.opportunity_title, organization: t.organization || '', pipeline_status: t.pipeline_status || '', value: t.value ?? '' });
              }} />
            ) : (
              <>
                {!isNew && <p className="text-xs text-slate-500">Ticket changes apply to every priority card on this ticket.</p>}
                {isNew && ticketId && (
                  <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => { setTicketId(null); setTicket(EMPTY_TICKET); }}>
                    ← Choose a different ticket
                  </button>
                )}
                <Field label="Opportunity title *">
                  <input className="input" value={ticket.opportunity_title} onChange={(e) => setT('opportunity_title', e.target.value)} disabled={ro} autoFocus={isNew} />
                </Field>
                <Field label="Organization">
                  <input className="input" value={ticket.organization} onChange={(e) => setT('organization', e.target.value)} disabled={ro} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pipeline status">
                    <select className="input" value={ticket.pipeline_status} onChange={(e) => setT('pipeline_status', e.target.value)} disabled={ro}>
                      <option value="">—</option>
                      {statuses.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Value ($)">
                    <input type="number" min="0" className="input" value={ticket.value} onChange={(e) => setT('value', e.target.value)} disabled={ro} />
                  </Field>
                </div>
              </>
            )}
          </section>

          {/* Card */}
          <Field label="Priority / next step">
            <input className="input" placeholder="e.g. Schedule meeting with contracting officer" value={form.title} onChange={(e) => set('title', e.target.value)} disabled={ro} />
          </Field>
          <Field label="Assigned">
            {ro ? (
              <p className="text-sm">{form.assignees.map((id) => fullName(users.find((u) => u.id === id))).join(', ')}</p>
            ) : (
              <MultiSelect options={users.map((u) => ({ value: u.id, label: fullName(u), sub: u.team_name }))} value={form.assignees} onChange={(v) => set('assignees', v)} />
            )}
          </Field>
          <Field label="Due date">
            <input type="date" className="input" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} disabled={ro} />
          </Field>
          <Field label={`Checklist${form.checklist.length ? ` (${form.checklist.filter((c) => c.done).length}/${form.checklist.length})` : ''}`}>
            <ul className="space-y-1.5">
              {form.checklist.map((item, i) => (
                <li key={i} className="group flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={item.done} disabled={ro}
                    onChange={(e) => set('checklist', form.checklist.map((c, j) => (j === i ? { ...c, done: e.target.checked } : c)))} />
                  <input className={`flex-1 border-0 bg-transparent p-0 text-sm focus:ring-0 ${item.done ? 'text-slate-400 line-through' : ''}`} value={item.text} disabled={ro}
                    onChange={(e) => set('checklist', form.checklist.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)))} />
                  {!ro && <button type="button" className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600" onClick={() => set('checklist', form.checklist.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
                </li>
              ))}
            </ul>
            {!ro && (
              <div className="mt-2 flex gap-2">
                <input className="input" placeholder="Add a checklist item…" value={newItem} onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())} />
                <button type="button" className="btn" onClick={addItem}><Plus size={15} /></button>
              </div>
            )}
          </Field>
          <Field label="Notes">
            <textarea className="input min-h-28" value={form.notes} onChange={(e) => set('notes', e.target.value)} disabled={ro} />
          </Field>
          {!isNew && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.completed} onChange={(e) => set('completed', e.target.checked)} disabled={ro} />
              Mark this priority complete
            </label>
          )}
        </div>

        {!ro && (
          <footer className="space-y-2 border-t border-slate-200 px-5 py-4">
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add priority' : 'Save changes'}</button>
              {!isNew && <button className="btn-danger" onClick={remove}><Trash2 size={15} /></button>}
            </div>
          </footer>
        )}
      </aside>
    </>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

function TicketSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [tickets, setTickets] = useState([]);
  useEffect(() => {
    const h = setTimeout(() => api.get(`/priorities/tickets?q=${encodeURIComponent(q)}`).then((d) => setTickets(d.tickets)), 200);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
        <input autoFocus className="input pl-8" placeholder="Search by opportunity or organization…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md bg-white ring-1 ring-slate-200">
        {tickets.map((t) => (
          <li key={t.id}>
            <button type="button" className="w-full px-3 py-2 text-left hover:bg-brand-50" onClick={() => onPick(t)}>
              <div className="text-sm font-medium">{t.opportunity_title}</div>
              <div className="text-xs text-slate-500">
                #{t.id} · {[t.organization, t.pipeline_status, t.value != null ? usd(t.value) : null].filter(Boolean).join(' · ')} · {t.card_count} card{t.card_count === 1 ? '' : 's'}
              </div>
            </button>
          </li>
        ))}
        {!tickets.length && <li className="px-3 py-2 text-sm text-slate-400">No tickets found</li>}
      </ul>
    </div>
  );
}
