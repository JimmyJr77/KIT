import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, Check, TriangleAlert, Send, Eye, ChevronRight, Radio } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { stamp } from '../lib/format.js';
import MultiSelect from './MultiSelect.jsx';

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const when = (iso) => stamp(iso.slice(0, 19).replace('T', ' '));
/** "1,623 deals (12 new) · 1,157 contacts…" from a pull result. */
function summary(r) {
  const part = (added, updated, word, many) => {
    const n = (added || 0) + (updated || 0);
    return n ? `${plural(n, word, many)}${added && updated ? ` (${added.toLocaleString()} new)` : ''}` : null;
  };
  return [
    r.pipelines && plural(r.pipelines, 'new pipeline'), part(r.dealsAdded, r.dealsUpdated, 'deal'), part(r.contactsAdded, r.contactsUpdated, 'contact'),
    part(r.activitiesAdded, r.activitiesUpdated, 'activity', 'activities'), part(r.notesAdded, r.notesUpdated, 'note'),
    r.filesAdded && plural(r.filesAdded, 'new file'), r.filesDeleted && plural(r.filesDeleted, 'file') + ' deleted in Pipedrive',
  ].filter(Boolean).join(' · ');
}

/** Pipedrive's status, checked every two seconds while a pull or send runs. */
function usePipedrive() {
  const status = useApi('/pipedrive');
  const s = status.data;
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setTimeout(() => status.reload(), 2000);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  return status;
}

const PULLS = {
  all: { button: 'Pull everything', what: 'every deal in Pipedrive' },
  team: { button: 'Pull my team’s deals', what: 'the deals owned by everyone on the teams you lead' },
  mine: { button: 'Pull my deals', what: 'the deals you own in Pipedrive' },
};

function Result({ ok, children }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{children}</div>
  );
}

/**
 * Pipedrive → KIT for one scope: 'all' (admins), 'team' (team leads) or 'mine' (anyone). Pipedrive wins on the fields it
 * holds, except ones changed in KIT that haven't been sent yet; KIT's own work on a ticket is kept.
 */
