import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import SidePanel from '../components/SidePanel.jsx';
import { useAuth } from '../lib/auth.jsx';
import { AssignmentFields } from './TicketAssignment.jsx';

const TYPES = [
  ['bid', 'Pipeline Ticket', 'To win a contract. Has a value and pipeline status.'],
  ['work', 'Work Ticket', 'Any other work. No value or pipeline status.'],
];

/** A ticket's team: chosen on a work ticket; a pipeline ticket always belongs to BD. */
export function TeamField({ isWork, value, onChange, teams, disabled }) {
  return (
    <div>
      <label className="label">Team</label>
      {isWork ? (
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {(teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : <input className="input" value="BD" disabled aria-label="Team" />}
    </div>
  );
}

export const PIPELINE_CLOSED_HINT = 'An admin has turned off creating new pipeline tickets.';

/** Choosing a new ticket's type. With `pipelineClosed` (an admin's setting) Pipeline Ticket is greyed out. */
export function TicketTypeChoice({ value, onChange, pipelineClosed }) {
  return (
    <div>
      <span className="label">Ticket type</span>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Ticket type">
        {TYPES.map(([k, l, hint]) => {
          const off = k === 'bid' && pipelineClosed;
          return (
            <button key={k} type="button" role="radio" aria-checked={value === k} disabled={off} title={off ? PIPELINE_CLOSED_HINT : undefined} onClick={() => onChange(k)}
              className={`rounded-lg border px-3 py-2 text-left transition ${off ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60' : value === k ? 'border-brand-500 bg-white ring-2 ring-brand-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <div className={`text-sm font-semibold ${!off && value === k ? 'text-brand-700' : 'text-slate-700'}`}>{l}</div>
              <div className="text-[11px] leading-snug text-slate-500">{off ? 'Turned off by an admin.' : hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Create a ticket on its own, without a priority. With `bidOnly` (the BD Pipeline) it's always a Pipeline Ticket,
 * starting in `stage` when given, on `pipeline` ({ id, statuses }; KIT's own when not given). Calls onCreated(ticket) once saved.
 */
export default function NewTicketPanel({ bidOnly, stage = '', pipeline = null, onClose, onCreated }) {
  const meta = useApi('/priorities/meta');
  const { user } = useAuth();
  const [form, setForm] = useState({ ticket_type: 'bid', opportunity_title: '', organization: '', work_team_id: user.teams?.length === 1 ? user.teams[0].id : '', pipeline_status: stage, value: '' });
  // A BD director creating a pipeline ticket directs it by default, in their territory when they cover just one.
  const [assign, setAssign] = useState({
    bd_director_id: user.teams?.some((t) => t.name === 'BD') ? user.id : '',
    territory_id: user.territories?.length === 1 ? user.territories[0].id : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isWork = form.ticket_type === 'work';
  const dirty = form.opportunity_title || form.organization || form.value;
  const pipelineClosed = !!meta.data?.pipelineTicketsClosed;
  // With pipeline tickets turned off, a new ticket here can only be a work ticket.
  useEffect(() => { if (pipelineClosed && !bidOnly) set('ticket_type', 'work'); }, [pipelineClosed, bidOnly]);

  const save = async () => {
    if (busy) return;
    if (!form.opportunity_title.trim()) return setError(isWork ? 'Title is required' : 'Opportunity title is required');
    setBusy(true);
    setError('');
    try {
      const { ticket } = await api.post('/tickets', isWork ? form
        : { ...form, ...assign, bd_director_id: assign.bd_director_id || null, territory_id: assign.territory_id || null, pipeline_id: pipeline?.id ?? null });
      onCreated(ticket);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const close = () => { if (!dirty || confirm('Discard this new ticket?')) onClose(); };

  return (
    <SidePanel title={bidOnly ? 'New pipeline ticket' : 'New ticket'} subtitle="Add priorities and comments once it’s created." onClose={close}
      footer={(
        <div className="space-y-2">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" onClick={save} disabled={busy}>{busy ? 'Creating…' : `Create ${isWork ? 'work' : 'bid'} ticket`}</button>
        </div>
      )}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {!bidOnly && <TicketTypeChoice value={form.ticket_type} onChange={(k) => set('ticket_type', k)} pipelineClosed={pipelineClosed} />}
        <div>
          <label className="label">{isWork ? 'Title *' : 'Opportunity title *'}</label>
          <input className="input" autoFocus value={form.opportunity_title} onChange={(e) => set('opportunity_title', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Organization</label>
            <input className="input" value={form.organization} onChange={(e) => set('organization', e.target.value)} />
          </div>
          <TeamField isWork={isWork} value={form.work_team_id} onChange={(v) => set('work_team_id', v)} teams={meta.data?.teams} />
        </div>
        {!isWork && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Pipeline status</label>
              <select className="input" value={form.pipeline_status} onChange={(e) => set('pipeline_status', e.target.value)}>
                <option value="">—</option>
                {(pipeline?.statuses || meta.data?.pipelineStatuses || []).map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Value ($)</label>
              <input type="number" min="0" className="input" value={form.value} onChange={(e) => set('value', e.target.value)} />
            </div>
          </div>
        )}
        {!isWork && <div className="grid grid-cols-2 gap-3"><AssignmentFields value={assign} onChange={setAssign} /></div>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </SidePanel>
  );
}
