import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';

/** People who can direct a pipeline ticket: everyone on the BD team, plus whoever the ticket already names. */
function useDirectors(currentId) {
  const users = useApi('/users');
  const all = users.data?.users || [];
  return all.filter((u) => u.teams?.some((t) => t.name === 'BD') || u.id === currentId);
}

/** The BD director, territory and projected win date, for a form. value: { bd_director_id, territory_id, projected_win_date, win_date_undetermined }. */
export function AssignmentFields({ value, onChange }) {
  const directors = useDirectors(Number(value.bd_director_id) || null);
  const territories = useApi('/territories').data?.territories || [];
  return (
    <>
      <div>
        <label className="label">BD director</label>
        <select className="input" value={value.bd_director_id ?? ''} onChange={(e) => onChange({ ...value, bd_director_id: e.target.value })}>
          <option value="">Unassigned</option>
          {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Territory</label>
        <select className="input" value={value.territory_id ?? ''} onChange={(e) => onChange({ ...value, territory_id: e.target.value })}>
          <option value="">No territory</option>
          {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Projected win date</label>
        <input type="date" className="input" value={value.projected_win_date || ''} disabled={!!value.win_date_undetermined}
          onChange={(e) => onChange({ ...value, projected_win_date: e.target.value })} />
      </div>
      <label className="flex items-end gap-2 pb-2.5 text-sm text-slate-600">
        <input type="checkbox" className="accent-brand-600" checked={!!value.win_date_undetermined}
          onChange={(e) => onChange({ ...value, win_date_undetermined: e.target.checked, projected_win_date: e.target.checked ? '' : value.projected_win_date })} />
        Win date undetermined
      </label>
    </>
  );
}
