import { useEffect, useState } from 'react';
import { Search, Plus, ContactRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { ago, fullStamp } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { ContactForm, ContactDetail, RelationshipBadge, RELATIONSHIP, contactName, contactLine } from './ContactEditor.jsx';

/** The master CRM: everyone added anywhere in the app, with how well we know them and what tickets they're on. */
export default function Crm() {
  const [q, setQ] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [contacts, setContacts] = useState(null);
  const [open, setOpen] = useState(null); // contact id, or 'new'

  const load = () => api.get(`/contacts?q=${encodeURIComponent(q)}`).then((d) => setContacts(d.contacts));
  useEffect(() => {
    const h = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (contacts || []).filter((c) => minLevel === '' || c.relationship >= Number(minLevel));
  const selected = typeof open === 'number' ? contacts?.find((c) => c.id === open) : null;

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="CRM" subtitle="Everyone we know across our accounts. People added on a ticket show up here too.">
        <select className="input h-9 w-56 py-0" value={minLevel} onChange={(e) => setMinLevel(e.target.value)} aria-label="Relationship">
          <option value="">Any relationship</option>
          {RELATIONSHIP.slice(1).map((r) => <option key={r.level} value={r.level}>{r.level}+ · {r.label}</option>)}
        </select>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search by name, organization, role, or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={() => setOpen('new')} title="New contact" aria-label="New contact"
          className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
      </div>

      {contacts && !shown.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <ContactRound size={28} className="mx-auto mb-2 text-slate-300" />
          {q || minLevel ? 'No one matches.' : 'No contacts yet. Add one with +, or from the People pane on any ticket.'}
        </div>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Name</th><th className="px-4 py-3">Works at · Role</th><th className="px-4 py-3">Relationship</th>
                <th className="px-4 py-3">Tickets</th><th className="px-4 py-3">Last interaction</th><th className="px-4 py-3">Contact</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-semibold text-slate-900">{contactName(c)}</td>
                  <td className="px-4 py-3 text-slate-600">{contactLine(c) || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3"><RelationshipBadge level={c.relationship} /></td>
                  <td className="max-w-56 px-4 py-3 text-slate-600">
                    {c.tickets.length ? <span className="line-clamp-2" title={c.tickets.map((t) => t.opportunity_title).join(', ')}>{c.tickets.map((t) => t.opportunity_title).join(', ')}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500" title={c.last_interaction_at ? fullStamp(c.last_interaction_at) : undefined}>
                    {c.last_interaction_at ? `${ago(c.last_interaction_at)} · ${c.interaction_count}` : <span className="text-slate-300">None</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.email && <div className="truncate">{c.email}</div>}
                    {c.phone && <div>{c.phone}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open === 'new' && (
        <SidePanel title="New contact" subtitle="Add them to tickets from the People pane on any ticket" onClose={() => setOpen(null)}>
          <ContactForm submitLabel="Add contact" onCancel={() => setOpen(null)}
            onSubmit={async (form) => { const r = await api.post('/contacts', form); await load(); setOpen(r.contact.id); }} />
        </SidePanel>
      )}
      {typeof open === 'number' && (
        <SidePanel wide title={selected ? contactName(selected) : 'Contact'} subtitle={selected && (contactLine(selected) || 'No role or organization yet')} onClose={() => { setOpen(null); load(); }}>
          <ContactDetail key={open} contactId={open} onChanged={() => load()} onDeleted={() => { setOpen(null); load(); }} />
        </SidePanel>
      )}
    </div>
  );
}
