import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Loader2, Mail, Phone, Ticket } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, formatPhoneInput, stamp, fullStamp, ticketKind } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';

// How well we know someone, 0–5.
export const RELATIONSHIP = [
  { level: 0, label: 'Never spoke' },
  { level: 1, label: 'Met once' },
  { level: 2, label: 'Acquaintance' },
  { level: 3, label: 'Working relationship' },
  { level: 4, label: 'Trusted relationship' },
  { level: 5, label: 'Close personal relationship' },
];
const TONE = ['bg-slate-100 text-slate-600', 'bg-slate-200 text-slate-700', 'bg-sky-100 text-sky-800', 'bg-brand-100 text-brand-800', 'bg-emerald-100 text-emerald-800', 'bg-emerald-600 text-white'];

export const contactName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ');
export const contactLine = (c) => [c?.role, c?.organization].filter(Boolean).join(' · ');

/** "3 · Working relationship" as a small colored chip. */
export function RelationshipBadge({ level = 0, short }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${TONE[level]}`}
      title={`Relationship ${level} of 5: ${RELATIONSHIP[level].label}`}>
      {level}{!short && <span className="font-medium">· {RELATIONSHIP[level].label}</span>}
    </span>
  );
}

/** Six buttons, 0–5, with the chosen level's meaning underneath. */
export function RelationshipPicker({ value, onChange }) {
  return (
    <div>
      <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Relationship">
        {RELATIONSHIP.map((r) => (
          <button key={r.level} type="button" role="radio" aria-checked={value === r.level} onClick={() => onChange(r.level)} title={r.label}
            className={`h-8 rounded-md text-sm font-semibold tabular-nums transition ${value === r.level ? `${TONE[r.level]} ring-2 ring-brand-500` : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
            {r.level}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{value} = {RELATIONSHIP[value].label} <span className="text-slate-400">(0 never spoke · 5 close personal relationship)</span></p>
    </div>
  );
}

const EMPTY = { first_name: '', last_name: '', organization: '', role: '', email: '', phone: '', relationship: 0, notes: '' };
const toForm = (c) => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c?.[k] ?? EMPTY[k]])) });

