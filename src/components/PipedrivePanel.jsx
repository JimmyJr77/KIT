import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, Check, TriangleAlert, Send, Eye, ChevronRight, Radio, Scale, ArrowLeftRight, SlidersHorizontal, Ban, GitCompareArrows, Trash2, FileCheck } from 'lucide-react';
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
  const gone = (n, word, many) => n && `${plural(n, word, many)} deleted in Pipedrive`;
  return [
    r.pipelines && plural(r.pipelines, 'new pipeline'), part(r.dealsAdded, r.dealsUpdated, 'deal'), r.dealsArchived && `${plural(r.dealsArchived, 'deal')} deleted in Pipedrive (archived here)`,
    r.dealsArchivedInPipedrive && `${plural(r.dealsArchivedInPipedrive, 'deal')} archived in Pipedrive (archived here)`, r.dealsUnarchived && `${plural(r.dealsUnarchived, 'deal')} unarchived in Pipedrive (back on the boards)`,
    part(r.organizationsAdded, r.organizationsUpdated, 'organization'), part(r.contactsAdded, r.contactsUpdated, 'contact'),
    part(r.activitiesAdded, r.activitiesUpdated, 'activity', 'activities'), gone(r.activitiesDeleted, 'activity', 'activities'),
    part(r.notesAdded, r.notesUpdated, 'note'), gone(r.notesDeleted, 'note'),
    r.filesAdded && plural(r.filesAdded, 'new file'), gone(r.filesDeleted, 'file'), r.filesHeld && `${plural(r.filesHeld, 'file')} deleted in Pipedrive, held for a decision`,
    part(r.productsAdded, r.productsUpdated, 'product'), gone(r.productsDeleted, 'product'), r.installmentsAdded && plural(r.installmentsAdded, 'new installment'),
    r.projectsUpdated && plural(r.projectsUpdated, 'project'), r.projectsUnlinked && `${plural(r.projectsUnlinked, 'project')} not on a won deal`,
    part(r.tasksAdded, r.tasksUpdated, 'project task'), gone(r.tasksDeleted, 'project task'), part(r.projectNotesAdded, 0, 'project note'), r.projectFilesAdded && plural(r.projectFilesAdded, 'project file'),
  ].filter(Boolean).join(' · ');
}

/** Pipedrive's status, checked every two seconds while a pull or send runs. */
function usePipedrive() {
  const status = useApi('/pipedrive');
  const s = status.data;
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setTimeout(() => status.reload({ quiet: true }), 2000);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  return status;
}

const PULLS = {
  team: { button: 'Pull my team’s deals', what: 'the deals owned by everyone on the teams you lead' },
  mine: { button: 'Pull my deals', what: 'the deals you own in Pipedrive' },
};

function Result({ ok, children }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{children}</div>
  );
}

/**
 * Pipedrive → KIT for one scope: 'team' (team leads) or 'mine' (anyone). Pipedrive wins on the fields it holds, except
 * ones changed in KIT that haven't been sent yet; KIT's own work on a ticket is kept. Admins sync everything from the Sync section.
 */
