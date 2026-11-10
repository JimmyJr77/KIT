import { useEffect, useRef, useState } from 'react';
import { Check, Code2, ShieldCheck, X } from 'lucide-react';

/** The name of the developer role wherever it shows as a team. It's the users.developer flag, not a row in teams. */
export const SITE_DEV = 'Site Dev';

// Every team tag is the same color; a team lead's tag, the site-admin tag and the Site Dev tag each have their own.
const TAG = 'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset';
const TEAM = `${TAG} bg-sky-50 text-sky-800 ring-sky-200`;
const LEAD = `${TAG} bg-amber-50 text-amber-900 ring-amber-300`;
const ADMIN = `${TAG} bg-rose-50 text-rose-700 ring-rose-200`;
const DEV = `${TAG} bg-violet-50 text-violet-700 ring-violet-200`;

/** Marks a site admin, next to their team tags. */
export function AdminTag() {
  return <span className={ADMIN} title="Site admin: can manage access and everyone's accounts"><ShieldCheck size={12} /> Admin</span>;
}

/**
 * One tag per team, by name. `roles` maps team id → 'member' | 'lead'. With `onSetRole`, right-clicking a tag
 * (or pressing the context-menu key on it) offers Member or Team lead, for the teams `canSetRole(teamId)` allows.
 * `children` are more tags for the same row, such as territories. `siteDev` adds the Site Dev tag, removable with
 * `onRemoveSiteDev`.
 */
export function TeamTags({ teams = [], value = [], roles = {}, onRemove, onSetRole, canSetRole = () => true, admin, siteDev, onRemoveSiteDev, children }) {
  const [menu, setMenu] = useState(null); // { team, x, y }
  const chosen = value.map(Number).map((id) => teams.find((t) => t.id === id)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const roleMenu = (t) => (onSetRole && canSetRole(t.id) ? (e) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    // Keyboard context-menu presses have no pointer position; open under the tag instead.
    setMenu({ team: t, x: e.clientX || r.left, y: e.clientY || r.bottom });
  } : undefined);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {admin && <AdminTag />}
      {chosen.map((t) => {
        const lead = roles[t.id] === 'lead';
        const onContextMenu = roleMenu(t);
        return (
          <span key={t.id} className={lead ? LEAD : TEAM} onContextMenu={onContextMenu} tabIndex={onContextMenu ? 0 : undefined}
            title={[`${t.name} ${lead ? 'team lead' : 'member'}`, onContextMenu && 'right-click to change'].filter(Boolean).join(' · ')}>
            {t.name}{lead && <span className="text-[10px] font-semibold uppercase opacity-75">Lead</span>}
            {onRemove && (
              <button type="button" onClick={() => onRemove(t.id)} aria-label={`Remove ${t.name}`} className="-mr-0.5 opacity-60 hover:opacity-100"><X size={12} /></button>
            )}
          </span>
        );
      })}
      {siteDev && (
        <span className={DEV} title="Site Dev: sees the Developer page of Admin Access and works through site feedback">
          <Code2 size={12} /> {SITE_DEV}
          {onRemoveSiteDev && (
            <button type="button" onClick={onRemoveSiteDev} aria-label={`Remove ${SITE_DEV}`} className="-mr-0.5 opacity-60 hover:opacity-100"><X size={12} /></button>
          )}
        </span>
      )}
      {!chosen.length && !admin && !siteDev && <span className="text-xs text-slate-400">No team</span>}
      {children /* more tags in the same row, e.g. territories */}
      {menu && (
        <RoleMenu {...menu} role={roles[menu.team.id] || 'member'} onClose={() => setMenu(null)}
          onPick={(role) => { setMenu(null); if (role !== (roles[menu.team.id] || 'member')) onSetRole(menu.team.id, role); }} />
      )}
    </div>
  );
}

function RoleMenu({ team, x, y, role, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); window.removeEventListener('scroll', onClose, true); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={`${team.name} role`} style={{ left: Math.min(x, window.innerWidth - 176), top: y + 4 }}
      className="fixed z-50 w-44 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
      <div className="px-3 pt-1 pb-1.5 text-[11px] font-semibold text-slate-500 uppercase">{team.name}</div>
      {[['member', 'Member'], ['lead', 'Team lead']].map(([value, label]) => (
        <button key={value} type="button" role="menuitemradio" aria-checked={role === value} onClick={() => onPick(value)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
          <span className="w-3.5">{role === value && <Check size={14} className="text-brand-600" />}</span>
          <span className={`h-2.5 w-2.5 rounded-sm ring-1 ring-inset ${value === 'lead' ? 'bg-amber-50 ring-amber-300' : 'bg-sky-50 ring-sky-200'}`} />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * A select listing the teams not yet chosen; picking one adds it. Native, so it isn't clipped inside scrolling lists.
 * With `onAddSiteDev`, Site Dev is offered too (unless `siteDev` says they already have it).
 */
export function AddTeamSelect({ teams = [], value = [], onAdd, siteDev, onAddSiteDev, className = '' }) {
  const ids = value.map(Number);
  const rest = teams.filter((t) => !ids.includes(t.id));
  const offerDev = !!onAddSiteDev && !siteDev;
  if (!rest.length && !offerDev) return null;
  return (
    <select className={`input py-1 text-xs ${className}`} value="" aria-label="Add a team"
      onChange={(e) => { if (e.target.value === 'site-dev') onAddSiteDev(); else if (e.target.value) onAdd(Number(e.target.value)); }}>
      <option value="">+ Add team</option>
      {rest.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      {offerDev && <option value="site-dev">{SITE_DEV}</option>}
    </select>
  );
}

/** Pick one or more teams: tags you can remove, and a select to add more. value: team ids. */
export default function TeamPicker({ teams = [], value = [], roles, onChange, disabled }) {
  const ids = value.map(Number);
  return (
    <div className="flex min-h-[38px] flex-wrap items-center gap-1.5">
      {!disabled && <AddTeamSelect teams={teams} value={ids} onAdd={(id) => onChange([...ids, id])} className="w-auto py-1.5 text-sm" />}
      <TeamTags teams={teams} value={ids} roles={roles} onRemove={disabled ? undefined : (id) => onChange(ids.filter((x) => x !== id))} />
    </div>
  );
}