/** The contact's details. Calls onSubmit(form) and shows any error it throws. */
export function ContactForm({ initial, submitLabel, onSubmit, onCancel, extra }) {
  const [form, setForm] = useState(() => toForm(initial));
  // A new contact can come with interaction notes; they're saved along with it.
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState('');
  const addPending = () => { if (draft.trim()) { setPending((xs) => [draft.trim(), ...xs]); setDraft(''); } };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(initial));
  useEffect(() => { setForm(toForm(initial)); }, [initial]);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    // A note still in the box counts too, so nothing typed is lost.
    const interactions = initial ? undefined : [...(draft.trim() ? [draft.trim()] : []), ...pending];
    try { await onSubmit(initial ? form : { ...form, interactions }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="First name *"><input className="input" autoFocus={!initial} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></Field>
        <Field label="Last name"><input className="input" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Where they work"><input className="input" placeholder="Organization" value={form.organization} onChange={(e) => set('organization', e.target.value)} /></Field>
        <Field label="Role"><input className="input" placeholder="Title or role" value={form.role} onChange={(e) => set('role', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" placeholder="xxx-xxx-xxxx" value={form.phone} onChange={(e) => set('phone', formatPhoneInput(e.target.value))} /></Field>
      </div>
      <Field label="Relationship"><RelationshipPicker value={form.relationship} onChange={(v) => set('relationship', v)} /></Field>
      <Field label="Relationship notes">
        <textarea className="input min-h-16 text-sm" placeholder="How we know them, what they care about, who introduced us…" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {!initial && (
        <div>
          <span className="label">Interaction notes</span>
          <div className="flex gap-2">
            <textarea rows={2} className="input resize-none text-sm" placeholder="A call, a meeting, a conference conversation…" value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addPending(); } }} />
            <button type="button" className="btn shrink-0 self-start px-2.5 text-xs" onClick={addPending} disabled={!draft.trim()}>Add</button>
          </div>
          {pending.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pending.map((n, i) => (
                <li key={`${i}-${n}`} className="group flex items-start gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">
                  <span className="flex-1 break-words whitespace-pre-wrap">{n}</span>
                  <button type="button" onClick={() => setPending((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove note" className="text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-slate-400">Add as many as you like; they’re saved with this person, newest first.</p>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {extra}
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="submit" className="btn-primary" disabled={busy || (initial && !dirty) || !form.first_name.trim()}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * One contact in full: editable details, then interaction notes, then the tickets they're on.
 * `onChanged(contact)` after edits; `onDeleted()` after a delete.
 */
export function ContactDetail({ contactId, onChanged, onDeleted }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/contacts/${contactId}`).then(setData);
  useEffect(() => { load(); }, [contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const c = data.contact;
  const canDelete = c.created_by === user.id || user.role === 'admin';

  const save = async (form) => {
    const r = await api.put(`/contacts/${c.id}`, form);
    setData((d) => ({ ...d, contact: r.contact }));
    onChanged?.(r.contact);
  };
  const addNote = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/contacts/${c.id}/interactions`, { body: note });
      setNote('');
      await load();
      onChanged?.(c);
    } finally {
      setBusy(false);
    }
  };
  const removeNote = async (i) => {
    if (!confirm('Delete this interaction note?')) return;
    await api.del(`/contacts/interactions/${i.id}`);
    load();
  };
  const remove = async () => {
    if (!confirm(`Delete ${contactName(c)} from the CRM? This removes them from every ticket too.`)) return;
    await api.del(`/contacts/${c.id}`);
    onDeleted?.();
  };

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <RelationshipBadge level={c.relationship} />
        {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-brand-700 hover:underline"><Mail size={13} /> {c.email}</a>}
        {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-brand-700 hover:underline"><Phone size={13} /> {c.phone}</a>}
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Details</h4>
        <ContactForm initial={c} submitLabel="Save changes" onSubmit={save}
          extra={canDelete && <button type="button" className="btn-danger mr-auto" onClick={remove} aria-label="Delete contact" title="Delete from the CRM"><Trash2 size={15} /></button>} />
      </section>

      <section>
        <h4 className="mb-0.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Interaction notes</h4>
        <p className="mb-2 text-[11px] text-slate-400">Record each call, meeting, or conversation. Each note saves on its own.</p>
        <div className="rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
          <textarea rows={2} className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:ring-0 focus:outline-none"
            placeholder="What happened? A call, a meeting, a conference conversation…" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); }
              if (e.key === 'Escape' && note) { e.stopPropagation(); setNote(''); }
            }} />
          {note.trim() && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5">
              <span className="text-[11px] text-slate-400">⌘↵ to save</span>
              <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={addNote} disabled={busy}>
                {busy ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Add note'}
              </button>
            </div>
          )}
        </div>
        {data.interactions.length ? (
          <ul className="mt-3 space-y-2">
            {data.interactions.map((i) => (
              <li key={i.id} className="group flex gap-2.5">
                <Avatar user={i.author} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-semibold text-slate-800">{fullName(i.author) || 'Someone'}</span>
                    <span className="text-[11px] text-slate-400" title={fullStamp(i.created_at)}>{stamp(i.created_at)}</span>
                    {(i.author?.id === user.id || user.role === 'admin') && (
                      <button type="button" onClick={() => removeNote(i)} aria-label="Delete note" className="ml-auto text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={13} /></button>
                    )}
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{i.body}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-slate-400">No interactions logged yet.</p>}
      </section>

      {c.tickets.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">On tickets</h4>
          <ul className="space-y-1">
            {c.tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/tickets?open=${t.id}`} className="flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
                  <Ticket size={13} /> {t.opportunity_title} <span className="text-[11px] text-slate-400">· {ticketKind(t)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
