import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, CalendarClock, ChevronDown, ChevronUp, Eye, Pencil, Plus, Search, Sparkles, Trash2, Workflow, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, stamp } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import Markdown, { plainText, termsRegex } from '../components/Markdown.jsx';
import PlaybookAssistant from '../components/PlaybookAssistant.jsx';

const TEAM_KEY = 'kit.playbook.team';
const readTeam = () => { try { return Number(localStorage.getItem(TEAM_KEY)) || null; } catch { return null; } };
const writeTeam = (id) => { try { localStorage.setItem(TEAM_KEY, String(id)); } catch { /* ignore */ } };

const terms = (q) => q.trim().split(/\s+/).filter(Boolean);
const anchor = (s) => `section-${s.id}`;
const editor = (s) => (s.updated_first_name ? fullName({ first_name: s.updated_first_name, last_name: s.updated_last_name }) : '');

/** How many times the search terms appear in a section (title and text). */
function countMatches(section, re) {
  if (!re) return 0;
  return (`${section.title}\n${plainText(section.body)}`.match(re) || []).length;
}

/** Write a section, or change one. The battle rhythm keeps its place and can't be deleted. */
function SectionEditor({ teamId, section, onClose, onSaved }) {
  const [title, setTitle] = useState(section?.title || '');
  const [body, setBody] = useState(section?.body || '');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isRhythm = section?.kind === 'rhythm';

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (section) await api.put(`/playbook/sections/${section.id}`, { title, body });
      else await api.post(`/playbook/${teamId}/sections`, { title, body });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete the section “${section.title}”? This can't be undone.`)) return;
    setBusy(true);
    try { await api.del(`/playbook/sections/${section.id}`); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <SidePanel wide title={section ? (isRhythm ? 'Team battle rhythm' : 'Edit section') : 'New section'}
      subtitle="Markdown: # headings, - bullets (indent two spaces to nest), 1. numbered steps, | tables |, > notes, **bold**."
      onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          {section && !isRhythm && <button type="button" className="btn-danger" disabled={busy} onClick={remove}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn ml-auto" onClick={onClose}>Cancel</button>
          <button type="submit" form="playbook-section-form" className="btn-primary" disabled={!title.trim() || busy}>{busy ? 'Saving…' : section ? 'Save' : 'Add section'}</button>
        </div>
      )}>
      <form id="playbook-section-form" className="flex h-full flex-col gap-4" onSubmit={save}>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div>
          <label className="label" htmlFor="playbook-title">Title</label>
          <input id="playbook-title" className="input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} disabled={isRhythm} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center">
            <label className="label mb-0" htmlFor="playbook-body">Text</label>
            <button type="button" className="btn-ghost ml-auto py-1 text-xs" onClick={() => setPreview((p) => !p)}>
              {preview ? <Pencil size={12} /> : <Eye size={12} />} {preview ? 'Write' : 'Preview'}
            </button>
          </div>
          {preview
            ? <div className="min-h-[24rem] flex-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4"><Markdown text={body} /></div>
            : <textarea id="playbook-body" className="input min-h-[24rem] flex-1 resize-y font-mono text-xs leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} spellCheck />}
        </div>
      </form>
    </SidePanel>
  );
}

/** The playbook's tagline and version, under its title. */
function DetailsEditor({ playbook, onClose, onSaved }) {
  const [tagline, setTagline] = useState(playbook.tagline || '');
  const [version, setVersion] = useState(playbook.version || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.put(`/playbook/${playbook.team.id}`, { tagline, version }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <SidePanel title="Playbook details" subtitle={`The ${playbook.team.name} team's playbook`} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="playbook-details-form" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>}>
      <form id="playbook-details-form" className="space-y-4" onSubmit={save}>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div><label className="label" htmlFor="pb-tagline">Tagline</label><input id="pb-tagline" className="input" maxLength={200} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="The Rules of the Road" /></div>
        <div><label className="label" htmlFor="pb-version">Version</label><input id="pb-version" className="input" maxLength={80} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0 (July 2026)" /></div>
      </form>
    </SidePanel>
  );
}

