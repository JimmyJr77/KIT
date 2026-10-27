import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Megaphone, Image as ImageIcon, FileText, Type, Download, Copy, Check, Pencil, Plus, Search, Upload, Ticket, Loader2, Trash2, CalendarDays } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ago, fullName, fullStamp, shortDate, todayIso } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import Avatar from '../components/Avatar.jsx';

const TABS = [
  { key: 'brand', label: 'Logos & Images', icon: ImageIcon },
  { key: 'copy', label: 'Text Copy', icon: Type },
  { key: 'files', label: 'Files', icon: FileText },
  { key: 'requests', label: 'Support Requests', icon: Megaphone },
];

export const fileSize = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
const matches = (q, ...fields) => !q || fields.some((f) => f?.toLowerCase().includes(q.toLowerCase()));

/**
 * Marketing: logos, images, approved text copy, and files anyone can grab, kept up to date by the Marketing team;
 * plus support requests, which Marketing turns into work tickets.
 */
export default function Marketing() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'brand';
  const setTab = (key) => setParams({ tab: key }, { replace: true });
  const [meta, setMeta] = useState(null);
  const [assets, setAssets] = useState(null);
  const [copy, setCopy] = useState(null);
  const [requests, setRequests] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // { type: 'asset' | 'copy' | 'request', item?, kind? }

  const loadAssets = () => api.get('/marketing/assets').then((d) => setAssets(d.assets));
  const loadCopy = () => api.get('/marketing/copy').then((d) => setCopy(d.copy));
  const loadRequests = () => api.get('/marketing/requests').then((d) => setRequests(d.requests));
  useEffect(() => {
    api.get('/marketing/meta').then(setMeta);
    loadAssets();
    loadCopy();
    loadRequests();
  }, []);

  const canManage = !!meta?.canManage;
  const counts = {
    brand: assets?.filter((a) => a.kind !== 'file').length,
    copy: copy?.length,
    files: assets?.filter((a) => a.kind === 'file').length,
    requests: requests?.filter((r) => r.status !== 'accepted').length,
  };
  const close = () => setOpen(null);

  const addButton = tab === 'requests'
    ? <button className="btn-primary" onClick={() => setOpen({ type: 'request' })}><Megaphone size={15} /> Request support</button>
    : canManage && (tab === 'copy'
      ? <button className="btn-primary" onClick={() => setOpen({ type: 'copy' })}><Plus size={15} /> Add copy</button>
      : <button className="btn-primary" onClick={() => setOpen({ type: 'asset', kind: tab === 'files' ? 'file' : 'logo' })}><Upload size={15} /> Upload</button>);

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Marketing" subtitle="Logos, images, approved copy, and files ready to use, and a place to ask the Marketing team for help.">
        {addButton}
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <Icon size={15} /> {label}
              {counts[key] > 0 && <span className={`rounded-full px-1.5 text-[11px] ${key === 'requests' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{counts[key]}</span>}
            </button>
          ))}
        </nav>
        {tab !== 'requests' && (
          <div className="relative mb-2 w-full max-w-xs">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>

      {tab === 'brand' && assets && <BrandAssets assets={assets} q={q} canManage={canManage} onEdit={(item) => setOpen({ type: 'asset', item })} />}
      {tab === 'files' && assets && <FileList assets={assets.filter((a) => a.kind === 'file' && matches(q, a.title, a.description, a.name))} canManage={canManage} onEdit={(item) => setOpen({ type: 'asset', item })} />}
      {tab === 'copy' && copy && <CopyList copy={copy} q={q} categories={meta?.copyCategories || []} canManage={canManage} onEdit={(item) => setOpen({ type: 'copy', item })} />}
      {tab === 'requests' && requests && <Requests requests={requests} meta={meta} onChanged={loadRequests} />}

      {open?.type === 'asset' && (
        <AssetForm key={open.item?.id ?? 'new'} asset={open.item} kind={open.kind} kinds={meta?.assetKinds || []} onClose={close}
          onSaved={() => { loadAssets(); close(); }} />
      )}
      {open?.type === 'copy' && (
        <CopyForm key={open.item?.id ?? 'new'} item={open.item} categories={meta?.copyCategories || []} onClose={close}
          onSaved={() => { loadCopy(); close(); }} />
      )}
      {open?.type === 'request' && (
        <RequestForm meta={meta} onClose={close} onSaved={() => { loadRequests(); close(); }} />
      )}
    </div>
  );
}

function Empty({ icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
      <Icon size={28} className="mx-auto mb-2 text-slate-300" />
      <p className="mx-auto max-w-md text-sm">{children}</p>
    </div>
  );
}

const DownloadLink = ({ asset, className = 'btn px-2.5 py-1 text-xs' }) => (
  <a href={`/api/marketing/assets/${asset.id}/download`} className={className} title={`Download ${asset.name}`} onClick={(e) => e.stopPropagation()}>
    <Download size={13} /> Download
  </a>
);

const EditButton = ({ onClick, label = 'Edit' }) => (
  <button type="button" className="btn-ghost p-1.5 text-slate-500" onClick={onClick} title={label} aria-label={label}><Pencil size={14} /></button>
);

// ---- Logos & images

function BrandAssets({ assets, q, canManage, onEdit }) {
  const groups = [
    { kind: 'logo', title: 'Logos', items: assets.filter((a) => a.kind === 'logo' && matches(q, a.title, a.description, a.name)) },
    { kind: 'image', title: 'Images', items: assets.filter((a) => a.kind === 'image' && matches(q, a.title, a.description, a.name)) },
  ];
  if (!groups.some((g) => g.items.length)) {
    return <Empty icon={ImageIcon}>{q ? 'Nothing matches.' : `No logos or images yet.${canManage ? ' Upload the first one.' : ' The Marketing team adds them here.'}`}</Empty>;
  }
  return (
    <div className="space-y-6">
      {groups.filter((g) => g.items.length).map((g) => (
        <section key={g.kind}>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{g.title}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
            {g.items.map((a) => (
              <article key={a.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className={`grid h-40 place-items-center p-4 ${g.kind === 'logo' ? 'bg-[length:16px_16px] bg-[conic-gradient(#f1f5f9_25%,#fff_0_50%,#f1f5f9_0_75%,#fff_0)]' : 'bg-slate-100'}`}>
                  {a.previewable
                    ? <img src={`/api/marketing/assets/${a.id}/view?v=${encodeURIComponent(a.updated_at || a.created_at)}`} alt={a.title} loading="lazy"
                        className={g.kind === 'logo' ? 'max-h-full max-w-full object-contain' : 'h-full w-full rounded object-cover'} />
                    : <FileText size={32} className="text-slate-300" />}
                </div>
                <div className="flex flex-1 flex-col gap-1 border-t border-slate-100 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate font-semibold text-slate-900" title={a.title}>{a.title}</h3>
                    {canManage && <EditButton onClick={() => onEdit(a)} />}
                  </div>
                  {a.description && <p className="line-clamp-2 text-xs text-slate-500">{a.description}</p>}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <span className="min-w-0 truncate text-[11px] text-slate-400" title={a.name}>{a.name.split('.').pop().toUpperCase()} · {fileSize(a.size)}</span>
                    <DownloadLink asset={a} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- Files

function FileList({ assets, canManage, onEdit }) {
  if (!assets.length) return <Empty icon={FileText}>No files here yet. One-pagers, capability statements, templates, and decks go here.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
          <tr><th className="px-4 py-3">File</th><th className="px-4 py-3">Size</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3" /></tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-[10px] font-bold text-brand-700">{a.name.split('.').pop().toUpperCase().slice(0, 4)}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{a.title}</div>
                    <div className="truncate text-xs text-slate-500">{a.description || a.name}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500">{fileSize(a.size)}</td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500" title={fullStamp(a.updated_at || a.created_at)}>
                {ago(a.updated_at || a.created_at)}{a.uploaded_by && ` · ${fullName(a.uploaded_by)}`}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  {canManage && <EditButton onClick={() => onEdit(a)} />}
                  <DownloadLink asset={a} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Text copy

function CopyList({ copy, q, categories, canManage, onEdit }) {
  const [category, setCategory] = useState('');
  const shown = copy.filter((c) => (!category || c.category === category) && matches(q, c.title, c.body, c.category));
  const used = categories.filter((c) => copy.some((x) => x.category === c));
  return (
    <div className="space-y-4">
      {used.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {['', ...used].map((c) => (
            <button key={c || 'all'} type="button" onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${category === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {c || 'All'}
            </button>
          ))}
        </div>
      )}
      {!shown.length
        ? <Empty icon={Type}>{q || category ? 'Nothing matches.' : `No approved copy yet.${canManage ? ' Add boilerplate, taglines, and bios people can paste.' : ' The Marketing team adds it here.'}`}</Empty>
        : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-4">
            {shown.map((c) => <CopyCard key={c.id} item={c} canManage={canManage} onEdit={() => onEdit(c)} />)}
          </div>
        )}
    </div>
  );
}

function CopyCard({ item: c, canManage, onEdit }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const words = c.body.trim().split(/\s+/).length;
  const copyText = async () => {
    await navigator.clipboard.writeText(c.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">{c.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            {c.category && <span className="chip py-0 text-[11px]">{c.category}</span>}
            <span>{words} {words === 1 ? 'word' : 'words'} · {c.body.length} characters</span>
          </div>
        </div>
        {canManage && <EditButton onClick={onEdit} />}
      </div>
      <p className={`mt-3 flex-1 text-sm whitespace-pre-wrap text-slate-700 ${expanded ? '' : 'line-clamp-6'}`}>{c.body}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400" title={fullStamp(c.updated_at || c.created_at)}>
          Updated {ago(c.updated_at || c.created_at)}{c.updated_by && ` by ${fullName(c.updated_by)}`}
        </span>
        <div className="flex items-center gap-1">
          {c.body.split('\n').length > 6 || c.body.length > 420
            ? <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Less' : 'More'}</button>
            : null}
          <button type="button" className={`btn px-2.5 py-1 text-xs ${copied ? 'border-emerald-300 text-emerald-700' : ''}`} onClick={copyText}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
      </div>
    </article>
  );
}

// ---- Support requests

const STATUS = {
  open: <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Waiting on Marketing</span>,
  accepted: <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Work ticket created</span>,
};

function Requests({ requests, meta, onChanged }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const me = useAuth().user.id;
  const shown = requests.filter((r) => filter === 'all' || (filter === 'mine' ? r.requested_by?.id === me : r.status !== 'accepted'));

  const take = async (r) => {
    setBusy(r.id);
    setError('');
    try {
      const out = await api.post(`/marketing/requests/${r.id}/accept`, {});
      window.dispatchEvent(new Event('kit:alerts'));
      navigate(`/tickets?open=${out.ticket_id}`);
    } catch (e) {
      setError(e.message);
      setBusy(null);
      onChanged();
    }
  };
  const withdraw = async (r) => {
    if (!confirm(`Withdraw “${r.title || 'this request'}”?`)) return;
    setBusy(r.id);
    try { await api.del(`/marketing/requests/${r.id}`); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {[['open', 'Open'], ['mine', 'Mine'], ['all', 'All']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {meta && (meta.team.length ? `Requests alert ${meta.team.map(fullName).join(', ')}` : 'No one is on the Marketing team yet. An admin can assign people to it under Admin Access.')}
        </span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!shown.length ? (
        <Empty icon={Megaphone}>
          {filter === 'open' ? 'No open requests.' : filter === 'mine' ? 'You haven’t asked Marketing for anything yet.' : 'No requests yet.'} Need graphics, copy, a one-pager, or event support? Use Request support.
        </Empty>
      ) : (
        <ul className="max-w-4xl space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">{r.title || (r.event_name ? `Support for ${r.event_name}` : 'Marketing support')}</h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    {r.category && <span className="chip py-0 text-[11px]">{r.category}</span>}
                    {r.event_id && (
                      <button type="button" onClick={() => navigate(`/events?open=${r.event_id}`)} className="flex items-center gap-1 text-sky-700 hover:underline">
                        <CalendarDays size={12} /> {r.event_name}
                      </button>
                    )}
                    {r.due_date && <span className={r.status !== 'accepted' && r.due_date < todayIso() ? 'font-medium text-red-600' : ''}>Needed by {longDate(r.due_date)}</span>}
                  </div>
                </div>
                {STATUS[r.status] || STATUS.open}
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap text-slate-700">{r.details}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                  <Avatar user={r.requested_by} size="xs" />
                  <span>{fullName(r.requested_by) || 'Someone'} asked</span>
                  <span title={fullStamp(r.created_at)}>· {ago(r.created_at)}</span>
                  {r.accepted_by && <span>· taken by {fullName(r.accepted_by)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {r.ticket_id ? (
                    <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => navigate(`/tickets?open=${r.ticket_id}`)}>
                      <Ticket size={13} /> {r.ticket_title || 'Open work ticket'}
                    </button>
                  ) : (
                    <>
                      {(r.requested_by?.id === me || meta?.canManage) && (
                        <button type="button" className="btn-ghost px-2 py-1 text-xs text-slate-500" onClick={() => withdraw(r)} disabled={!!busy}>Withdraw</button>
                      )}
                      {meta?.canManage && (
                        <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => take(r)} disabled={!!busy}>
                          {busy === r.id ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : <><Ticket size={13} /> Take it: create work ticket</>}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ meta, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', category: '', due_date: '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setError('');
    try { await api.post('/marketing/requests', form); onSaved(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <SidePanel title="Request marketing support" subtitle={meta?.team.length ? `Alerts ${meta.team.map(fullName).join(', ')}` : 'No one is on the Marketing team yet'} onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={busy || !form.title.trim() || !form.details.trim()}>
              <Megaphone size={15} /> {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <Field label="Title"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. One-pager for the Army cloud pitch" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type of help">
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Choose…</option>
              {(meta?.requestCategories || []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Needed by"><input type="date" className="input" min={todayIso()} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
        </div>
        <Field label="Details">
          <textarea className="input min-h-40" value={form.details} onChange={(e) => set('details', e.target.value)}
            placeholder="What do you need, who's it for, and where will it be used? Link any drafts or examples." />
        </Field>
        <p className="text-xs text-slate-500">For help with a specific event, you can also ask from that event on the Events page.</p>
      </div>
    </SidePanel>
  );
}

// ---- Editors (Marketing only)

function AssetForm({ asset, kind, kinds, onClose, onSaved }) {
  const [form, setForm] = useState({ kind: asset?.kind || kind || 'logo', title: asset?.title || '', description: asset?.description || '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    setError('');
    const body = new FormData();
    Object.entries(form).forEach(([k, v]) => body.append(k, v));
    if (file) body.append('file', file);
    try {
      await (asset ? api.put(`/marketing/assets/${asset.id}`, body) : api.post('/marketing/assets', body));
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete “${asset.title}” from the library?`)) return;
    setBusy(true);
    try { await api.del(`/marketing/assets/${asset.id}`); onSaved(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <SidePanel title={asset ? 'Edit library item' : 'Upload to the library'} subtitle={asset ? asset.name : 'Logos and images show a preview; files are listed for download'} onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-2">
          {asset ? <button className="btn-danger" onClick={remove} disabled={busy}><Trash2 size={15} /> Delete</button> : <span />}
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy || (!asset && !file)}>{busy ? 'Saving…' : asset ? 'Save' : 'Upload'}</button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <Field label="Section">
          <div className="flex gap-1.5">
            {kinds.map((k) => (
              <button key={k.key} type="button" onClick={() => set('kind', k.key)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${form.kind === k.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
                {k.label.replace(/s$/, '')}
              </button>
            ))}
          </div>
        </Field>
        <Field label={asset ? 'Replace file (optional)' : 'File'}>
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 hover:border-brand-500">
            <Upload size={20} className="text-slate-400" />
            {file ? <span className="font-medium text-slate-800">{file.name} · {fileSize(file.size)}</span> : <span>Choose a file{form.kind !== 'file' ? ' (PNG, SVG, JPG…)' : ''}</span>}
            <input type="file" className="hidden" accept={form.kind === 'file' ? undefined : 'image/*'}
              onChange={(e) => { const f = e.target.files?.[0]; setFile(f || null); if (f && !form.title) set('title', f.name.replace(/\.[^.]+$/, '')); }} />
          </label>
        </Field>
        <Field label="Name"><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Primary logo, full color" /></Field>
        <Field label="Notes">
          <textarea className="input min-h-20" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="When to use it, sizes, usage rules…" />
        </Field>
      </div>
    </SidePanel>
  );
}

function CopyForm({ item, categories, onClose, onSaved }) {
  const [form, setForm] = useState({ title: item?.title || '', category: item?.category || '', body: item?.body || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await (item ? api.put(`/marketing/copy/${item.id}`, form) : api.post('/marketing/copy', form));
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete “${item.title}”?`)) return;
    setBusy(true);
    try { await api.del(`/marketing/copy/${item.id}`); onSaved(); } catch (e) { setError(e.message); setBusy(false); }
  };
  const words = form.body.trim() ? form.body.trim().split(/\s+/).length : 0;
  return (
    <SidePanel wide title={item ? 'Edit copy' : 'Add copy'} subtitle="Approved text people can copy and paste" onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-2">
          {item ? <button className="btn-danger" onClick={remove} disabled={busy}><Trash2 size={15} /> Delete</button> : <span />}
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy || !form.title.trim() || !form.body.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_12rem] gap-3">
          <Field label="Title"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Company boilerplate (100 words)" /></Field>
          <Field label="Category">
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">None</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Copy">
          <textarea className="input min-h-72 leading-relaxed" value={form.body} onChange={(e) => set('body', e.target.value)} />
          <div className="mt-1 text-right text-[11px] text-slate-400">{words} words · {form.body.length} characters</div>
        </Field>
      </div>
    </SidePanel>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
