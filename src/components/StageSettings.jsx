import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';

const LEFT_OUT = '';

/**
 * A pipeline's stages, in board order: add one anywhere, rename, move and delete them (admins only; everyone else reads
 * the list, and keeps stages of their own: see MyAliases). Each stage added here carries two choices: whether it syncs with Pipedrive (off unless ticked),
 * and how reports count it (as one of the standard stages, as a step of its own, or not at all).
 * KIT's own pipeline (no id) works the same, without the sync choice: nothing on it goes to Pipedrive.
 * `pipeline` is the board's current pipeline; `onChanged` runs after a change so the board follows.
 */
export default function StageSettings({ pipeline, onChanged }) {
  const pid = pipeline ? pipeline.id ?? 'kit' : null;
  const stages = useApi(pid != null ? `/stages?pipeline_id=${pid}` : null);
  const kit = !!stages.data?.kit; // KIT's own pipeline: its stages never go to Pipedrive
  const list = stages.data?.stages || [];
  const canManage = !!stages.data?.canManage;
  const choices = stages.data?.reportChoices || [];
  const OWN = stages.data?.ownStep || 'own';
  // The form in use: { mode: 'add', after: stage id or null (first) } or { mode: 'edit', id }, with name, sync and reports_as.
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try { await fn(); await stages.reload({ quiet: true }); onChanged?.(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  // A new stage starts out counting as the standard stage it follows.
  const startAdd = (after) => {
    const upTo = after == null ? [] : list.slice(0, list.findIndex((s) => s.id === after) + 1);
    const follows = [...upTo].reverse().map((s) => (choices.includes(s.name) ? s.name : choices.includes(s.reports_as) ? s.reports_as : null)).find(Boolean);
    setForm({ mode: 'add', after, name: '', sync: false, reports_as: follows || choices[0] || LEFT_OUT });
  };
  const startEdit = (s) => setForm({ mode: 'edit', id: s.id, name: s.name, sync: s.sync, reports_as: s.reports_as ?? LEFT_OUT, stage: s });
  const save = async () => {
    if (!form.name.trim()) return;
    const body = { name: form.name, sync: form.sync, reports_as: form.reports_as || null };
    const done = form.mode === 'add'
      ? await run(() => api.post('/stages', { ...body, pipeline_id: pid, after_id: form.after }))
      : await run(() => api.put(`/stages/${form.id}`, {
        ...(form.stage.fixed || form.name.trim() === form.stage.name ? {} : { name: form.name }),
        ...(form.stage.pipedrive_id || kit ? {} : { sync: form.sync }), ...(form.stage.standard ? {} : { reports_as: body.reports_as }),
      }));
    if (done) setForm(null);
  };
  const remove = (s) => {
    const there = s.pipedrive_id ? ' It’s deleted in Pipedrive too, unless Pipedrive has deals in it.' : '';
    if (confirm(`Delete the “${s.name}” stage from ${pipeline.name}?${there}`)) run(() => api.del(`/stages/${s.id}`));
  };

  if (!stages.data) return <p className="text-sm text-slate-400">{stages.error ? stages.error.message : 'Loading…'}</p>;

  const reportsText = (s) => (s.reports_as === OWN ? 'Own step in reports' : s.reports_as ? `Team alias of ${s.reports_as}` : 'Not in reports');
  const formRow = () => {
    const s = form.stage;
    return (
      <li className="space-y-2.5 bg-brand-50/50 px-3 py-3">
        <div>
          <label className="label" htmlFor="stage-name">{form.mode === 'add' ? 'New stage' : 'Stage name'}</label>
          <input id="stage-name" className="input h-9 text-sm" placeholder="Name the stage…" value={form.name} autoFocus maxLength={60} disabled={!!s?.fixed}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); setForm(null); } }} />
        </div>
        {!kit && <label className={`flex items-start gap-2 text-sm ${s?.pipedrive_id ? 'text-slate-400' : 'cursor-pointer text-slate-700'}`}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={!!form.sync} disabled={!!s?.pipedrive_id} onChange={(e) => setForm({ ...form, sync: e.target.checked })} />
          <span>
            <span className="font-medium">Sync with Pipedrive</span>
            <span className="block text-xs text-slate-500">
              {s?.pipedrive_id ? 'Pipedrive has this stage, so it stays in sync.'
                : form.sync ? 'Queued: it’s made as a new stage of this pipeline in Pipedrive with the next send.'
                  : 'Off: the stage is KIT’s own. In Pipedrive, deals in it stay in the stage they were in.'}
            </span>
          </span>
        </label>}
        {!s?.standard && (
          <div>
            <label className="label" htmlFor="stage-reports">In reports</label>
            <select id="stage-reports" className="input h-9 py-0 text-sm" value={form.reports_as} onChange={(e) => setForm({ ...form, reports_as: e.target.value })}>
              {choices.map((c) => <option key={c} value={c}>Team alias of {c} (counts as {c})</option>)}
              <option value={OWN}>Add to reports as its own step</option>
              <option value={LEFT_OUT}>Leave out of reports</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {form.reports_as === OWN ? 'Reports show it as a new step in the process, where it sits in this list.'
                : form.reports_as ? `Its tickets blend into ${form.reports_as} in every report.` : 'Its tickets aren’t counted in pipeline reports.'}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary h-8 px-3 py-0 text-sm" onClick={save} disabled={busy || !form.name.trim()}>{form.mode === 'add' ? 'Add stage' : 'Save'}</button>
          <button type="button" className="btn h-8 px-3 py-0 text-sm" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </li>
    );
  };
  const adding = (after) => canManage && form?.mode === 'add' && form.after === after;

  // Stages of your own come first for everyone who can't change the team's stages: they're what that person can add here.
  const mine = <MyAliases first={!canManage} pid={pid} aliases={stages.data.aliases || []} stageNames={stages.data.aliasStages || []} onChanged={async () => { await stages.reload({ quiet: true }); onChanged?.(); }} />;

  return (
    <div className="space-y-4">
      {!canManage && mine}
      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-snug text-slate-600">
        The stages of <b className="text-slate-800">{pipeline.name}</b>, in the order the board shows them, the same for everyone. {kit
          ? 'This is KIT’s own pipeline: nothing on it goes to Pipedrive. You choose how reports count each stage you add.'
          : 'A stage you add is KIT’s own unless you set it to sync with Pipedrive, and you choose how reports count it. Pipedrive puts a synced stage last in its own pipeline view until someone drags it into place there; KIT keeps the order set here until then.'}
      </p>
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {adding(null) && formRow()}
        {list.map((s, i) => (
          <Rows key={s.id}>
            {form?.mode === 'edit' && form.id === s.id ? formRow() : (
              <li className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs text-slate-400 tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{s.name}</span>
                  <span className="shrink-0 text-xs text-slate-400 tabular-nums">{s.tickets} ticket{s.tickets === 1 ? '' : 's'}</span>
                  {canManage && (
                    <span className="flex shrink-0 items-center">
                      <IconButton label={`Move ${s.name} earlier`} title="Move earlier" disabled={busy || i === 0} onClick={() => run(() => api.put(`/stages/${s.id}/move`, { direction: -1 }))}><ArrowUp size={14} /></IconButton>
                      <IconButton label={`Move ${s.name} later`} title="Move later" disabled={busy || i === list.length - 1} onClick={() => run(() => api.put(`/stages/${s.id}/move`, { direction: 1 }))}><ArrowDown size={14} /></IconButton>
                      <IconButton label={`Add a stage after ${s.name}`} title="Add a stage after this one" disabled={busy} onClick={() => startAdd(s.id)}><Plus size={14} /></IconButton>
                      <IconButton label={`Edit ${s.name}`} title={s.fixed ? `${s.name} closes the pipeline, so it stays as it is` : 'Rename, or change how it syncs and reports'} disabled={busy || s.fixed} onClick={() => startEdit(s)}><Pencil size={14} /></IconButton>
                      <IconButton danger label={`Delete ${s.name}`} disabled={busy || s.fixed || s.tickets > 0} onClick={() => remove(s)}
                        title={s.fixed ? `${s.name} closes the pipeline, so it stays` : s.tickets ? 'Move its tickets to another stage first' : 'Delete'}><Trash2 size={14} /></IconButton>
                    </span>
                  )}
                </div>
                {(!s.standard || (!s.pipedrive_id && !kit)) && (
                  <div className="mt-1 ml-7 flex flex-wrap gap-1">
                    {!kit && <Chip tone={s.pipedrive_id ? 'green' : s.sync ? 'amber' : 'slate'}
                      title={s.pipedrive_id ? 'Pipedrive has this stage' : s.sync ? 'Made in Pipedrive with the next send' : 'KIT’s own stage; nothing about it goes to Pipedrive'}>
                      {s.pipedrive_id ? 'In Pipedrive' : s.sync ? 'Queued for Pipedrive' : 'KIT only'}
                    </Chip>}
                    {!s.standard && <Chip tone={s.reports_as ? 'violet' : 'slate'}>{reportsText(s)}</Chip>}
                  </div>
                )}
              </li>
            )}
            {adding(s.id) && formRow()}
          </Rows>
        ))}
      </ol>
      {canManage ? (
        <button type="button" className="btn" onClick={() => startAdd(null)} disabled={busy}><Plus size={15} /> Add a stage at the start</button>
      ) : <p className="text-xs text-slate-500">Only an admin adds, renames, moves and deletes the team’s stages, so every ticket sits in an approved stage that’s reported. Stages of your own are yours to add, above.</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {canManage && mine}
    </div>
  );
}

/**
 * Your own stages on this pipeline (kept as personal aliases): a column only you see on the board, beside the team stage
 * it's part of. Each has to be tied to one of the pipeline's stages. A ticket you put in one is still in that stage for
 * everyone else, in Pipedrive and in every report. Anyone can keep these; the team's stages are an admin's to add.
 * `first` draws it at the top of the tab, without the rule that sets it off from the team's list above it.
 */
function MyAliases({ pid, aliases, stageNames, onChanged, first = false }) {
  const [form, setForm] = useState(null); // { id?, name, stage }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); await onChanged(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const save = async () => {
    if (!form.name.trim() || !form.stage || busy) return;
    const done = await run(() => (form.id ? api.put(`/stages/aliases/${form.id}`, { name: form.name, stage: form.stage })
      : api.post('/stages/aliases', { pipeline_id: pid, name: form.name, stage: form.stage })));
    if (done) setForm(null);
  };
  const remove = (a) => confirm(`Delete your stage “${a.name}”?${a.tickets ? ` Its ${a.tickets} ticket${a.tickets === 1 ? '' : 's'} show in ${a.stage} again.` : ''}`) && run(() => api.del(`/stages/aliases/${a.id}`));
  const formRow = (
    <li className="space-y-2 bg-brand-50/50 px-3 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="alias-name">Stage name</label>
          <input id="alias-name" className="input h-9 text-sm" placeholder="Name your stage…" value={form?.name || ''} autoFocus maxLength={60}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); setForm(null); } }} />
        </div>
        <div>
          <label className="label" htmlFor="alias-stage">Part of</label>
          <select id="alias-stage" className="input h-9 py-0 text-sm" value={form?.stage || ''} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
            {stageNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      {form?.id && form.stage !== form.was && <p className="text-xs text-amber-700">Tied to another stage, it starts empty: its tickets stay in {form.was}.</p>}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary h-8 px-3 py-0 text-sm" onClick={save} disabled={busy || !form?.name.trim() || !form?.stage}>{form?.id ? 'Save' : 'Add stage'}</button>
        <button type="button" className="btn h-8 px-3 py-0 text-sm" onClick={() => setForm(null)}>Cancel</button>
      </div>
    </li>
  );
  return (
    <section className={`space-y-2 ${first ? '' : 'border-t border-slate-200 pt-4'}`}>
      <h3 className="text-sm font-semibold text-slate-800">Your own stages</h3>
      <p className="text-xs leading-snug text-slate-600">
        Add a stage only you see: a column of your own on the board, beside the team stage it’s part of. A ticket you drag into it stays in that team stage for everyone else, in Pipedrive and in every report, so nothing outside your view changes.
      </p>
      {(aliases.length > 0 || form) && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {aliases.map((a) => (form?.id === a.id ? <Rows key={a.id}>{formRow}</Rows> : (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{a.name}</span>
              <Chip tone="violet">Part of {a.stage}</Chip>
              <span className="shrink-0 text-xs text-slate-400 tabular-nums">{a.tickets} ticket{a.tickets === 1 ? '' : 's'}</span>
              <IconButton label={`Edit ${a.name}`} title="Rename, or tie it to another stage" disabled={busy} onClick={() => setForm({ id: a.id, name: a.name, stage: a.stage, was: a.stage })}><Pencil size={14} /></IconButton>
              <IconButton danger label={`Delete ${a.name}`} title="Delete" disabled={busy} onClick={() => remove(a)}><Trash2 size={14} /></IconButton>
            </li>
          )))}
          {form && !form.id && formRow}
        </ul>
      )}
      {!form && <button type="button" className="btn" onClick={() => setForm({ name: '', stage: stageNames[0] || '' })} disabled={busy || !stageNames.length}><Plus size={15} /> Add a stage of your own</button>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

const Rows = ({ children }) => <>{children}</>;
const TONES = { green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800', violet: 'bg-violet-50 text-violet-700', slate: 'bg-slate-100 text-slate-500' };
const Chip = ({ tone, title, children }) => <span title={title} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;

function IconButton({ label, title, danger, children, ...rest }) {
  return (
    <button type="button" aria-label={label} title={title} {...rest}
      className={`rounded p-1 text-slate-400 disabled:cursor-not-allowed disabled:opacity-30 ${danger ? 'enabled:hover:bg-red-50 enabled:hover:text-red-600' : 'enabled:hover:bg-slate-100 enabled:hover:text-slate-700'}`}>
      {children}
    </button>
  );
}
