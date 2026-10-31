import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import BookingTargetsPanel from '../components/BookingTargets.jsx';
import { TeamTags } from '../components/TeamPicker.jsx';
import { TerritoryTags, AddTerritorySelect, TerritoriesPanel, saveUserTerritories } from '../components/Territories.jsx';

/** The teams someone leads; for team leads only. */
export const ledTeams = (user) => (user?.teams || []).filter((t) => t.role === 'lead');

/** Team leads: everyone on the teams they lead, and who else leads them. */
export default function MyTeam() {
  const { user } = useAuth();
  return ledTeams(user).length ? <MyTeamPage /> : <Navigate to="/settings" replace />;
}

function MyTeamPage() {
  const { user, setUser } = useAuth();
  const users = useApi('/users');
  const territories = useApi('/territories');
  const [error, setError] = useState('');
  const led = ledTeams(user);
  // BD leads (like admins) look after territories: the list, and who covers which.
  const territoryList = territories.data?.territories || [];
  const managesTerritories = !!territories.data?.canManage;
  const setTerritories = async (u, ids) => {
    setError('');
    try { await saveUserTerritories(u.id, ids); users.reload(); territories.reload(); } catch (e) { setError(e.message); }
  };

  const setRole = async (member, team, role) => {
    if (member.id === user.id && role === 'member'
      && !confirm(`Step down as ${team.name} lead? Unless someone else leads ${team.name}, only an admin can make you lead again.`)) return;
    setError('');
    try {
      await api.put(`/users/${member.id}/teams/${team.id}`, { role });
      users.reload();
      if (member.id === user.id) setUser((await api.get('/auth/me')).user);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <PageHeader title={led.length === 1 ? `My team · ${led[0].name}` : 'My teams'}
        subtitle={`Right-click a team tag to make someone a member or a team lead.${managesTerritories ? ' Add territories with + Add territory.' : ''}`} />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {led.map((team) => {
        const members = (users.data?.users || []).filter((u) => (u.team_ids || []).includes(team.id));
        const leads = members.filter((u) => u.teams.some((t) => t.id === team.id && t.role === 'lead'));
        const territoriesHere = managesTerritories && team.name === 'BD';
        return (
          <section key={team.id} className="panel space-y-3">
            <h2 className="section-title flex items-center gap-2">
              <Users size={16} className="text-brand-600" /> {team.name}
              <span className="text-xs font-normal text-slate-400">
                {members.length} {members.length === 1 ? 'person' : 'people'} · {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
              </span>
            </h2>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {members.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar user={u} size="md" />
                    <div className="min-w-0 leading-snug">
                      <div className="truncate text-sm font-semibold text-slate-800">{fullName(u)}{u.id === user.id && <span className="font-normal text-slate-400"> (you)</span>}</div>
                      {u.title && <div className="truncate text-xs text-slate-600">{u.title}</div>}
                      <div className="truncate text-xs text-slate-400">{[u.email, u.phone].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                  {/* Only this team's tag can be changed here; their other teams are for reference. */}
                  <div className={territoriesHere ? 'sm:w-80' : 'sm:w-64'}>
                    <TeamTags teams={u.teams} value={u.team_ids} roles={Object.fromEntries(u.teams.map((t) => [t.id, t.role]))}
                      canSetRole={(id) => id === team.id} onSetRole={(_, role) => setRole(u, team, role)}>
                      <TerritoryTags territories={u.territories}
                        onRemove={territoriesHere ? (id) => setTerritories(u, u.territories.map((t) => t.id).filter((x) => x !== id)) : undefined} />
                      {territoriesHere && (
                        <AddTerritorySelect territories={territoryList} value={u.territories.map((t) => t.id)} className="w-36"
                          onAdd={(id) => setTerritories(u, [...u.territories.map((t) => t.id), id])} />
                      )}
                    </TeamTags>
                  </div>
                </li>
              ))}
              {users.data && !members.length && <li className="px-3 py-6 text-center text-sm text-slate-400">No one is on {team.name} yet.</li>}
            </ul>
          </section>
        );
      })}
      {managesTerritories && <TerritoriesPanel territories={territories} onChanged={users.reload} />}
      {managesTerritories && <BookingTargetsPanel />}
    </div>
  );
}
