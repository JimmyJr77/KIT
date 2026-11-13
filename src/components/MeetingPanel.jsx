import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, Target, Paperclip, Upload, Download, Trash2, X, ContactRound, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, shortDate, todayIso } from '../lib/format.js';
import MultiSelect from './MultiSelect.jsx';
import { RelationshipBadge } from '../pages/ContactEditor.jsx';

const personName = (p) => `${p.first_name} ${p.last_name || ''}`.trim();
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const meetingTime = (t) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Time to be set');
export const meetingWhen = (m) => `${shortDate(m.meeting_date, { weekday: 'short', month: 'short', day: 'numeric' })}${m.meeting_time ? ` · ${meetingTime(m.meeting_time)}` : ''}`;

/**
 * The meeting scheduler: who a meeting is with, when, where, what we want out of it, and its files. It's the contents of a
 * drawer: pass it as a SidePanel's `drawer`, so it pops out of the left edge of the pane it was opened from (an event, or a
 * marketing request), as a pipeline ticket's tools do. Who it's with comes from the CRM; a name the CRM doesn't have
 * is filled in here and added to the CRM when the meeting is saved. `event` and `ticket` tie a new meeting to where it was opened.
 */
export default function MeetingPanel({ meeting = null, event = null, ticket = null, opportunities = [], onClose, onSaved }) {
  const { user } = useAuth();
  const [f, setF] = useState(() => (meeting ? {
    title: meeting.title, meeting_date: meeting.meeting_date, meeting_time: meeting.meeting_time || '', place: meeting.place || '',
    objectives: meeting.objectives || meeting.notes || '', ticket_id: meeting.ticket_id || '', contact_ids: meeting.people.map((p) => p.id), new_people: [], user_ids: meeting.users.map((u) => u.id),
  } : {
    title: '', meeting_date: event?.date_from || todayIso(), meeting_time: '', place: '', objectives: '', ticket_id: ticket?.id || '', contact_ids: [], new_people: [], user_ids: [user.id],
  }));
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState(meeting?.files || []);
  const [queued, setQueued] = useState([]); // files chosen but not uploaded yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/contacts').then((d) => setContacts(d.contacts));
    api.get('/users').then((d) => setUsers(d.users.filter((u) => u.active !== 0)));
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setNew = (i, k, v) => setF((x) => ({ ...x, new_people: x.new_people.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));
  const addNew = (name = '') => {
    const [first = '', ...rest] = name.trim().split(/\s+/);
    setF((x) => ({ ...x, new_people: [...x.new_people, { first_name: first, last_name: rest.join(' '), organization: '', role: '', email: '', phone: '' }] }));
  };
  const chosen = f.contact_ids.map((id) => contacts.find((c) => c.id === id) || meeting?.people.find((p) => p.id === id)).filter(Boolean);
  const ready = f.title.trim() && f.meeting_date && (f.contact_ids.length || f.new_people.some((p) => p.first_name.trim()));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { ...f, event_id: meeting ? meeting.event_id : event?.id ?? null };
      let { meeting: saved } = await (meeting ? api.put(`/meetings/${meeting.id}`, body) : api.post('/meetings', body));
      for (const file of queued) {
        const form = new FormData();
        form.append('file', file);
        ({ meeting: saved } = await api.post(`/meetings/${saved.id}/files`, form));
      }
      onSaved(saved);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const removeFile = async (file) => {
    if (!confirm(`Delete “${file.name}”?`)) return;
    try { const r = await api.del(`/meetings/files/${file.id}`); setFiles(r.meeting.files); } catch (e) { setError(e.message); }
  };

  const where = [event?.name || meeting?.event_name, ticket?.opportunity_title].filter(Boolean).join(' · ');
  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-semibold"><CalendarClock size={16} className="text-brand-600" /> {meeting ? 'Meeting' : 'Schedule a meeting'}</h3>
          <div className="truncate text-xs text-slate-500">{where || 'Who you’re meeting, when and where'}</div>
        </div>
        <button type="button" className="btn-ghost p-1.5" onClick={onClose} aria-label="Close the meeting scheduler"><X size={18} /></button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="space-y-5">
        <div>
          <label className="label">Meeting *</label>
          <input className="input" autoFocus placeholder="e.g. Coffee with the PEO Digital team" value={f.title} onChange={set('title')} />
        </div>

        <Part icon={ContactRound} title="Who">
          <MultiSelect options={contacts.map((c) => ({ value: c.id, label: personName(c), sub: [c.role, c.organization].filter(Boolean).join(', ') || undefined }))}
            value={f.contact_ids} onChange={(v) => setF((x) => ({ ...x, contact_ids: v }))} onCreate={addNew} placeholder="Find people in the CRM, or type a new name…" />
          {chosen.length > 0 && (
            <ul className="mt-2 space-y-1">
              {chosen.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="font-semibold text-slate-800">{personName(c)}</span>
                  <span className="text-slate-500">{[c.role, c.organization].filter(Boolean).join(' · ')}</span>
                  {c.relationship != null && <RelationshipBadge level={c.relationship} />}
                  <Link to={c.organization ? `/crm?${new URLSearchParams({ tab: 'contacts', organization: c.organization })}` : '/crm'} target="_blank" className="ml-auto text-brand-700 hover:underline">In the CRM</Link>
                </li>
              ))}
            </ul>
          )}
          {f.new_people.map((p, i) => (
            <div key={i} className="mt-2 rounded-md border border-brand-200 bg-brand-50/40 p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-600">
                <span className="flex items-center gap-1"><UserPlus size={12} /> New person: added to the CRM when you save</span>
                <button type="button" className="text-slate-400 hover:text-slate-700" aria-label="Remove this person"
                  onClick={() => setF((x) => ({ ...x, new_people: x.new_people.filter((_, j) => j !== i) }))}><X size={13} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input h-8 text-sm" placeholder="First name *" value={p.first_name} onChange={(e) => setNew(i, 'first_name', e.target.value)} aria-label="First name" />
                <input className="input h-8 text-sm" placeholder="Last name" value={p.last_name} onChange={(e) => setNew(i, 'last_name', e.target.value)} aria-label="Last name" />
                <input className="input h-8 text-sm" placeholder="Organization" value={p.organization} onChange={(e) => setNew(i, 'organization', e.target.value)} aria-label="Organization" />
                <input className="input h-8 text-sm" placeholder="Title or role" value={p.role} onChange={(e) => setNew(i, 'role', e.target.value)} aria-label="Title or role" />
                <input className="input h-8 text-sm" type="email" placeholder="Email" value={p.email} onChange={(e) => setNew(i, 'email', e.target.value)} aria-label="Email" />
                <input className="input h-8 text-sm" type="tel" placeholder="Phone" value={p.phone} onChange={(e) => setNew(i, 'phone', e.target.value)} aria-label="Phone" />
              </div>
            </div>
          ))}
          <button type="button" className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => addNew()}><UserPlus size={12} /> Add someone who isn’t in the CRM</button>
          <div className="mt-3">
            <label className="label">From Knexus</label>
            <MultiSelect options={users.map((u) => ({ value: u.id, label: fullName(u), sub: u.title || undefined }))}
              value={f.user_ids} onChange={(v) => setF((x) => ({ ...x, user_ids: v }))} placeholder="Who’s in the meeting from our side…" />
          </div>
        </Part>

        <Part icon={CalendarClock} title="When">
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Date *</span><input type="date" className="input" value={f.meeting_date} onChange={set('meeting_date')} /></label>
            <label><span className="label">Time</span><input type="time" className="input" value={f.meeting_time} onChange={set('meeting_time')} /></label>
          </div>
          {event && (f.meeting_date < event.date_from || f.meeting_date > (event.date_to || event.date_from)) && (
            <p className="mt-1 text-[11px] text-amber-700">That’s outside {event.name}’s dates.</p>
          )}
        </Part>

        <Part icon={MapPin} title="Where">
          <input className="input" placeholder="Booth 214, the hotel lobby, a restaurant, their office…" value={f.place} onChange={set('place')} aria-label="Where" />
        </Part>

        <Part icon={Target} title="Objectives">
          <textarea className="input min-h-24" placeholder="What you want out of the meeting: what to learn, what to ask for, the next step you’re after." value={f.objectives} onChange={set('objectives')} aria-label="Objectives" />
          {opportunities.length > 0 && (
            <label className="mt-2 block"><span className="label">About an opportunity</span>
              <select className="input" value={f.ticket_id} onChange={set('ticket_id')}>
                <option value="">None</option>
                {opportunities.map((t) => <option key={t.id} value={t.id}>{t.title || t.opportunity_title}</option>)}
              </select>
            </label>
          )}
        </Part>

        <Part icon={Paperclip} title="Files">
          {(files.length > 0 || queued.length > 0) && (
            <ul className="mb-2 space-y-1">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{file.name} <span className="text-xs text-slate-400">{bytes(file.size)}</span></span>
                  <a href={`/api/meetings/files/${file.id}`} className="text-slate-500 hover:text-brand-700" title="Download" aria-label={`Download ${file.name}`}><Download size={14} /></a>
                  <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => removeFile(file)} title="Delete" aria-label={`Delete ${file.name}`}><Trash2 size={14} /></button>
                </li>
              ))}
              {queued.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{file.name} <span className="text-xs text-slate-400">{bytes(file.size)} · uploads when you save</span></span>
                  <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => setQueued((q) => q.filter((_, j) => j !== i))} aria-label={`Remove ${file.name}`}><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500 hover:border-brand-500">
            <Upload size={16} className="text-slate-400" /> Add an agenda, deck or read-ahead
            <input type="file" multiple className="hidden" onChange={(e) => { setQueued((q) => [...q, ...e.target.files]); e.target.value = ''; }} />
          </label>
        </Part>
      </div>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <span className="text-xs text-red-600">{error}</span>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !ready}>{busy ? 'Saving…' : meeting ? 'Save meeting' : 'Add to the schedule'}</button>
        </div>
      </footer>
    </>
  );
}

function Part({ icon: Icon, title, children }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Icon size={13} /> {title}</h3>
      {children}
    </section>
  );
}
