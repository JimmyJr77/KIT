import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Search, Ticket, ArrowLeft, Archive, Hourglass } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, shortDate, ticketKind } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import MultiSelect from '../components/MultiSelect.jsx';
import CardNotes from './CardNotes.jsx';
import { TicketTypeChoice, TeamField } from './NewTicketPanel.jsx';
import { useApi } from '../lib/data.js';

const EMPTY_TICKET = { ticket_type: 'bid', opportunity_title: '', organization: '', account_type: '', work_team_id: '', territory_id: '', pipeline_status: '', value: '' };

/** Slide-out panel for creating or editing a priority card (and its ticket). */
/**
 * `teamChoices` ([{ id, name, week }]) is for a new card on the All board: the assignee's teams. With more than one,
 * the panel asks which team the card belongs to.
 */
export default function PriorityPanel({ card, defaultAssignee, users, statuses, teamId, weekStart, teamChoices, readOnly, asWork, onBack: back, onClose: close, onSaved, onNotesChanged }) {
  const { user } = useAuth();
  const meta = useApi('/priorities/meta');
  const territories = useApi('/territories').data?.territories || [];
  const isNew = !card;
  const [ticketMode, setTicketMode] = useState(isNew ? 'existing' : 'new'); // 'new' | 'existing' (new cards only)
  const [ticketId, setTicketId] = useState(card?.ticket_id ?? null);
  // On an existing ticket, the priority can be one of its open next steps (activities) instead of a new one.
  const [openSteps, setOpenSteps] = useState([]);
  const [activityId, setActivityId] = useState(null);
  const [ticket, setTicket] = useState(card ? {
    ticket_type: card.ticket_type || 'bid', opportunity_title: card.opportunity_title, organization: card.organization || '', account_type: card.account_type || '', work_team_id: card.work_team_id ?? '', pipeline_status: card.pipeline_status || '', value: card.value ?? '',
  } : EMPTY_TICKET);
  const [form, setForm] = useState({
    title: card?.title || '',
    due_date: card?.due_date || '',
    checklist: card?.checklist || [],
    completed: !!card?.completed,
    waiting_client: !!card?.waiting_client,
    assignees: card ? card.assignees.map((a) => a.user_id) : [defaultAssignee || user.id],
  });
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingNotes, setPendingNotes] = useState([]);
  const [teamPick, setTeamPick] = useState(teamChoices?.length === 1 ? teamChoices[0].id : '');
  const picked = teamChoices?.find((t) => t.id === Number(teamPick));
  const notesDirty = useRef(false);
  const setNotesDirty = useCallback((v) => { notesDirty.current = v; }, []);

  // Don't lose a half-written note when the panel closes.
  const onClose = useCallback(() => {
    if (notesDirty.current && !confirm('You have an unsaved note. Close and discard it?')) return;
    close();
  }, [close]);
  const onBack = back && (() => { if (!notesDirty.current || confirm('You have an unsaved note. Go back and discard it?')) back(); });

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    setOpenSteps([]);
    setActivityId(null);
    if (!isNew || !ticketId) return;
    let live = true;
    api.get(`/activities?ticket=${ticketId}`).then((d) => live && setOpenSteps(d.activities.filter((a) => !a.done))).catch(() => {});
    return () => { live = false; };
  }, [isNew, ticketId]);

  // Picking a next step fills the priority from it, to change as needed; going back to a new one clears it.
  const pickStep = (a) => {
    setActivityId(a?.id ?? null);
    setForm((f) => ({
      ...f,
      title: a?.subject || '',
      due_date: a?.due_date || '',
      checklist: a ? a.subtasks.map((s) => ({ text: s.text, done: s.done })) : [],
      waiting_client: !!a?.waiting_client,
    }));
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setT = (k, v) => setTicket((t) => ({ ...t, [k]: v }));

  const save = async () => {
    setError('');
    if (!form.assignees.length) return setError('Assign at least one person');
    if (isNew && teamChoices && !picked) return setError('Choose which team this is for');
    if (!ticket.opportunity_title.trim()) return setError(ticketMode === 'existing' && !ticketId ? 'Select an existing ticket' : ticket.ticket_type === 'work' ? 'Title is required' : 'Opportunity Title is required');
    if (notesDirty.current && !confirm('A note you\'re writing hasn\'t been saved and will be discarded. Continue?')) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/priorities/cards', {
          ...form, team_id: picked ? picked.id : teamId, week_start: picked ? picked.week : weekStart, ticket, new_notes: pendingNotes,
          ticket_id: ticketMode === 'existing' ? ticketId : null,
          activity_id: ticketMode === 'existing' && ticketId ? activityId : null,
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

  // Archiving takes the card off the board; it can be restored from the Archive page.
  const archive = async () => {
    await api.put(`/priorities/cards/${card.id}/archive`, { archived: true });
    onSaved();
  };
  const remove = async () => {
    if (!confirm('Delete this priority? Its activity is deleted from the ticket too (unless it came from Pipedrive or is on another week). The ticket is kept.')) return;
    await api.del(`/priorities/cards/${card.id}`);
    onSaved();
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    set('checklist', [...form.checklist, { text: newItem.trim(), done: false }]);
    setNewItem('');
  };

  const ro = readOnly;
  // A brand-new ticket (not an existing one picked from search) chooses Pipeline or Work.
  const creatingTicket = isNew && ticketMode === 'new' && !ticketId && !ro;
  const isWork = ticket.ticket_type === 'work';
  const pipelineClosed = !!meta.data?.pipelineTicketsClosed;
  // With pipeline tickets turned off, a brand-new ticket can only be a work ticket (including after switching back from Existing).
  useEffect(() => {
    if (pipelineClosed && creatingTicket && !isWork) setTicket((t) => ({ ...t, ticket_type: 'work' }));
  }, [pipelineClosed, creatingTicket, isWork]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-[slidein_.2s_ease-out]">
        <style>{'@keyframes slidein{from{transform:translateX(100%)}to{transform:none}}'}</style>
        {onBack && (
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-5 py-2 text-left text-xs font-medium text-brand-700 hover:bg-brand-50">
            <ArrowLeft size={14} /> Back to {ticketKind(card).toLowerCase()}
          </button>
        )}
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold">{isNew ? (asWork ? 'New work' : 'New priority') : card.is_planned ? 'Priority details' : 'Work details'}</h2>
            {isNew && asWork && <p className="text-xs text-slate-500">Planning is closed, so this is tracked as work: an accomplishment or new task.</p>}
            {!isNew && (
              <p className="text-xs text-slate-500">
                {ticketKind(card)} #{card.ticket_id} · {card.is_planned ? 'Priority (planned)' : 'Work (added after planning closed)'}
              </p>
            )}
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {isNew && !ro && teamChoices?.length > 1 && (
            <Field label="Team">
              <select className="input" value={teamPick} onChange={(e) => setTeamPick(e.target.value)}>
                <option value="">Choose a team…</option>
                {teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          {/* Ticket */}
          <section className="space-y-3 rounded-lg bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Ticket size={13} /> {creatingTicket ? 'New ticket' : ticketKind(ticket)}</span>
              {isNew && !ro && (
                <div className="flex rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200">
                  {[['new', 'New ticket'], ['existing', 'Existing ticket']].map(([m, l]) => (
                    <button key={m} type="button" onClick={() => { setTicketMode(m); setTicketId(null); setTicket(EMPTY_TICKET); if (activityId) pickStep(null); }}
                      className={`rounded px-2 py-1 ${ticketMode === m ? 'bg-brand-600 text-white' : 'text-slate-600'}`}>{l}</button>
                  ))}
                </div>
              )}
            </div>
            {isNew && ticketMode === 'existing' && !ticketId ? (
              <TicketSearch onPick={(t) => {
                setTicketId(t.id);
                setTicket({ ticket_type: t.ticket_type || 'bid', opportunity_title: t.opportunity_title, organization: t.organization || '', account_type: t.account_type || '', work_team_id: t.work_team_id ?? '', pipeline_status: t.pipeline_status || '', value: t.value ?? '' });
              }} />
            ) : (
              <>
                {!isNew && <p className="text-xs text-slate-500">Ticket changes apply to every priority card on this ticket.</p>}
                {isNew && ticketId && (
                  <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => { setTicketId(null); setTicket(EMPTY_TICKET); if (activityId) pickStep(null); }}>
                    ← Choose a different ticket
                  </button>
                )}
                {creatingTicket && <TicketTypeChoice value={ticket.ticket_type} onChange={(k) => setT('ticket_type', k)} pipelineClosed={pipelineClosed} />}
                <Field label={isWork ? 'Title *' : 'Opportunity title *'}>
                  <input className="input" value={ticket.opportunity_title} onChange={(e) => setT('opportunity_title', e.target.value)} disabled={ro} autoFocus={isNew} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Organization">
                    <input className="input" value={ticket.organization} onChange={(e) => setT('organization', e.target.value)} disabled={ro} />
                  </Field>
                  <TeamField isWork={isWork} value={ticket.work_team_id} onChange={(v) => setT('work_team_id', v)} teams={meta.data?.teams} disabled={ro} />
                </div>
                {creatingTicket && !isWork && (
                  <Field label="Territory">
                    <select className="input" value={ticket.territory_id} onChange={(e) => setT('territory_id', e.target.value)}>
                      <option value="">Default for this person</option>
                      {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                )}
                {!isWork && ticket.ticket_type !== 'account' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pipeline status">
                    <select className="input" value={ticket.pipeline_status} onChange={(e) => setT('pipeline_status', e.target.value)} disabled={ro}>
                      <option value="">—</option>
                      {/* A ticket on another pipeline keeps its own stage as a choice. */}
                      {[...new Set([...statuses, ...(ticket.pipeline_status ? [ticket.pipeline_status] : [])])].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Value ($)">
                    <input type="number" min="0" className="input" value={ticket.value} onChange={(e) => setT('value', e.target.value)} disabled={ro} />
                  </Field>
                </div>
                )}
              </>
            )}
          </section>

          {isNew && !ro && ticketId && openSteps.length > 0 && (
            <Field label="Open next steps on this ticket">
              <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200" role="radiogroup" aria-label="Next step">
                {[null, ...openSteps].map((a) => {
                  const on = (a?.id ?? null) === activityId;
                  return (
                    <li key={a?.id ?? 'new'}>
                      <button type="button" role="radio" aria-checked={on} onClick={() => pickStep(a)}
                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-1 ${on ? 'bg-brand-600 ring-brand-600' : 'ring-slate-300'}`} />
                        {a ? (
                          <span className="min-w-0">
                            <span className="block font-medium">{a.rank === 1 && <span className="mr-1 text-xs font-semibold text-brand-700">Next ·</span>}{a.subject}</span>
                            <span className="block text-xs text-slate-500">
                              {[a.due_date ? `Due ${shortDate(a.due_date)}` : 'No date', a.subtasks.length ? `${a.subtasks.length} subtask${a.subtasks.length === 1 ? '' : 's'}` : null,
                                a.waiting_client ? 'Waiting on client' : null, a.cards.length ? `On ${a.cards.length} board${a.cards.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        ) : <span className="text-slate-600">A new next step</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {activityId && <p className="mt-1 text-xs text-slate-500">Changes below are saved to this next step on the ticket.</p>}
            </Field>
          )}

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
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Due date">
              <input type="date" className="input" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} disabled={ro} />
            </Field>
            <button type="button" aria-pressed={form.waiting_client} disabled={ro} onClick={() => set('waiting_client', !form.waiting_client)}
              title="We’re waiting on the client. Shown on the card and its ticket, and not counted against completion."
              className={`flex h-[38px] items-center justify-center gap-1.5 rounded-md text-sm ring-1 transition ${form.waiting_client ? 'bg-sky-50 text-sky-800 ring-sky-300' : 'bg-white text-slate-600 ring-slate-300 hover:text-slate-900'}`}>
              <Hourglass size={14} className={form.waiting_client ? 'text-sky-600' : ''} /> Waiting on client
            </button>
          </div>
          <Field label={`Subtasks${form.checklist.length ? ` (${form.checklist.filter((c) => c.done).length}/${form.checklist.length})` : ''}`}>
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
                <input className="input" placeholder="Add a subtask…" value={newItem} onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())} />
                <button type="button" className="btn" onClick={addItem}><Plus size={15} /></button>
              </div>
            )}
          </Field>
          <Field label="Comments · also in the ticket’s history">
            <CardNotes cardId={card?.id ?? null} initial={card?.notes || []} user={user} readOnly={ro}
              onDirtyChange={setNotesDirty} onPendingChange={setPendingNotes} onChanged={onNotesChanged} />
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
              <button className="btn-primary flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? (asWork ? 'Add work' : 'Add priority') : 'Save changes'}</button>
              {!isNew && !ro && <button className="btn" onClick={archive} title="Archive: take it off the board (restore it from the Archive page)" aria-label="Archive this priority card"><Archive size={15} /></button>}
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
