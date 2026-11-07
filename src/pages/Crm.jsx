import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus, ContactRound, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { ago, fullStamp } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { ContactForm, ContactDetail, RelationshipBadge, RELATIONSHIP, contactName, contactLine } from './ContactEditor.jsx';
import AccountObjectives from './AccountObjectives.jsx';

/**
 * The CRM: customer contacts, and the account development objectives BD directors are working on with each customer.
 * ?organization=<name> shows only what has that name as whole words in any field, on either tab, until its chip is cleared.
 */
export default function Crm() {
  const [params, setParams] = useSearchParams();
  const organization = params.get('organization') || '';
  const clearOrganization = () => setParams((p) => { p.delete('organization'); return p; }, { replace: true });
  // ?tab=objectives opens on that tab (links from the dashboard); otherwise the tab last used.
  const [tab, setTabState] = useState(() => {
    if (['contacts', 'objectives'].includes(params.get('tab'))) return params.get('tab');
    try { return localStorage.getItem('kit.crm.tab') || 'contacts'; } catch { return 'contacts'; }
  });
  const setTab = (t) => { setTabState(t); try { localStorage.setItem('kit.crm.tab', t); } catch { /* ignore */ } };
  const tabs = (
    <>
      <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="tablist">
        {[['contacts', 'Contacts'], ['objectives', 'Account objectives']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded px-3 ${tab === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
        ))}
      </div>
      {organization && (
        <button type="button" onClick={clearOrganization} title="Show every organization" aria-label={`Stop filtering to ${organization}`}
          className="flex h-9 items-center gap-1.5 rounded-md bg-brand-50 px-2.5 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:ring-brand-500">
          {organization} <X size={14} />
        </button>
      )}
    </>
  );
  if (tab === 'objectives') {
    return (
      <div className="space-y-5 p-8">
        <PageHeader title="CRM" subtitle="Account objectives: what each BD director is working toward with a customer, and by when.">{tabs}</PageHeader>
        <AccountObjectives organization={organization} />
      </div>
    );
  }
  return <Contacts tabs={tabs} organization={organization} />;
}

/** The master contact list: everyone added anywhere in the app, with how well we know them and what tickets they're on. */
function Contacts({ tabs, organization }) {
  const [q, setQ] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [contacts, setContacts] = useState(null);
  const [open, setOpen] = useState(null); // contact id, or 'new'

  const load = () => api.get(`/contacts?${new URLSearchParams({ q, filter: organization })}`).then((d) => setContacts(d.contacts));
  useEffect(() => {
    const h = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [q, organization]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (contacts || []).filter((c) => minLevel === '' || c.relationship >= Number(minLevel));
  const selected = typeof open === 'number' ? contacts?.find((c) => c.id === open) : null;

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="CRM" subtitle="Everyone we know across our accounts. People added on a ticket show up here too.">
        {tabs}
        <select className="input h-9 w-56 py-0" value={minLevel} onChange={(e) => setMinLevel(e.target.value)} aria-label="Relationship">
          <option value="">Any relationship</option>
          {RELATIONSHIP.slice(1).map((r) => <option key={r.level} value={r.level}>{r.level}+ · {r.label}</option>)}
        </select>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search every field: name, organization, role, email, notes, tickets…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={() => setOpen('new')} title="New contact" aria-label="New contact"
          className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
      </div>

      {contacts && !shown.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <ContactRound size={28} className="mx-auto mb-2 text-slate-300" />
          {q || minLevel || organization ? 'No one matches.' : 'No contacts yet. Add one with +, or from the People pane on any ticket.'}
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