export function PipedrivePull({ scope, status }) {
  const [error, setError] = useState('');
  const s = status.data;
  const last = scope === 'all' ? s?.last : s?.mine;
  const p = PULLS[scope];

  const pull = async () => {
    setError('');
    try { await api.post('/pipedrive/pull', { scope }); status.reload(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Brings {p.what} into KIT: deals as pipeline tickets, with their people, activities, notes and files. Pipedrive wins on the fields it holds,
        except ones changed in KIT that an admin hasn&apos;t sent yet. KIT&apos;s own work on a ticket is kept.
        {scope === 'all' ? ' Everything is also pulled every night.' : ' Everything is pulled every night anyway; pull here to get today’s changes now.'}
      </p>
      {s && !s.configured && <NotSetUp admin={scope === 'all'} server={s.server} />}
      {last && !s?.running && (
        <Result ok={last.ok}>
          <div className="flex items-center gap-1.5 font-medium">
            {last.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
            {last.ok ? 'Last pulled' : 'Last pull failed'} {when(last.at)}{last.by ? (scope === 'all' ? ` by ${last.by}` : '') : ' (nightly)'}
            {scope !== 'all' && last.scope === 'team' && ' · your team’s deals'}
          </div>
          {last.ok ? (
            <>
              <div className="mt-0.5 text-xs">{summary(last.result) || 'Nothing changed.'}</div>
              {last.result.accountsCreated?.length > 0 && (
                <div className="mt-1 text-xs">New accounts, waiting to be activated: {last.result.accountsCreated.join(', ')}</div>
              )}
            </>
          ) : <div className="mt-0.5 text-xs">{last.error}</div>}
        </Result>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={pull} disabled={!s?.configured || s?.running}>
          {s?.running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {p.button}
        </button>
        {s?.running && <span className="text-sm text-slate-500">Pipedrive is busy ({s.label}): {s.phase}…</span>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** What's missing when the server has no Pipedrive API token, and (for admins) where to add it. */
function NotSetUp({ admin, server }) {
  return (
    <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <p className="font-medium">Pipedrive isn&apos;t set up on this server yet: it has no Pipedrive API token.</p>
      {admin ? (
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs">
          <li>In Pipedrive, open Settings › Personal preferences › API and copy your API token (an admin&apos;s, so every deal is visible).</li>
          <li>In Render, open the {server ? <b>{server}</b> : 'KIT API'} service › Environment, add <code>PIPEDRIVE_API_KEY</code> with that token, and save.</li>
          <li>Render restarts the service. Reload this page and this panel turns on.</li>
        </ol>
      ) : <p className="text-xs">An admin needs to add the API token to the server.</p>}
    </div>
  );
}

/** A panel with one pull, for the team lead and member pages. */
export function PipedrivePullPanel({ scope }) {
  const status = usePipedrive();
  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><RefreshCw size={16} className="text-brand-600" /> Pipedrive</h2>
      <PipedrivePull scope={scope} status={status} />
    </div>
  );
}

// ---- Admins: sending to Pipedrive

const KINDS = [
  { key: 'deals', label: 'Deal fields', hint: 'Title, value, stage (won or lost too), lost reason, probability, expected close date, owner, Account' },
  { key: 'labels', label: 'Tags', hint: 'Pipedrive’s labels only; tags made in KIT stay in KIT' },
  { key: 'notes', label: 'Notes', hint: 'Comments added in KIT, and Pipedrive notes edited, pinned or deleted in KIT' },
  { key: 'activities', label: 'Activities', hint: 'Added, edited or deleted in KIT' },
  { key: 'files', label: 'Files', hint: 'Uploads go as files; linked documents as a note with the link' },
  { key: 'products', label: 'Products', hint: 'Matched by name to Pipedrive’s product catalog' },
  { key: 'followers', label: 'Followers', hint: 'Added to the deal; nobody is taken off' },
  { key: 'contacts', label: 'People', hint: 'New contacts become Pipedrive people; added to the deal as participants' },
];
const SENT = {
  deals: 'deal', labels: ['deal’s tags', 'deals’ tags'], notesAdded: 'new note', notesUpdated: 'edited note', notesDeleted: 'deleted note',
  activitiesAdded: ['new activity', 'new activities'], activitiesUpdated: ['edited activity', 'edited activities'], activitiesDeleted: ['deleted activity', 'deleted activities'],
  filesAdded: 'file', filesDeleted: 'deleted file', products: 'product', followers: 'follower', peopleAdded: 'new person', contactPersons: 'contact person',
  participantsAdded: 'participant',
};
const sentSummary = (sent) => Object.entries(sent || {}).map(([k, n]) => {
  const w = SENT[k] || k;
  return Array.isArray(w) ? plural(n, w[0], w[1]) : plural(n, w);
}).join(' · ');

const MODES = [
  { key: 'off', label: 'Do not send', title: 'Never sent to Pipedrive' },
  { key: 'manual', label: 'On push', title: 'Sent when you push from here, after a preview' },
  { key: 'auto', label: 'Auto sync', title: 'Sent on its own a minute or so after it changes, and when you push from here. Deletions only go when you push.' },
];

/** Do not send, On push or Auto sync for one kind of change. */
function ModeChoice({ mode, onChange, label, hint, disabled }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm text-slate-700">
      <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
      <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} title={m.title} disabled={disabled}
            onClick={() => mode !== m.key && onChange(m.key)}
            className={`whitespace-nowrap px-2 py-1 text-xs font-medium ${mode === m.key ? (m.key === 'auto' ? 'bg-brand-600 text-white' : m.key === 'manual' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600') : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One part of the preview: a count, opening to the list. */
function Section({ title, count, children, note }) {
  if (!count) return <div className="py-1 text-sm text-slate-400">{title}: nothing to send</div>;
  return (
    <details className="group py-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-slate-800">
        <ChevronRight size={14} className="text-slate-400 transition-transform group-open:rotate-90" />
        <span className="font-medium">{title}</span><span className="text-slate-500">· {count.toLocaleString()}</span>
        {note && <span className="text-xs text-slate-400">{note}</span>}
      </summary>
      <ul className="mt-1 ml-5 max-h-64 space-y-1 overflow-y-auto text-xs text-slate-600">{children}</ul>
    </details>
  );
}
const more = (list) => (list.count > list.items.length ? <li className="text-slate-400">…and {(list.count - list.items.length).toLocaleString()} more</li> : null);
const Item = ({ title, children }) => <li><span className="text-slate-400">{title}:</span> {children}</li>;

function Preview({ p }) {
  const n = (x) => x?.count || 0;
  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3 py-1">
      <div className="py-1.5 text-xs text-slate-500">Across {plural(p.tickets, 'Pipedrive deal')}. Nothing has been sent yet.</div>
      {p.deals && (
        <Section title="Deal fields" count={n(p.deals)}>
          {p.deals.items.map((d) => (
            <Item key={d.ticket_id} title={d.title}>{d.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}</Item>
          ))}
          {more(p.deals)}
        </Section>
      )}
      {p.labels && (
        <Section title="Tags" count={n(p.labels)}>
          {p.labels.items.map((l) => <Item key={l.ticket_id} title={l.title}>{l.labels.join(', ') || 'no tags'}</Item>)}
          {more(p.labels)}
        </Section>
      )}
      {p.notes && (
        <Section title="Notes" count={n(p.notes.add) + n(p.notes.edit) + n(p.notes.remove)}
          note={[n(p.notes.add) && `${n(p.notes.add)} new`, n(p.notes.edit) && `${n(p.notes.edit)} edited`, n(p.notes.remove) && `${n(p.notes.remove)} deleted`].filter(Boolean).join(', ')}>
          {p.notes.add.items.map((m) => <Item key={m.id} title={m.title}>{m.text}{m.by ? ` (${m.by})` : ''}</Item>)}
          {p.notes.edit.items.map((m) => <Item key={m.id} title={`${m.title} · edited`}>{m.text}</Item>)}
          {n(p.notes.remove) > 0 && <li>{plural(n(p.notes.remove), 'note')} deleted in KIT</li>}
        </Section>
      )}
      {p.activities && (
        <Section title="Activities" count={n(p.activities.add) + n(p.activities.edit) + n(p.activities.remove)}
          note={[n(p.activities.add) && `${n(p.activities.add)} new`, n(p.activities.edit) && `${n(p.activities.edit)} edited`, n(p.activities.remove) && `${n(p.activities.remove)} deleted`].filter(Boolean).join(', ')}>
          {p.activities.add.items.map((a) => <Item key={a.id} title={a.title}>{a.text}{a.due ? ` (due ${a.due})` : ''}</Item>)}
          {more(p.activities.add)}
          {p.activities.edit.items.map((a) => (
            <Item key={a.id} title={`${a.title} · ${a.text}`}>{a.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}</Item>
          ))}
          {n(p.activities.remove) > 0 && <li>{plural(n(p.activities.remove), 'activity', 'activities')} deleted in KIT</li>}
        </Section>
      )}
      {p.files && (
        <Section title="Files" count={n(p.files.add) + n(p.files.remove)}>
          {p.files.add.items.map((f) => <Item key={f.id} title={f.title}>{f.text}{f.link ? ' (link)' : ''}</Item>)}
          {more(p.files.add)}
          {n(p.files.remove) > 0 && <li>{plural(n(p.files.remove), 'file')} deleted in KIT</li>}
        </Section>
      )}
      {p.products && (
        <Section title="Products" count={n(p.products)}>
          {p.products.items.map((x) => <Item key={x.id} title={x.title}>{x.text}</Item>)}
          {more(p.products)}
        </Section>
      )}
      {p.followers && (
        <Section title="Followers" count={n(p.followers)} note="deals; anyone not following yet is added">
          {p.followers.items.map((f) => (
            <Item key={f.ticket_id} title={f.title}>{f.names.join(', ')}{f.missing.length ? ` (no Pipedrive user: ${f.missing.join(', ')})` : ''}</Item>
          ))}
          {more(p.followers)}
        </Section>
      )}
      {p.contacts && (
        <Section title="People" count={n(p.contacts.add) + p.contacts.tickets}
          note={`${plural(n(p.contacts.add), 'new person', 'new people')}; checked on ${plural(p.contacts.tickets, 'deal')}`}>
          {p.contacts.add.items.map((c) => <li key={c.id}>{c.text}{c.organization ? `, ${c.organization}` : ''}</li>)}
          {more(p.contacts.add)}
        </Section>
      )}
    </div>
  );
}

/**
 * Admins: KIT → Pipedrive. Each kind is Off, Manual (goes when sent from here, after a preview) or Auto (also goes on its
 * own, except deletions). Each field is checked against Pipedrive first: one changed there since the last pull is left
 * alone and listed as a conflict.
 */
export function PipedriveSend({ status }) {
  const deals = useApi('/pipedrive/deals');
  const [modes, setModes] = useState(null); // as saved
  const [draft, setDraft] = useState(null); // as chosen here, until saved
  const [saving, setSaving] = useState(false);
  const [which, setWhich] = useState('all'); // 'all', a pipeline id, or 'chosen'
  const [chosen, setChosen] = useState([]);
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = status.data;
  const last = s?.lastSend;
  const auto = s?.auto;
  useEffect(() => { if (s?.modes && !modes) { setModes(s.modes); setDraft(s.modes); } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const deletesOn = !!s?.fileDeletes?.to_pipedrive;
  const kinds = useMemo(() => [...KINDS.map((k) => k.key).filter((k) => modes && modes[k] !== 'off'), ...(deletesOn ? ['fileDeletes'] : [])], [modes, deletesOn]);
  const autoKinds = KINDS.filter((k) => modes?.[k.key] === 'auto');
  // While anything is on Auto, check every 30 seconds so its latest run shows.
  useEffect(() => {
    if (!autoKinds.length || s?.running) return undefined;
    const t = setTimeout(() => status.reload(), 30000);
    return () => clearTimeout(t);
  }, [s, autoKinds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = KINDS.filter((k) => modes && draft && draft[k.key] !== modes[k.key]);
  const pick = (changes) => setDraft({ ...draft, ...changes });
  const all = (mode) => pick(Object.fromEntries(KINDS.map((k) => [k.key, mode])));
  const save = async () => {
    const turningOn = changed.filter((k) => draft[k.key] === 'auto');
    if (turningOn.length && !confirm(`Auto sync ${turningOn.map((k) => k.label.toLowerCase()).join(', ')} to Pipedrive? `
      + 'Changes made in KIT from now on will update your real Pipedrive deals on their own, about a minute later. Deletions still wait for you to push.')) return;
    setError(''); setSaving(true);
    try {
      const saved = (await api.put('/pipedrive/send/modes', Object.fromEntries(changed.map((k) => [k.key, draft[k.key]])))).modes;
      setModes(saved); setDraft(saved); status.reload();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const body = useMemo(() => ({
    kinds, ...(which === 'chosen' ? { ticket_ids: chosen } : which !== 'all' ? { pipeline_id: Number(which) } : {}),
  }), [kinds, which, chosen]);
  useEffect(() => { setP(null); }, [body]);
  const ready = kinds.length > 0 && (which !== 'chosen' || chosen.length > 0);

  const look = async () => {
    setError(''); setBusy(true);
    try { setP(await api.post('/pipedrive/send/preview', body)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!confirm('Send these changes to Pipedrive? This updates your real Pipedrive deals.')) return;
    setError('');
    try { await api.post('/pipedrive/send', body); setP(null); status.reload(); } catch (e) { setError(e.message); }
  };
  const tickets = deals.data?.tickets || [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Choose what goes to Pipedrive. <b>On push</b> changes wait here until you push them. <b>Auto sync</b> changes go on their own about a minute
        after they&apos;re made in KIT, and with your pushes too. Deletions only ever go when you push. Before each field goes, KIT checks
        Pipedrive: if someone changed it there since the last pull, it&apos;s left alone and listed as a conflict, and the next pull brings
        Pipedrive&apos;s version.
      </p>
      {s?.configured && !s.sending && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Sending is off on this server, so testing here never changes your real deals, by hand or automatically. You can still preview.
          It&apos;s on in production (or with PIPEDRIVE_PUSH=1).
        </p>
      )}
      {!modes ? <p className="text-sm text-slate-400">Loading…</p> : (
        <>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {KINDS.map((k) => (
              <ModeChoice key={k.key} mode={draft[k.key]} label={k.label} hint={k.hint} disabled={saving}
                onChange={(m) => pick({ [k.key]: m })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn text-xs" onClick={() => all('manual')}>All on push</button>
            <button type="button" className="btn text-xs" onClick={() => all('off')}>Send nothing</button>
            {changed.length > 0 && (
              <>
                <span className="ml-auto text-xs text-amber-700">{plural(changed.length, 'unsaved change')}</span>
                <button type="button" className="btn text-xs" onClick={() => setDraft(modes)} disabled={saving}>Discard</button>
                <button type="button" className="btn-primary text-xs" onClick={save} disabled={saving}>
                  {saving && <Loader2 size={13} className="animate-spin" />} Save changes
                </button>
              </>
            )}
          </div>
        </>
      )}
      {autoKinds.length > 0 && (
        <Result ok={!auto?.last || (auto.last.ok && !auto.last.result?.errors?.length)}>
          <div className="flex flex-wrap items-center gap-x-1.5 font-medium">
            <RefreshCw size={14} /> Auto sync: {autoKinds.map((k) => k.label.toLowerCase()).join(', ')}
            {!s?.sending && <span className="font-normal">· not on this server</span>}
          </div>
          <div className="mt-0.5 space-y-1 text-xs">
            {auto?.last ? (
              <div>
                Last {when(auto.last.at)}: {auto.last.ok ? sentSummary(auto.last.result.sent) || 'nothing needed sending' : `failed (${auto.last.error}). Trying again in 15 minutes.`}
              </div>
            ) : <div>Nothing sent automatically yet.</div>}
            {auto?.last?.ok && auto.last.result.conflicts.length > 0 && (
              <div>Changed in Pipedrive since the last pull, so not sent: {auto.last.result.conflicts.map((c) => `${c.title} (${c.field})`).join('; ')}</div>
            )}
            {auto?.last?.ok && auto.last.result.skipped.length > 0 && <div>Skipped: {auto.last.result.skipped.join('; ')}</div>}
            {auto?.last?.ok && auto.last.result.errors.length > 0 && <div className="text-red-700">Failed: {auto.last.result.errors.join('; ')}</div>}
            {auto?.waiting > 0 && (
              <div>{plural(auto.waiting, 'deal')} didn&apos;t fully go. Auto sync tries again when {auto.waiting === 1 ? 'it changes' : 'they change'} in KIT or Pipedrive, or send by hand.</div>
            )}
          </div>
        </Result>
      )}
      <div className="grid gap-2 sm:grid-cols-[14rem_1fr] sm:items-start">
        <div>
          <label className="label" htmlFor="send-which">Which deals</label>
          <select id="send-which" className="input" value={which} onChange={(e) => setWhich(e.target.value)}>
            <option value="all">All Pipedrive deals</option>
            {(deals.data?.pipelines || []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name} pipeline</option>)}
            <option value="chosen">Choose deals…</option>
          </select>
        </div>
        {which === 'chosen' && (
          <div>
            <span className="label">Deals</span>
            <MultiSelect options={tickets.map((t) => ({ value: t.id, label: t.title, sub: t.pipeline }))} value={chosen} onChange={setChosen}
              placeholder="Type a deal’s name…" />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={look} disabled={!ready || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} Preview
        </button>
        <button type="button" className="btn-primary" onClick={send} disabled={!p || !s?.sending || s?.running}
          title={!p ? 'Preview first' : !s?.sending ? 'Sending is off on this server' : undefined}>
          <Send size={15} /> Push to Pipedrive
        </button>
        {s?.running && <span className="text-sm text-slate-500">Pipedrive is busy ({s.label}): {s.phase}…</span>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {p && <Preview p={p} />}
      {last && !s?.running && (
        <Result ok={last.ok && !last.result?.errors?.length}>
          <div className="flex items-center gap-1.5 font-medium">
            {last.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
            {last.ok ? 'Last sent' : 'Last send failed'} {when(last.at)} by {last.by}
          </div>
          {last.ok ? (
            <div className="mt-0.5 space-y-1 text-xs">
              <div>{sentSummary(last.result.sent) || 'Nothing needed sending.'}</div>
              {last.result.conflicts.length > 0 && (
                <div>Changed in Pipedrive since the last pull, so not sent: {last.result.conflicts.map((c) => `${c.title} (${c.field})`).join('; ')}</div>
              )}
              {last.result.skipped.length > 0 && <div>Skipped: {last.result.skipped.join('; ')}</div>}
              {last.result.errors.length > 0 && <div className="text-red-700">Failed: {last.result.errors.join('; ')}</div>}
            </div>
          ) : <div className="mt-0.5 text-xs">{last.error}</div>}
        </Result>
      )}
    </div>
  );
}

const FILE_DELETES = [
  { key: 'to_pipedrive', label: 'Files deleted in KIT are deleted in Pipedrive', hint: 'They go when you push to Pipedrive, after the preview. Never automatically.',
    ask: 'Delete files in Pipedrive when they’re deleted in KIT? They’ll go with your next push, and the preview lists how many.' },
  { key: 'to_kit', label: 'Files deleted in Pipedrive are deleted in KIT', hint: 'They go on the next pull or live update, for everyone, and can’t be restored from KIT.',
    ask: 'Delete files in KIT when they’re deleted in Pipedrive? This happens on the next pull or live update, and includes files deleted there before now. KIT can’t restore them.' },
];

/** Admins: whether a file deleted on one side is deleted on the other. Each direction is its own choice. */
function PipedriveFileDeletes({ status }) {
  const saved = status.data?.fileDeletes;
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (saved && !draft) setDraft(saved); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft) return <p className="text-sm text-slate-400">Loading…</p>;
  const changed = FILE_DELETES.filter((o) => draft[o.key] !== saved[o.key]);
  const save = async () => {
    if (changed.filter((o) => draft[o.key]).some((o) => !confirm(o.ask))) return;
    setError(''); setBusy(true);
    try { setDraft((await api.put('/pipedrive/file-deletes', draft)).fileDeletes); status.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {FILE_DELETES.map((o) => (
        <label key={o.key} className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={draft[o.key]} disabled={busy} onChange={(e) => setDraft({ ...draft, [o.key]: e.target.checked })} />
          <span><span className="font-medium">{o.label}</span><span className="block text-xs text-slate-500">{o.hint}</span></span>
        </label>
      ))}
      {changed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary text-xs" onClick={save} disabled={busy}>
            {busy && <Loader2 size={13} className="animate-spin" />} Save changes
          </button>
          <button type="button" className="btn text-xs" onClick={() => setDraft(saved)} disabled={busy}>Discard</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Admins: pull everything from Pipedrive, and send chosen KIT changes to it. */
export default function PipedrivePanel() {
  const status = usePipedrive();
  return (
    <div className="panel space-y-5">
      <h2 className="section-title flex items-center gap-2"><RefreshCw size={16} className="text-brand-600" /> Pipedrive</h2>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Pull from Pipedrive</h3>
        <PipedrivePull scope="all" status={status} />
      </section>
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Radio size={14} className="text-brand-600" /> Live updates from Pipedrive</h3>
        <PipedriveLive />
      </section>
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Send to Pipedrive</h3>
        <PipedriveSend status={status} />
      </section>
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Deleted files</h3>
        <PipedriveFileDeletes status={status} />
      </section>
    </div>
  );
}

/**
 * Admins: Pipedrive's webhooks tell KIT the moment a deal, activity, note, person, pipeline or stage changes, and KIT
 * pulls just those deals. Turning it on or off changes only Pipedrive's webhook settings, never its data.
 */
function PipedriveLive() {
  const live = useApi('/pipedrive/live');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const l = live.data;
  const on = !!l?.webhooks?.length;
  const complete = on && !l.missing?.length;
  // Check again every 15 seconds while it's on, so new events and updates show.
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => live.reload(), 15000);
    return () => clearTimeout(t);
  }, [l]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = async (turnOn) => {
    if (!turnOn && !window.confirm('Turn off live updates? KIT will only get Pipedrive changes from the nightly pull and pulls people run.')) return;
    setBusy(true);
    setError('');
    try { await (turnOn ? api.post('/pipedrive/live', {}) : api.del('/pipedrive/live')); await live.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (live.error) return <p className="text-sm text-red-600">{live.error.message}</p>;
  if (!l) return <p className="text-sm text-slate-400">Checking…</p>;
  const blocker = !l.configured ? `Add PIPEDRIVE_API_KEY to the ${l.server || 'KIT API'} service in Render first (see Pull from Pipedrive above).`
    : !l.secret ? 'Set PIPEDRIVE_WEBHOOK_SECRET on the server to turn on live updates.'
      : !l.public ? `Pipedrive can only send to a public HTTPS address, and this server is at ${l.url.replace('/api/pipedrive/webhook', '')}. Live updates work on the production server.`
        : null;
  const last = l.last;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Pipedrive tells KIT as soon as a deal, activity, note, person, pipeline or stage changes, and KIT pulls those deals a few seconds later, the same
        way a pull does. Deletions in Pipedrive aren&apos;t copied, as with any pull. Turning this on or off changes only Pipedrive&apos;s webhook settings.
      </p>
      {blocker && !on && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{blocker}</p>}
      {l.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Couldn&apos;t read Pipedrive&apos;s webhooks: {l.error}</p>}
      {on && (
        <Result ok={complete && l.webhooks.every((w) => w.active)}>
          <div className="flex items-center gap-1.5 font-medium">
            {complete ? <Check size={14} /> : <TriangleAlert size={14} />}
            {complete ? 'On' : `Partly on: no webhook for ${l.missing.join(', ')}`}
            {l.turned_on?.by && <span className="font-normal">· turned on by {l.turned_on.by} {when(l.turned_on.at)}</span>}
          </div>
          <div className="mt-0.5 space-y-0.5 text-xs">
            <div>Sending to {l.url}</div>
            {l.webhooks.some((w) => !w.active) && <div>Pipedrive has paused {l.webhooks.filter((w) => !w.active).map((w) => w.object).join(', ')}. Turn live updates off and on again.</div>}
            <div>
              {l.received.count ? `${plural(l.received.count, 'event')} since the server started; last ${when(l.received.last_at)} (${l.received.last})` : 'No events since the server started.'}
              {l.waiting > 0 && ` · ${plural(l.waiting, 'deal')} waiting to be pulled`}
              {l.received.rejected > 0 && ` · ${plural(l.received.rejected, 'request')} turned away`}
            </div>
          </div>
        </Result>
      )}
      {last && (
        <Result ok={last.ok}>
          <div className="flex items-center gap-1.5 font-medium">
            {last.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
            {last.ok ? 'Last live update' : 'Last live update failed'} {when(last.at)} · {plural(last.deals || 0, 'deal')}
          </div>
          <div className="mt-0.5 text-xs">{last.ok ? summary(last.result) || 'Nothing changed.' : last.error}</div>
        </Result>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {(!on || !complete) && (
          <button type="button" className="btn-primary" onClick={() => change(true)} disabled={busy || !!blocker}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />} {on ? 'Finish turning on' : 'Turn on live updates'}
          </button>
        )}
        {on && <button type="button" className="btn" onClick={() => change(false)} disabled={busy}>Turn off</button>}
        <button type="button" className="btn-ghost text-sm" onClick={() => live.reload()} disabled={busy}><RefreshCw size={14} /> Check</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
