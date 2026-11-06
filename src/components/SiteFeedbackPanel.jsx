import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, stamp, fullStamp } from '../lib/format.js';

/** Admins: what people typed into the KITT feedback widget, newest first, with who said it and the page they were on. */
export default function SiteFeedbackPanel() {
  const feedback = useApi('/feedback');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const list = feedback.data?.feedback || [];

  const remove = async (f) => {
    if (!confirm(`Delete this feedback from ${f.user ? fullName(f.user) : 'a former user'}?`)) return;
    setBusy(f.id);
    setError('');
    try { await api.del(`/feedback/${f.id}`); feedback.reload(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2">
        <MessageSquareText size={16} className="text-brand-600" /> Site feedback
        {list.length > 0 && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">{list.length}</span>}
      </h2>
      <p className="text-xs text-slate-500">Issues and suggestions sent through KITT in the corner of every page.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {feedback.data && !list.length && <p className="text-sm text-slate-400">Nothing sent yet.</p>}
      {list.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.map((f) => (
            <li key={f.id} className="flex items-start gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">{f.user ? fullName(f.user) : 'Former user'}</span>
                  {' · '}<span title={fullStamp(f.created_at)}>{stamp(f.created_at)}</span>
                  {f.path && <>{' · '}<Link to={f.path} className="font-mono text-brand-600 hover:underline">{f.path}</Link></>}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{f.message}</p>
              </div>
              <button type="button" className="btn-ghost shrink-0 p-1.5 text-slate-400 hover:text-red-600" onClick={() => remove(f)} disabled={busy === f.id} title="Delete" aria-label="Delete feedback">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
