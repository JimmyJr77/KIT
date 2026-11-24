import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BriefcaseBusiness, Loader2, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { parseUtc, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { boxFields, fieldChoices, kitFieldLabel } from '../lib/dealFields.js';
import { AssignmentFields } from './TicketAssignment.jsx';

/** One Pipedrive deal field as an input: its choices when it has them (with "(None)" for blank), else text. */
export function DealFieldInput({ field, value, onChange, id }) {
  const v = value ?? '';
  if (field.options?.length) {
    return (
      <select id={id} className="input" value={v} onChange={(e) => onChange(e.target.value)}>
        <option value="">(None)</option>
        {fieldChoices(field, v).map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
    );
  }
  if (field.field_type === 'date') return <input id={id} type="date" className="input" value={v} onChange={(e) => onChange(e.target.value)} />;
  return <input id={id} className="input" value={v} onChange={(e) => onChange(e.target.value)} />;
}

/** The Gov/Client Lead: a name, with everyone in the CRM offered as you type. Someone new is added to the CRM on save. */
export function GovLeadInput({ value, onChange }) {
  const contacts = useApi('/contacts').data?.contacts || [];
  const names = [...new Set(contacts.map((c) => `${c.first_name} ${c.last_name || ''}`.trim()))];
  return (
    <>
      <input className="input" list="gov-lead-names" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Name" aria-label="Gov/Client Lead" autoComplete="off" />
      <datalist id="gov-lead-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
    </>
  );
}

const DAY = 86400000;
const days = (from, to = new Date()) => (from ? Math.max(0, Math.floor((to - from) / DAY)) : null);
const dayCount = (n) => (n == null ? null : `${n} day${n === 1 ? '' : 's'}`);
const longDate = { month: 'short', day: 'numeric', year: 'numeric' };
const leadOf = (d) => {
  const c = d.people.find((p) => p.is_primary);
  return c ? `${c.first_name} ${c.last_name || ''}`.trim() : '';
};
const formOf = (d) => ({
  opportunity_title: d.opportunity_title || '', organization: d.organization_name || '', gov_lead: leadOf(d),
  pipeline_status: d.pipeline_status || '', value: d.value ?? '',
  assign: { bd_director_id: d.bd_director_id ?? '', territory_id: d.territory_id ?? '', projected_win_date: d.projected_win_date || '', win_date_undetermined: d.win_date_undetermined },
  fields: Object.fromEntries(boxFields(d.fields.deal).map((f) => [f.key, d.custom_fields.find((x) => x.key === f.key)?.value ?? ''])),
});

const Item = ({ label, wide, children }) => (
  <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
    <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
    <dd className="break-words text-sm text-slate-800">{children || <span className="text-slate-400">—</span>}</dd>
  </div>
);

/**
 * The Details box in a pipeline ticket's header: the deal at a glance, as Pipedrive holds it. Read as a grid; with `editing`
 * (the ticket's edit button, for its owner or an admin) every field is an input, saved together. Each field is one KIT
 * shares with the Pipedrive deal, so a save here goes to Pipedrive and a change there comes back on the next pull.
 * `reloadKey` re-reads the ticket when it changes elsewhere in the pane. Edit sits at the box's top right; `footer` (Archive
 * ticket) at its bottom right.
 */
export default function TicketDetailsBox({ ticket, editing, canEdit, reloadKey, onEdit, onDone, onChanged, footer = null }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/tickets/${ticket.id}/details`).then((d) => { setData(d); setForm((f) => (editing && f ? f : formOf(d))); }).catch((e) => setError(e.message));
  }, [ticket.id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) setForm(formOf(data)); setError(''); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Details</h3>;
  if (!data || !form) return <>{heading}<p className="py-2 text-xs text-slate-400">{error || 'Loading…'}</p></>;
  const fields = boxFields(data.fields.deal);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (busy) return;
    if (!form.opportunity_title.trim()) return setError('Opportunity title is required');
    const was = formOf(data);
    setBusy(true);
    setError('');
    try {
      const base = `/tickets/${ticket.id}`;
      if (form.opportunity_title.trim() !== was.opportunity_title) await api.put(`${base}/title`, { title: form.opportunity_title });
      const summary = {};
      if (form.organization.trim() !== was.organization) summary.organization = form.organization;
      if (String(form.value) !== String(was.value)) summary.value = form.value;
      if (form.gov_lead.trim() !== was.gov_lead) summary.gov_lead = form.gov_lead;
      const changed = Object.entries(form.fields).filter(([k, v]) => v !== was.fields[k]);
      if (changed.length) summary.fields = Object.fromEntries(changed);
      if (Object.keys(summary).length) await api.put(`${base}/summary`, summary);
      const assign = Object.fromEntries(Object.entries(form.assign).filter(([k, v]) => String(v ?? '') !== String(was.assign[k] ?? '')).map(([k, v]) => [k, v === '' ? null : v]));
      if (Object.keys(assign).length) await api.put(`${base}/assignment`, assign);
      if (form.pipeline_status !== was.pipeline_status) await api.put(`${base}/stage`, { pipeline_status: form.pipeline_status || null });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      // Whatever was saved shows, even when a later step failed.
      api.get(`/tickets/${ticket.id}/details`).then(setData).catch(() => {});
      onChanged();
    }
  };

  if (editing) {
    return (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {heading}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div className="col-span-2">
            <label className="label">Opportunity title</label>
            <input className="input" autoFocus maxLength={255} value={form.opportunity_title} onChange={(e) => set('opportunity_title', e.target.value)} />
          </div>
          <div>
            <label className="label">Organization</label>
            <input className="input" value={form.organization} onChange={(e) => set('organization', e.target.value)} />
          </div>
          <div>
            <label className="label">Gov/Client Lead</label>
            <GovLeadInput value={form.gov_lead} onChange={(v) => set('gov_lead', v)} />
          </div>
          <div>
            <label className="label">Pipeline status</label>
            <select className="input" value={form.pipeline_status} onChange={(e) => set('pipeline_status', e.target.value)}>
              <option value="">—</option>
              {[...new Set([...data.statuses, ...(form.pipeline_status ? [form.pipeline_status] : [])])].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Value ($)</label>
            <input type="number" min="0" className="input" value={form.value} onChange={(e) => set('value', e.target.value)} />
          </div>
          <AssignmentFields value={form.assign} onChange={(v) => set('assign', v)} />
          {fields.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`box-${f.key}`}>{kitFieldLabel(f.name)}</label>
              <DealFieldInput id={`box-${f.key}`} field={f} value={form.fields[f.key]} onChange={(v) => setForm((x) => ({ ...x, fields: { ...x.fields, [f.key]: v } }))} />
            </div>
          ))}
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">{data.pipedrive_id ? `Pipedrive deal #${data.pipedrive_id} · saved changes sync to Pipedrive` : 'Saved to this ticket'}</span>
          <span className="flex gap-2">
            <button type="button" className="btn px-3 py-1 text-xs" onClick={onDone} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary px-3 py-1 text-xs" disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : null} Save</button>
          </span>
        </div>
      </form>
    );
  }

  const created = parseUtc(data.created_at);
  const closed = parseUtc(data.won_at || data.lost_at);
  const custom = (f) => data.custom_fields.find((x) => x.key === f.key)?.value;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        {heading}
        {canEdit && <button type="button" className="btn-ghost -my-1 px-2 py-1 text-xs" onClick={onEdit}><Pencil size={12} /> Edit</button>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Item label="Opportunity title" wide>{data.opportunity_title}</Item>
        <Item label="Pipeline ticket">#{ticket.id}{data.pipedrive_id ? <span className="text-slate-400"> · Pipedrive deal #{data.pipedrive_id}</span> : null}</Item>
        <Item label="Organization">{data.organization_name}</Item>
        <Item label="Gov/Client Lead">{leadOf(data)}</Item>
        <Item label="Pipeline status">{data.pipeline_status}</Item>
        <Item label="Value">{data.value != null ? usd(data.value).replace('.00', '') : null}</Item>
        <Item label="BD director">{data.bd_director_name}</Item>
        <Item label="Territory">{data.territory_name}</Item>
        <Item label="Projected win date">{data.win_date_undetermined ? 'Undetermined' : data.projected_win_date ? shortDate(data.projected_win_date, longDate) : null}</Item>
        {fields.map((f) => <Item key={f.key} label={kitFieldLabel(f.name)}>{custom(f)}</Item>)}
        <Item label="Date created">{created?.toLocaleDateString('en-US', longDate)}</Item>
        <Item label="Deal age">{dayCount(days(created, closed || undefined))}</Item>
        <Item label="Inactive days">{closed ? null : dayCount(days(parseUtc(data.last_activity_at)))}</Item>
        <Item label="Linked Delivery">
          {data.delivery && (
            <Link to={`/delivery?open=${data.delivery.id}&ticket=${ticket.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><BriefcaseBusiness size={13} /> {data.delivery.name}</Link>
          )}
        </Item>
      </dl>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {footer && <div className="mt-2 flex items-center justify-end gap-2">{footer}</div>}
    </div>
  );
}