export function PipedrivePull({ scope, status }) {
  const [error, setError] = useState('');
  const s = status.data;
  const last = s?.mine;
  const p = PULLS[scope];

  const pull = async () => {
    setError('');
    try { await api.post('/pipedrive/pull', { scope }); status.reload(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Brings {p.what} into KIT: deals as pipeline tickets, with their people, activities, notes and files. Pipedrive wins on the fields it holds,
        except ones changed in KIT that an admin hasn&apos;t sent yet. KIT&apos;s own work on a ticket is kept. Changes in Pipedrive come into KIT
        live anyway, and everything is pulled every night; pull here to be sure your deals are current now.
      </p>
      {s && !s.configured && <NotSetUp admin={false} server={s.server} />}
      {s?.configured && !s.pulling && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{s.pulling_blocked} An admin sets the sync in Admin Access.</p>}
      {last && !s?.running && (
        <Result ok={last.ok}>
          <div className="flex items-center gap-1.5 font-medium">
            {last.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
            {last.ok ? 'Last pulled' : 'Last pull failed'} {when(last.at)}
            {last.scope === 'team' && ' · your team’s deals'}
          </div>
          {last.ok ? (
            <>
              <div className="mt-0.5 text-xs">{summary(last.result) || 'Nothing changed.'}</div>
              {last.result.accountsCreated?.length > 0 && (
                <div className="mt-1 text-xs">New accounts, waiting to be activated and on no team yet (set their teams in Admin Access): {last.result.accountsCreated.join(', ')}</div>
              )}
            </>
          ) : <div className="mt-0.5 text-xs">{last.error}</div>}
        </Result>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={pull} disabled={!s?.configured || !s?.pulling || s?.running}>
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
  { key: 'deals', label: 'Deal fields', hint: 'Title, value, stage, won / lost, lost reason, probability, expected close date, owner, organization, Account and every custom field' },
  { key: 'labels', label: 'Tags', hint: 'Pipedrive’s labels only; tags made in KIT stay in KIT' },
  { key: 'notes', label: 'Notes', hint: 'Comments added in KIT, and Pipedrive notes edited, pinned or deleted in KIT' },
  { key: 'activities', label: 'Activities', hint: 'Added, edited or deleted in KIT' },
  { key: 'files', label: 'Files', hint: 'Uploads go as files; linked documents as a note with the link' },
  { key: 'products', label: 'Products', hint: 'Added, changed or removed on the deal; new names join Pipedrive’s product catalog' },
  { key: 'installments', label: 'Installments', hint: 'The deal’s payment schedule, added, changed or removed' },
  { key: 'followers', label: 'Followers', hint: 'Added to the deal; nobody is taken off' },
  { key: 'contacts', label: 'People', hint: 'New contacts become Pipedrive people, edits update them; added to the deal as participants' },
  { key: 'organizations', label: 'Organizations', hint: 'New organizations and edits to name, address, labels, website, LinkedIn, industry, revenue, employees' },
  { key: 'projects', label: 'Projects', hint: 'A contract’s overview, status, phase, dates, labels, plan (tasks and activities), notes and documents, on its Pipedrive project' },
];
const SENT = {
  deals: 'deal', labels: ['deal’s tags', 'deals’ tags'], notesAdded: 'new note', notesUpdated: 'edited note', notesDeleted: 'deleted note',
  activitiesAdded: ['new activity', 'new activities'], activitiesUpdated: ['edited activity', 'edited activities'], activitiesDeleted: ['deleted activity', 'deleted activities'],
  filesAdded: 'file', filesDeleted: 'deleted file', project_filesDeleted: 'deleted project file', productsAdded: 'new product', productsUpdated: 'changed product', productsDeleted: 'removed product',
  catalogProductsAdded: 'new catalog product', installmentsAdded: 'new installment', installmentsUpdated: 'changed installment', installmentsDeleted: 'removed installment',
  followers: 'follower', peopleAdded: 'new person', peopleUpdated: 'edited person', contactPersons: 'contact person', participantsAdded: 'participant',
  organizationsAdded: 'new organization', organizationsUpdated: 'edited organization', projectsUpdated: 'project', tasksAdded: 'new project task', tasksUpdated: 'edited project task',
  tasksDeleted: 'deleted project task', projectNotesAdded: 'new project note', projectNotesUpdated: 'edited project note', project_notesDeleted: 'deleted project note', projectFilesAdded: 'project file',
};
const sentSummary = (sent) => Object.entries(sent || {}).map(([k, n]) => {
  const w = SENT[k] || k;
  return Array.isArray(w) ? plural(n, w[0], w[1]) : plural(n, w);
}).join(' · ');

const MODES = [
  { key: 'off', label: 'Do not send', title: 'Never sent to Pipedrive' },
  { key: 'manual', label: 'On push', title: 'Sent when you push from here, after a preview' },
  { key: 'auto', label: 'Auto sync', title: 'Sent on its own a minute or so after it changes (deletions too), and when you push from here' },
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
        <Section title="Products" count={n(p.products.add) + n(p.products.edit) + n(p.products.remove)}
          note={[n(p.products.add) && `${n(p.products.add)} new`, n(p.products.edit) && `${n(p.products.edit)} changed`, n(p.products.remove) && `${n(p.products.remove)} removed`].filter(Boolean).join(', ')}>
          {p.products.add.items.map((x) => <Item key={x.id} title={x.title}>{x.text}</Item>)}
          {p.products.edit.items.map((x) => <Item key={x.id} title={`${x.title} · ${x.text}`}>{x.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}</Item>)}
          {n(p.products.remove) > 0 && <li>{plural(n(p.products.remove), 'product')} removed in KIT</li>}
        </Section>
      )}
      {p.installments && (
        <Section title="Installments" count={n(p.installments.add) + n(p.installments.edit) + n(p.installments.remove)}>
          {p.installments.add.items.map((x) => <Item key={x.id} title={x.title}>{x.text}</Item>)}
          {p.installments.edit.items.map((x) => <Item key={x.id} title={`${x.title} · edited`}>{x.text}</Item>)}
          {n(p.installments.remove) > 0 && <li>{plural(n(p.installments.remove), 'installment')} removed in KIT</li>}
        </Section>
      )}
      {p.organizations && (
        <Section title="Organizations" count={n(p.organizations.add) + n(p.organizations.edit)}>
          {p.organizations.add.items.map((o) => <li key={o.id}>{o.text} (new)</li>)}
          {p.organizations.edit.items.map((o) => <Item key={o.id} title={o.text}>{o.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}</Item>)}
        </Section>
      )}
      {p.projects && (
        <Section title="Projects" count={n(p.projects.edit) + n(p.projects.tasks.add) + n(p.projects.tasks.edit) + n(p.projects.tasks.remove) + n(p.projects.notes.add) + n(p.projects.notes.edit) + n(p.projects.notes.remove) + n(p.projects.files.add)}>
          {p.projects.edit.items.map((x) => <Item key={x.id} title={x.title}>{x.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}</Item>)}
          {p.projects.tasks.add.items.map((x) => <Item key={`t${x.id}`} title={x.title}>New task: {x.text}</Item>)}
          {p.projects.tasks.edit.items.map((x) => <Item key={`te${x.id}`} title={`${x.title} · ${x.text}`}>{x.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}</Item>)}
          {n(p.projects.tasks.remove) > 0 && <li>{plural(n(p.projects.tasks.remove), 'task')} deleted in KIT</li>}
          {p.projects.notes.add.items.map((m) => <Item key={`n${m.id}`} title={m.title}>Note: {m.text}</Item>)}
          {p.projects.notes.edit.items.map((m) => <Item key={`ne${m.id}`} title={`${m.title} · edited note`}>{m.text}</Item>)}
          {n(p.projects.notes.remove) > 0 && <li>{plural(n(p.projects.notes.remove), 'project note')} deleted in KIT</li>}
          {p.projects.files.add.items.map((f) => <Item key={`f${f.id}`} title={f.title}>File: {f.text}</Item>)}
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
        <Section title="People" count={n(p.contacts.add) + n(p.contacts.edit) + p.contacts.tickets}
          note={`${plural(n(p.contacts.add), 'new person', 'new people')}, ${n(p.contacts.edit)} edited; checked on ${plural(p.contacts.tickets, 'deal')}`}>
          {p.contacts.add.items.map((c) => <li key={c.id}>{c.text}{c.organization ? `, ${c.organization}` : ''}</li>)}
          {(p.contacts.edit?.items || []).map((c) => <Item key={`e${c.id}`} title={c.text}>{c.changes.map((x) => `${x.label}: ${x.from} → ${x.to}`).join('; ')}</Item>)}
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
  useEffect(() => { if (s?.savedModes && !modes) { setModes(s.savedModes); setDraft(s.savedModes); } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const selective = s?.direction === 'selective';
  // What a push sends: the effective modes (from the direction), which the per-kind grid edits in a selective sync.
  const effective = selective ? modes : s?.modes;
  const kinds = useMemo(() => KINDS.map((k) => k.key).filter((k) => effective && effective[k] !== 'off'), [effective]);
  const autoKinds = KINDS.filter((k) => effective?.[k.key] === 'auto');
  // While anything is on Auto, check every 30 seconds so its latest run shows.
  useEffect(() => {
    if (!autoKinds.length || s?.running) return undefined;
    const t = setTimeout(() => status.reload({ quiet: true }), 30000);
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
      const saved = (await api.put('/pipedrive/send/modes', Object.fromEntries(changed.map((k) => [k.key, draft[k.key]])))).savedModes;
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
        {selective ? <>Each kind of change is <b>Auto sync</b> (goes on its own about a minute after it&apos;s made in KIT, deletions too, and with your pushes), <b>On push</b> (waits here until you push) or <b>Do not send</b>.</>
          : <>Every kind of change goes to Pipedrive on its own about a minute after it&apos;s made in KIT, deletions too, and with your pushes. Choose a <b>selective</b> sync above to set each kind by hand.</>}
        {' '}Before each field goes, KIT checks Pipedrive: if someone changed it there since the last pull, it&apos;s left alone and listed as a conflict, and the next pull brings Pipedrive&apos;s version.
      </p>
      {s?.configured && !s.sending && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>One way only here.</b> {s.sending_blocked} Nothing done in KIT on this server reaches Pipedrive, by hand or automatically; you can still
          preview. The production server syncs both ways.
        </p>
      )}
      {!modes ? <p className="text-sm text-slate-400">Loading…</p> : selective && (
        <>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {KINDS.map((k) => (
              <ModeChoice key={k.key} mode={draft[k.key]} label={k.label} hint={k.hint} disabled={saving}
                onChange={(m) => pick({ [k.key]: m })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn text-xs" onClick={() => all('auto')}>All auto</button>
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

const DIRECTIONS = [
  { key: 'both', label: 'Two way', icon: ArrowLeftRight, hint: 'Changes in Pipedrive come into KIT the moment they’re made; every change made in KIT goes to Pipedrive on its own.' },
  { key: 'to_kit', label: 'Pipedrive → KIT only', hint: 'KIT follows Pipedrive, live. Nothing made or changed in KIT is ever sent.' },
  { key: 'to_pipedrive', label: 'KIT → Pipedrive only', hint: 'Pipedrive follows KIT. Nothing is pulled, not even live changes, so KIT always wins.' },
  { key: 'selective', label: 'Selective', icon: SlidersHorizontal, hint: 'Changes in Pipedrive come in live; each kind of KIT change is set to Auto, On push or Off below.' },
  { key: 'off', label: 'No sync', icon: Ban, hint: 'Nothing is pulled from Pipedrive and nothing is sent to it, until an admin chooses a direction here.' },
];
const flows = (d) => (d === 'to_kit' ? 'from Pipedrive into KIT' : d === 'to_pipedrive' ? 'from KIT to Pipedrive' : 'both ways');

/**
 * Admins: which way the sync runs, the Sync button, live updates and files held for a decision. Choosing a direction
 * first shows what its first sync would add and delete on each side; once approved it starts and stays set until an
 * admin changes it here. The active card is shaded; the one awaiting approval has the blue outline.
 */
function PipedriveSync({ status }) {
  const s = status.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposed, setProposed] = useState(null); // a direction chosen here, until approved
  const [pv, setPv] = useState(null);
  const [looking, setLooking] = useState(false);
  const save = async (direction, sync) => {
    setBusy(true); setError('');
    try {
      const r = await api.put('/pipedrive/direction', { direction, sync });
      if (r.error) setError(`The direction is set, but the first sync didn’t start: ${r.error}`);
      setProposed(null); setPv(null); status.reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const choose = async (direction) => {
    if (direction === 'off') {
      if (confirm('Turn the sync off? Nothing is pulled from Pipedrive and nothing is sent to it until an admin chooses a direction again.')) save('off', false);
      return;
    }
    setProposed(direction); setPv(null); setError(''); setLooking(true);
    try { setPv(await api.get(`/pipedrive/direction/preview?direction=${direction}`)); } catch (e) { setError(e.message); setProposed(null); } finally { setLooking(false); }
  };
  const cancel = () => { setProposed(null); setPv(null); };
  const sync = async () => {
    const d = s?.direction;
    const what = d === 'to_kit' ? 'pull everything from Pipedrive' : d === 'to_pipedrive' ? 'send everything waiting in KIT to Pipedrive' : 'pull everything from Pipedrive, then send everything waiting in KIT';
    if (!confirm(`Sync now? This will ${what}.${s?.sending ? ' Deletions made in KIT are deleted in Pipedrive too.' : ''}`)) return;
    setBusy(true); setError('');
    try { await api.post('/pipedrive/sync', {}); status.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const last = s?.lastSync;
  const off = s?.direction === 'off';
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Sync direction">
        {DIRECTIONS.map((d) => {
          const active = s?.direction === d.key;
          const next = proposed === d.key;
          return (
            <button key={d.key} type="button" role="radio" aria-checked={active} disabled={busy || looking || !s} onClick={() => (active ? cancel() : choose(d.key))}
              className={`rounded-lg border p-3 text-left transition ${next ? 'border-brand-500 bg-white ring-2 ring-brand-200' : active ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <div className={`flex items-start justify-between gap-2 text-sm font-semibold ${active || next ? 'text-brand-700' : 'text-slate-700'}`}>
                <span className="flex min-w-0 items-center gap-1.5">{d.icon && <d.icon size={15} className="shrink-0" />} {d.label}</span>
                {active && <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"><Check size={10} /> Active</span>}
                {next && <span className="shrink-0 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-300">Awaiting approval</span>}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{d.hint}</div>
            </button>
          );
        })}
      </div>
      {proposed && <DirectionApproval d={DIRECTIONS.find((x) => x.key === proposed)} pv={pv} looking={looking} busy={busy} onStart={() => save(proposed, true)} onCancel={cancel} />}
      <p className="text-xs text-slate-500">
        The direction stays as set until an admin changes it here. Files deleted on one side are always deleted on the other. If a pull finds {s?.fileHoldAt || 20} or more of
        KIT&apos;s files deleted in Pipedrive at once, they&apos;re held instead and you decide here. Whatever is set, a server that isn&apos;t the production server never writes to Pipedrive.
      </p>
      {s?.pulling && <LiveLine />}
      {s?.fileHold && <FileHold status={status} />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={sync} disabled={busy || !s?.configured || s?.running || (!s?.pulling && !s?.sending)}
          title={off ? 'The sync is off' : !s?.pulling && !s?.sending ? 'Nothing to sync on this server with this direction' : undefined}>
          {s?.running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync now
        </button>
        {s?.running && <span className="text-sm text-slate-500">Pipedrive is busy ({s.label}): {s.phase}…</span>}
        {s && !s.running && <span className="text-xs text-slate-500">
          {off ? 'The sync is off.' : s.direction === 'to_kit' ? 'Pulls everything from Pipedrive.' : s.direction === 'to_pipedrive' ? 'Sends everything waiting in KIT.' : 'Pulls everything, then sends everything waiting.'}
          {!off && !s.sending && s.direction !== 'to_kit' && ' (Not sending from this server.)'}
        </span>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {last && !s?.running && (
        <Result ok={last.ok && !last.result?.sent?.errors?.length}>
          <div className="flex items-center gap-1.5 font-medium">{last.ok ? <Check size={14} /> : <TriangleAlert size={14} />} {last.ok ? 'Last synced' : 'Last sync failed'} {when(last.at)} by {last.by}</div>
          {last.ok ? (
            <div className="mt-0.5 space-y-0.5 text-xs">
              {last.pulling && <div>From Pipedrive: {summary(last.result.pulled || {}) || 'nothing changed'}.</div>}
              {last.sending && <div>To Pipedrive: {sentSummary(last.result.sent?.sent) || 'nothing needed sending'}.{last.result.sent?.conflicts?.length ? ` Not sent (changed in Pipedrive since): ${last.result.sent.conflicts.map((c) => `${c.title} (${c.field})`).join('; ')}.` : ''}{last.result.sent?.errors?.length ? ` Failed: ${last.result.sent.errors.join('; ')}` : ''}</div>}
            </div>
          ) : <div className="mt-0.5 text-xs">{last.error}</div>}
        </Result>
      )}
    </div>
  );
}

/** One line of a direction preview: a count, the first few items, and the rest behind "show all". */
function Count({ x, word, many, note }) {
  const [open, setOpen] = useState(false);
  if (!x?.count) return null;
  const few = 6;
  const shown = open ? x.items : x.items.slice(0, few);
  const rest = x.count - shown.length;
  return (
    <li>
      <b>{plural(x.count, word, many)}</b>{note ? ` ${note}` : ''}:{' '}
      <span className="text-slate-500">{shown.join('; ')}</span>
      {rest > 0 && (
        x.items.length > shown.length
          ? <button type="button" className="ml-1 text-brand-700 hover:underline" onClick={() => setOpen(true)}>…and {rest.toLocaleString()} more</button>
          : <span className="text-slate-400">; …and {rest.toLocaleString()} more</span>
      )}
      {open && x.items.length > few && <button type="button" className="ml-1 text-brand-700 hover:underline" onClick={() => setOpen(false)}>show fewer</button>}
    </li>
  );
}

/** What the first sync in a chosen direction would add and delete on each side, with Start and Cancel. */
function DirectionApproval({ d, pv, looking, busy, onStart, onCancel }) {
  const pull = pv?.pull;
  const anyPull = pull && (pull.dealsNew.count || pull.dealsGone.count || pull.filesNew.count || pull.filesGone.count);
  return (
    <div className="space-y-3 rounded-lg border border-brand-300 bg-brand-50/40 p-3">
      <div className="text-sm font-semibold text-slate-800">Start {d.label}?</div>
      <p className="text-xs text-slate-600">
        Here is what the first sync adds and deletes. From then on, changes flow {flows(d.key)} as they&apos;re made, and the sync stays on until an admin changes it here.
        {d.key === 'to_pipedrive' && <b> Nothing is pulled from Pipedrive any more, and every change in KIT overwrites Pipedrive.</b>}
      </p>
      {looking ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Comparing KIT with Pipedrive…</p> : pv && (
        <>
          {pv.pulling && (
            <div>
              <div className="text-xs font-semibold text-slate-700">From Pipedrive into KIT</div>
              {!pull ? <p className="text-xs text-amber-800">Pipedrive isn&apos;t set up on this server, so nothing can be compared.</p>
                : anyPull ? (
                  <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs text-slate-700">
                    <Count x={pull.dealsNew} word="new deal" note="added to KIT" />
                    <Count x={pull.dealsGone} word="deal" note="deleted in Pipedrive, archived in KIT" />
                    <Count x={pull.filesNew} word="new file" note="added to KIT" />
                    <Count x={pull.filesGone} word="file" note={pull.filesHeld ? 'deleted in Pipedrive, held in KIT for a decision' : 'deleted in Pipedrive, deleted in KIT too'} />
                  </ul>
                ) : <p className="text-xs text-slate-600">Nothing new and nothing deleted. Every deal&apos;s fields are refreshed from Pipedrive ({plural(pull.deals, 'deal')}).</p>}
            </div>
          )}
          {pv.sendKinds.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-700">From KIT to Pipedrive</div>
              {!pv.sending && <p className="text-xs text-amber-800">Not from this server: only the production server writes to Pipedrive. On production this would go.</p>}
              {pv.send && <Preview p={pv.send} />}
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={onStart} disabled={busy || looking || !pv}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Start sync</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Live updates from Pipedrive follow the direction: on whenever Pipedrive → KIT is part of the sync, from the production
 * server. One line says whether they're on and what has arrived.
 */
function LiveLine() {
  const live = useApi('/pipedrive/live');
  const l = live.data;
  useEffect(() => {
    const t = setTimeout(() => live.reload({ quiet: true }), 60000);
    return () => clearTimeout(t);
  }, [l]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null;
  const on = !!l.webhooks?.length;
  const complete = on && !l.missing?.length;
  const state = !on ? (l.blocker ? `not on this server. ${l.blocker}` : l.error ? `couldn’t be checked (${l.error})` : 'turning on…')
    : complete ? 'on' : `partly on (no webhook for ${l.missing.join(', ')}; checked again within the hour)`;
  return (
    <div className={`flex items-start gap-1.5 text-xs ${on && !complete ? 'text-amber-700' : 'text-slate-500'}`}>
      <Radio size={12} className={`mt-0.5 shrink-0 ${complete ? 'text-emerald-600' : ''}`} />
      <span>
        Live updates from Pipedrive: {state}
        {on && l.received.count > 0 && ` · ${plural(l.received.count, 'event')} since the server started, last ${when(l.received.last_at)}`}
        {on && l.last && ` · last update ${when(l.last.at)}${l.last.ok ? '' : ' failed'}`}
      </span>
    </div>
  );
}

/** Files deleted in Pipedrive, many at once: delete them in KIT too, or keep them as KIT's own. */
function FileHold({ status }) {
  const h = status.data.fileHold;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const gone = h.files.filter((f) => f.deal_gone);
  const tickets = [...new Set(gone.map((f) => f.ticket_id))].length;
  const decide = async (action) => {
    const ask = action === 'delete' ? `Delete ${plural(h.files.length, 'file')} in KIT, as they were deleted in Pipedrive? This can’t be undone.`
      : `Keep ${plural(h.files.length, 'file')} in KIT as KIT’s own files? They’re no longer tied to Pipedrive and are never sent back.${tickets ? ` ${plural(tickets, 'ticket')} whose deal is gone from Pipedrive become KIT-only tickets on the KIT pipeline, back on the boards.` : ''}`;
    if (!confirm(ask)) return;
    setBusy(true); setError('');
    try { await api.post('/pipedrive/file-hold', { action }); status.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-start gap-1.5 font-medium"><TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <span>{plural(h.files.length, 'file')} that KIT has were deleted in Pipedrive ({when(h.at)}). They&apos;re held, not deleted, until you decide.{tickets ? ` ${plural(tickets, 'ticket')} had the deal itself deleted in Pipedrive.` : ''}</span>
      </div>
      <button type="button" className="flex items-center gap-1 text-xs hover:underline" onClick={() => setOpen((o) => !o)}><ChevronRight size={12} className={open ? 'rotate-90' : ''} /> {open ? 'Hide' : 'Show'} the files</button>
      {open && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
          {h.files.map((f) => <li key={`${f.table}${f.id}`}><span className="text-amber-700">{f.title}:</span> {f.name}{f.deal_gone ? ' (deal deleted in Pipedrive)' : ''}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn text-xs" onClick={() => decide('keep')} disabled={busy}><FileCheck size={13} /> Keep them in KIT as KIT files</button>
        <button type="button" className="btn text-xs text-red-700" onClick={() => decide('delete')} disabled={busy}><Trash2 size={13} /> Delete them in KIT too</button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Admins: the sync's direction and Sync button, conflicts to settle, what goes to Pipedrive, and the parity check. */
export default function PipedrivePanel() {
  const status = usePipedrive();
  const s = status.data;
  const d = s?.direction;
  return (
    <div className="panel space-y-5">
      <h2 className="section-title flex items-center gap-2"><RefreshCw size={16} className="text-brand-600" /> Pipedrive</h2>
      {s && !s.configured && <NotSetUp admin server={s.server} />}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ArrowLeftRight size={14} className="text-brand-600" /> Sync</h3>
        <PipedriveSync status={status} />
      </section>
      {s?.conflicts > 0 && (
        <section className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <GitCompareArrows size={14} className="text-amber-600" /> Conflicts
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{s.conflicts}</span>
          </h3>
          <Conflicts status={status} />
        </section>
      )}
      {d !== 'to_kit' && d !== 'off' && (
        <section className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">Send to Pipedrive</h3>
          <PipedriveSend status={status} />
        </section>
      )}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Scale size={14} className="text-brand-600" /> Do the numbers match?</h3>
        <PipedriveParity />
      </section>
    </div>
  );
}

/**
 * Admins: fields changed in both KIT and Pipedrive since the last pull. Each is held with both versions until a side is
 * picked here, one at a time, by ticket, or all at once. KIT's version goes to Pipedrive with the next auto sync or push;
 * Pipedrive's is written into KIT.
 */
function Conflicts({ status }) {
  const list = useApi('/pipedrive/conflicts');
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = list.data?.conflicts || [];
  useEffect(() => { setPicked((p) => new Set([...p].filter((id) => rows.some((r) => r.id === id)))); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = async (winner, ids) => {
    const n = ids ? ids.length : rows.length;
    const side = winner === 'kit' ? 'KIT’s' : 'Pipedrive’s';
    const then = winner === 'kit' ? 'KIT’s values go to Pipedrive with the next auto sync (within a minute) or push, overwriting what’s there.' : 'Pipedrive’s values are written into KIT, replacing what was entered here.';
    if (!confirm(`Keep ${side} version for ${plural(n, 'conflict')}? ${then}`)) return;
    setBusy(true); setError('');
    try { await api.post('/pipedrive/conflicts/resolve', { winner, ids: ids || undefined }); setPicked(new Set()); await list.reload(); status.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = [...picked];
  const ids = chosen.length ? chosen : null;
  const scope = chosen.length ? `${plural(chosen.length, 'chosen conflict')}` : 'all';
  if (list.error) return <p className="text-sm text-red-600">{list.error.message}</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        These fields changed in both KIT and Pipedrive since the last pull, so the sync left them alone rather than overwrite either side. Both versions are kept
        until you pick one here. Tick some to settle just those, or settle them all at once.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn text-xs" onClick={() => resolve('kit', ids)} disabled={busy || !rows.length}><Send size={13} /> KIT wins ({scope})</button>
        <button type="button" className="btn text-xs" onClick={() => resolve('pipedrive', ids)} disabled={busy || !rows.length}><RefreshCw size={13} /> Pipedrive wins ({scope})</button>
        {chosen.length > 0 && <button type="button" className="btn-ghost text-xs" onClick={() => setPicked(new Set())} disabled={busy}>Clear choice</button>}
        {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Choose all" checked={picked.size === rows.length} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                <th className="px-3 py-2">Record · field</th><th className="px-3 py-2">KIT</th><th className="px-3 py-2">Pipedrive</th><th className="px-3 py-2">Was</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Choose ${c.title} ${c.field}`} checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="px-3 py-2"><div className="font-medium text-slate-800">{c.title}</div><div className="text-xs text-slate-500">{c.field} · found {when(c.found_at)}</div></td>
                  <td className="px-3 py-2 text-slate-800">{c.kit}</td>
                  <td className="px-3 py-2 text-slate-800">{c.pipedrive}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{c.was}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => resolve('kit', [c.id])} disabled={busy} title="Send KIT’s value to Pipedrive">Keep KIT’s</button>
                      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => resolve('pipedrive', [c.id])} disabled={busy} title="Write Pipedrive’s value into KIT">Keep Pipedrive’s</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/** Admins: Pipedrive's deal counts and values next to KIT's, read live. Numbers that differ are flagged. */
function PipedriveParity() {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = async () => {
    setBusy(true); setError('');
    try { setP(await api.get('/pipedrive/parity')); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const sameCount = (r) => r.pipedrive.count === r.kit.count;
  const sameValue = (r) => Math.round(r.pipedrive.value) === Math.round(r.kit.value);
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Open, won and lost deals in Pipedrive against the deals KIT has from it. Deals whose tickets were deleted in KIT are left out of KIT&apos;s side (a pull never brings them back, and KIT never deletes a deal in Pipedrive).</p>
      <button type="button" className="btn text-sm" onClick={check} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />} Check now</button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {p && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase"><tr><th className="px-3 py-2">Deals</th><th className="px-3 py-2 text-right">Pipedrive</th><th className="px-3 py-2 text-right">KIT</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {p.deals.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.pipedrive.count.toLocaleString()} · {money(r.pipedrive.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.kit.count.toLocaleString()} · {money(r.kit.value)}</td>
                  <td className="px-3 py-2">{sameCount(r) && sameValue(r) ? <span className="flex items-center gap-1 text-xs text-emerald-700"><Check size={13} /> Match</span>
                    : <span className="flex items-center gap-1 text-xs text-amber-700"><TriangleAlert size={13} /> {!sameCount(r) ? 'Counts differ' : 'Values differ'}</span>}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">Projects</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.projects.pipedrive}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.projects.kit}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{p.projects.unlinked ? `${p.projects.unlinked} in Pipedrive not on any deal` : ''}</td>
              </tr>
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            Checked {when(p.checked_at)}. Only in KIT (not Pipedrive deals): {p.only_kit.count} · {money(p.only_kit.value)}. Deleted in KIT, still in Pipedrive: {p.deleted_in_kit}.
          </div>
        </div>
      )}
    </div>
  );
}
