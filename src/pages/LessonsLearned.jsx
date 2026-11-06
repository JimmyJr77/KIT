import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, ChevronUp, ChevronDown, ChevronsUpDown, Lightbulb, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, parseUtc, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import MultiSelect from '../components/MultiSelect.jsx';

const KINDS = [['good', 'Good / Keep'], ['bad', 'Bad / Change']];
const ACTIONS = [['continue', 'Continue'], ['change', 'Change']];
const nameOf = (list, key) => list.find(([k]) => k === key)?.[1] || '—';

export const lessonNo = (l) => `LL-${String(l.id).padStart(3, '0')}`;
const day = (d) => (d ? shortDate(d, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const logged = (l) => parseUtc(l.created_at)?.toLocaleDateString('en-CA') || '';
const author = (l) => (l.author_first_name ? fullName({ first_name: l.author_first_name, last_name: l.author_last_name }) : '');
const tagNames = (l) => l.tags.map((t) => t.name).join(' ');

const SORTS = {
  id: (l) => l.id, kind: (l) => l.kind, action: (l) => l.action, title: (l) => l.title.toLowerCase(), retro: (l) => l.retro_date || '', logged: (l) => l.created_at,
};
// Columns that start newest-first.
const FIRST_DESC = ['id', 'retro', 'logged'];

/** Pick one of a few choices; `value` is null until someone does. */
function Choice({ label, options, value, onChange }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {options.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${value === k ? 'border-brand-500 bg-white text-brand-700 ring-2 ring-brand-100' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

const blank = { kind: null, action: null, title: '', tag_ids: [], context: '', problem: '', solution: '', retro_date: '' };
const fromLesson = (l) => ({
  kind: l.kind, action: l.action, title: l.title, tag_ids: l.tags.map((t) => t.id),
  context: l.context || '', problem: l.problem || '', solution: l.solution || '', retro_date: l.retro_date || '',
});

/**
 * Write a lesson down, or read and change one. People who can't change it see it read-only.
 * A retrospective opens this same form: `defaults` fills it in, `source` says which ticket it came from.
 */
export function LessonPanel({ lesson, defaults, source, subtitle, tags, onTagsChanged, onClose, onSaved }) {
  const [form, setForm] = useState(() => (lesson ? fromLesson(lesson) : { ...blank, ...defaults }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const readOnly = !!lesson && !lesson.can_edit;

  const isGood = form.kind === 'good';
  const ready = form.kind && (form.kind === 'bad' || form.action) && form.title.trim();

  const chooseKind = (kind) => set({ kind, action: kind === 'bad' ? 'change' : form.kind === 'good' ? form.action : null });
  const addTag = async (name) => {
    setError('');
    try {
      const d = await api.post('/lessons/tags', { name });
      onTagsChanged(d.tags);
      setForm((f) => ({ ...f, tag_ids: f.tag_ids.includes(d.tag.id) ? f.tag_ids : [...f.tag_ids, d.tag.id] }));
    } catch (e) { setError(e.message); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      if (lesson) await api.put(`/lessons/${lesson.id}`, form);
      else await api.post('/lessons', { ...form, ...source });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete ${lessonNo(lesson)}, “${lesson.title}”?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/lessons/${lesson.id}`);
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <SidePanel wide title={lesson ? `${lessonNo(lesson)} · Lesson Learned` : 'New lesson'}
      subtitle={lesson ? `Logged by ${author(lesson) || 'a former user'} on ${day(logged(lesson))}${lesson.source === 'retro' ? ` · From ${lesson.retro_name ? `the retro “${lesson.retro_name}”` : 'a retrospective'}` : ''}` : subtitle || 'Only the title and the choices at the top are needed.'}
      onClose={onClose}
      footer={!readOnly && (
        <div className="flex items-center gap-2">
          {lesson && <button type="button" className="btn-danger" disabled={busy} onClick={remove}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn ml-auto" onClick={onClose}>Cancel</button>
          <button type="submit" form="lesson-form" className="btn-primary" disabled={!ready || busy}>{busy ? 'Saving…' : lesson ? 'Save' : 'Add lesson'}</button>
        </div>
      )}>
      <form id="lesson-form" onSubmit={save}>
        <fieldset disabled={readOnly} className="space-y-4">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Choice label="Good or bad" options={KINDS} value={form.kind} onChange={chooseKind} />
          {isGood && <Choice label="Continue or change" options={ACTIONS} value={form.action} onChange={(action) => set({ action })} />}
          <div>
            <label className="label" htmlFor="lesson-title">Title</label>
            <input id="lesson-title" className="input" maxLength={160} value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div>
            <span className="label">Tags</span>
            <MultiSelect options={tags.map((t) => ({ value: t.id, label: t.name, group: t.tag_group }))} value={form.tag_ids}
              onChange={(tag_ids) => set({ tag_ids })} onCreate={readOnly ? undefined : addTag} placeholder="Type to find or add a tag…" />
          </div>
          {[['context', 'Context'], ['problem', 'Problem'], ['solution', 'Solution']].map(([k, l]) => (
            <div key={k}>
              <label className="label" htmlFor={`lesson-${k}`}>{l} <span className="font-normal text-slate-400 normal-case">(optional)</span></label>
              <textarea id={`lesson-${k}`} className="input" rows={2} value={form[k]} onChange={(e) => set({ [k]: e.target.value })} />
            </div>
          ))}
          <div className="w-44">
            <label className="label" htmlFor="lesson-retro">Retro date <span className="font-normal text-slate-400 normal-case">(optional)</span></label>
            <input id="lesson-retro" type="date" className="input" value={form.retro_date} onChange={(e) => set({ retro_date: e.target.value })} />
          </div>
        </fieldset>
      </form>
    </SidePanel>
  );
}

const Verdict = ({ kind }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${kind === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{nameOf(KINDS, kind)}</span>
);

/** The record of what's working and what isn't. Select a lesson to read or change it. */
export default function LessonsLearned() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [action, setAction] = useState('');
  const [tagFilter, setTagFilter] = useState([]);
  const [sort, setSort] = useState({ key: 'id', dir: 'desc' });
  const [panel, setPanel] = useState(null); // 'new', or the lesson open

  const load = () => api.get('/lessons').then((d) => { setData(d); setLoadError(''); }).catch((e) => setLoadError(e.message));
  useEffect(() => { load(); }, []);

  const lessons = data?.lessons;
  const filtersOn = q || kind || action || tagFilter.length;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const get = SORTS[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    // Lessons with no retro date stay last, whichever way the column runs.
    const blankLast = (l) => (sort.key === 'retro' && !l.retro_date ? 1 : 0);
    return (lessons || [])
      .filter((l) => (!kind || l.kind === kind) && (!action || l.action === action))
      .filter((l) => !tagFilter.length || l.tags.some((t) => tagFilter.includes(t.id)))
      .filter((l) => !s || `${lessonNo(l)} ${l.title} ${l.context || ''} ${l.problem || ''} ${l.solution || ''} ${tagNames(l)}`.toLowerCase().includes(s))
      .sort((a, b) => {
        const last = blankLast(a) - blankLast(b);
        if (last) return last;
        const x = get(a), y = get(b);
        return x < y ? -sign : x > y ? sign : b.id - a.id;
      });
  }, [lessons, q, kind, action, tagFilter, sort]);

  const clearFilters = () => { setQ(''); setKind(''); setAction(''); setTagFilter([]); };

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : FIRST_DESC.includes(key) ? 'desc' : 'asc' }));
  const header = (key, label, className = '') => (
    <th className={`px-4 py-3 ${className}`} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex items-center gap-1 uppercase whitespace-nowrap hover:text-slate-800" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );
  const closePanel = () => setPanel(null);

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Lessons Learned" subtitle="What’s working and what isn’t, one short lesson at a time.">
        <button className="btn-primary" disabled={!data} onClick={() => setPanel('new')}><Plus size={16} /> New lesson</button>
      </PageHeader>

      <div className="panel flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search lessons…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-40" aria-label="Good or bad" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Good and bad</option>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input w-52" aria-label="Continue or change" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Continue and change</option>
          {ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="w-full sm:w-64">
          <MultiSelect compact options={(data?.tags || []).map((t) => ({ value: t.id, label: t.name, group: t.tag_group }))} value={tagFilter} onChange={setTagFilter} placeholder="Filter by tag…" />
        </div>
        {!!filtersOn && <button className="btn-ghost" onClick={clearFilters}>Clear</button>}
        <div className="ml-auto text-sm text-slate-500">{rows.length.toLocaleString()} lesson{rows.length === 1 ? '' : 's'}</div>
      </div>

      {loadError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      {!data && !loadError && <p className="text-sm text-slate-400">Loading lessons…</p>}
      {data && !rows.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Lightbulb size={28} className="mx-auto mb-2 text-slate-300" />
          {lessons.length ? 'No lessons match.' : 'No lessons yet. Add the first one.'}
        </div>
      ) : data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[50rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                {header('id', 'LL #')}{header('kind', 'Good / Bad')}{header('action', 'Action')}{header('title', 'Lesson')}
                {header('retro', 'Retro date')}{header('logged', 'Logged')}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="cursor-pointer border-t border-slate-100 align-top hover:bg-brand-50/40" onClick={() => setPanel(l)}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap text-slate-700 tabular-nums">{lessonNo(l)}</td>
                  <td className="px-4 py-3"><Verdict kind={l.kind} /></td>
                  <td className="px-4 py-3 text-slate-600">{nameOf(ACTIONS, l.action)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{l.title}</div>
                    {l.context && <div className="line-clamp-1 text-xs text-slate-500">{l.context}</div>}
                    {l.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{l.tags.map((t) => <span key={t.id} className="chip">{t.name}</span>)}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{day(l.retro_date)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {day(logged(l))}
                    {author(l) && <div className="text-xs">{author(l)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel && (
        <LessonPanel key={panel === 'new' ? 'new' : panel.id} lesson={panel === 'new' ? null : panel} tags={data.tags}
          onTagsChanged={(tags) => setData((d) => ({ ...d, tags }))} onClose={closePanel} onSaved={() => { closePanel(); load(); }} />
      )}
    </div>
  );
}