/** The workflow diagram, full width, over the page. */
function WorkflowViewer({ src, title, onClose }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 p-4 sm:p-8" role="dialog" aria-label={title} onClick={onClose}>
      <div className="mb-3 flex items-center gap-3 text-white">
        <Workflow size={18} />
        <div className="text-sm font-semibold">{title}</div>
        <a href={src} target="_blank" rel="noreferrer" className="ml-auto text-xs text-slate-300 underline hover:text-white" onClick={(e) => e.stopPropagation()}>Open full size</a>
        <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={title} className="mx-auto h-auto w-full max-w-[1800px]" />
      </div>
    </div>
  );
}

/**
 * A team's expectations and guidance, in sections, with its battle rhythm first. Everyone reads any team's; admins and
 * the team's leads write it. Search marks every keyword match; Ask KIT answers from the sections beside the page.
 */
export default function Playbook() {
  const { user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState(readTeam);
  const [playbook, setPlaybook] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [panel, setPanel] = useState(null); // 'new' | 'details' | a section
  const [workflow, setWorkflow] = useState(false);

  useEffect(() => { api.get('/teams').then((d) => setTeams(d.teams)).catch((e) => setLoadError(e.message)); }, []);
  // The team shown: the one chosen before, else the first of the person's own teams, else BD.
  useEffect(() => {
    if (!teams.length || (teamId && teams.some((t) => t.id === teamId))) return;
    const own = user.teams?.[0]?.id;
    setTeamId(own && teams.some((t) => t.id === own) ? own : (teams.find((t) => t.name === 'BD') || teams[0]).id);
  }, [teams, teamId, user]);

  const load = (id) => api.get(`/playbook/${id}`).then((d) => { setPlaybook(d); setLoadError(''); }).catch((e) => setLoadError(e.message));
  useEffect(() => { if (teamId) { writeTeam(teamId); setPlaybook(null); load(teamId); } }, [teamId]);

  const words = useMemo(() => terms(q), [q]);
  const re = useMemo(() => termsRegex(words), [words]);
  const sections = playbook?.sections || [];
  const rhythm = sections.find((s) => s.kind === 'rhythm');
  const others = sections.filter((s) => s.kind !== 'rhythm');
  const counts = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, countMatches(s, re)])), [sections, re]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const searching = words.length > 0;
  const shown = (s) => !searching || counts[s.id] > 0;
  const visible = sections.filter(shown);

  const reload = () => load(teamId);
  const closePanel = () => setPanel(null);
  const move = async (s, dir) => {
    const ids = others.map((o) => o.id);
    const i = ids.indexOf(s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { setPlaybook(await api.put(`/playbook/${teamId}/order`, { ids })); } catch (e) { setLoadError(e.message); }
  };
  const canEdit = !!playbook?.can_edit;
  const team = playbook?.team;

  const Controls = ({ s, index }) => canEdit && (
    <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
      {s.kind !== 'rhythm' && (
        <>
          <button type="button" className="btn-ghost p-1.5" title="Move up" aria-label={`Move “${s.title}” up`} disabled={index === 0} onClick={() => move(s, -1)}><ChevronUp size={14} /></button>
          <button type="button" className="btn-ghost p-1.5" title="Move down" aria-label={`Move “${s.title}” down`} disabled={index === others.length - 1} onClick={() => move(s, 1)}><ChevronDown size={14} /></button>
        </>
      )}
      <button type="button" className="btn-ghost p-1.5" title="Edit" aria-label={`Edit “${s.title}”`} onClick={() => setPanel(s)}><Pencil size={14} /></button>
    </div>
  );
  const Updated = ({ s }) => (s.updated_at || s.created_at) && editor(s)
    ? <div className="text-[11px] text-slate-400">Updated by {editor(s)} · {stamp(s.updated_at || s.created_at)}</div> : null;

  return (
    <div className="flex min-h-full">
      <div className="min-w-0 flex-1 space-y-5 p-8">
        <PageHeader title={team ? `${team.name} Playbook` : 'Playbook'}
          subtitle={playbook ? [playbook.tagline, playbook.version && `Version ${playbook.version}`].filter(Boolean).join(' · ') || `Expectations and guidance for the ${team.name} team.` : 'Expectations and guidance, one team at a time.'}>
          <select className="input w-auto" aria-label="Team" value={teamId || ''} onChange={(e) => setTeamId(Number(e.target.value))}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="relative w-64">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pr-8 pl-9" placeholder="Search keywords…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the playbook" />
            {q && <button type="button" className="absolute top-2 right-2 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Clear search" onClick={() => setQ('')}><X size={14} /></button>}
          </div>
          {playbook?.workflow_image && <button type="button" className="btn" onClick={() => setWorkflow(true)}><Workflow size={16} /> Workflow</button>}
          <button type="button" className={asking ? 'btn-primary' : 'btn'} onClick={() => setAsking((a) => !a)} aria-pressed={asking}><Sparkles size={16} /> Ask KIT</button>
          {canEdit && <button type="button" className="btn-primary" onClick={() => setPanel('new')}><Plus size={16} /> New section</button>}
        </PageHeader>

        {loadError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
        {!playbook && !loadError && <p className="text-sm text-slate-400">Loading the playbook…</p>}

        {playbook && (
          <div className="flex gap-6">
            <nav className="sticky top-8 hidden w-56 shrink-0 self-start lg:block" aria-label="Sections">
              <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">On this page</div>
              <ul className="space-y-0.5 border-l border-slate-200 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${anchor(s)}`} className={`-ml-px flex items-center gap-2 border-l-2 py-1 pl-3 ${!shown(s) ? 'border-transparent text-slate-300' : s.kind === 'rhythm' ? 'border-brand-500 font-medium text-brand-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
                      <span className="truncate">{s.title}</span>
                      {searching && counts[s.id] > 0 && <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{counts[s.id]}</span>}
                    </a>
                  </li>
                ))}
              </ul>
              {canEdit && <button type="button" className="btn-ghost mt-3 text-xs text-slate-500" onClick={() => setPanel('details')}><Pencil size={12} /> Edit details</button>}
            </nav>

            <div className="min-w-0 flex-1 space-y-5">
              {searching && (
                <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" aria-live="polite">
                  <Search size={14} />
                  {total ? `${total} match${total === 1 ? '' : 'es'} in ${visible.length} section${visible.length === 1 ? '' : 's'} for “${words.join(' ')}”` : `Nothing in this playbook matches “${words.join(' ')}”.`}
                  <button type="button" className="ml-auto text-xs font-medium underline" onClick={() => setQ('')}>Show everything</button>
                </div>
              )}

              {rhythm && shown(rhythm) && (
                <section id={anchor(rhythm)} className="group scroll-mt-8 rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm">
                  <div className="mb-3 flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"><CalendarClock size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold text-slate-900">{rhythm.title}</h2>
                      <Updated s={rhythm} />
                    </div>
                    <Controls s={rhythm} />
                  </div>
                  {rhythm.body.trim()
                    ? <Markdown text={rhythm.body} highlight={words} />
                    : <p className="text-sm text-slate-500">The {team.name} team's battle rhythm hasn't been written yet.{canEdit && ' Use the pencil to write it: the meetings, their cadence, and what each one is for.'}</p>}
                </section>
              )}

              {others.filter(shown).map((s) => (
                <section key={s.id} id={anchor(s)} className="group panel scroll-mt-8">
                  <div className="mb-3 flex items-start gap-3 border-b border-slate-100 pb-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold text-slate-900">{re ? s.title.split(re).map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5">{p}</mark> : p)) : s.title}</h2>
                      <Updated s={s} />
                    </div>
                    <Controls s={s} index={others.indexOf(s)} />
                  </div>
                  {s.body.trim() ? <Markdown text={s.body} highlight={words} /> : <p className="text-sm text-slate-400">Nothing written yet.</p>}
                </section>
              ))}

              {!others.length && !searching && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
                  <BookOpenText size={28} className="mx-auto mb-2 text-slate-300" />
                  The {team.name} playbook has no sections yet.{canEdit && ' Add the first one.'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {asking && playbook && (
        <div className="sticky top-0 h-screen w-[26rem] shrink-0 border-l border-slate-200 print:hidden">
          <PlaybookAssistant teamId={playbook.team.id} teamName={playbook.team.name} sectionCount={sections.length} gemini={playbook.gemini} onClose={() => setAsking(false)} />
        </div>
      )}

      {panel && panel !== 'details' && (
        <SectionEditor key={panel === 'new' ? 'new' : panel.id} teamId={teamId} section={panel === 'new' ? null : panel} onClose={closePanel} onSaved={() => { closePanel(); reload(); }} />
      )}
      {panel === 'details' && <DetailsEditor playbook={playbook} onClose={closePanel} onSaved={() => { closePanel(); reload(); }} />}
      {workflow && playbook?.workflow_image && <WorkflowViewer src={playbook.workflow_image} title={`${team.name} workflow`} onClose={() => setWorkflow(false)} />}
    </div>
  );
}
