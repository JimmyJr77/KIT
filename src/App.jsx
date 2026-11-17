import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import ProcessingScanner from './components/ProcessingScanner.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import Travel from './pages/Travel.jsx';
import WeeklyPriorities from './pages/WeeklyPriorities.jsx';
import Tickets from './pages/Tickets.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Alerts from './pages/Alerts.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Events from './pages/Events.jsx';
import Crm from './pages/Crm.jsx';
import TechnicalSolutions from './pages/TechnicalSolutions.jsx';
import Delivery from './pages/Delivery.jsx';
import Marketing from './pages/Marketing.jsx';
import Settings, { settingsTabs, settingsPath } from './pages/Settings.jsx';
import Reports from './pages/Reports.jsx';
import Archive from './pages/Archive.jsx';
import Backups from './pages/Backups.jsx';
import DoneTickets from './pages/DoneTickets.jsx';
import ProcessView from './pages/ProcessView.jsx';
import CloseToClosing from './pages/CloseToClosing.jsx';
import SolutionArchitectCoordination from './pages/SolutionArchitectCoordination.jsx';
import ClosedDeals from './pages/ClosedDeals.jsx';
import LessonsLearned from './pages/LessonsLearned.jsx';
import Retros from './pages/Retros.jsx';
import RetroBoard from './pages/RetroBoard.jsx';
import Playbook from './pages/Playbook.jsx';
import Compensation from './pages/Compensation.jsx';

/**
 * Admin Access, My team and Member Access were pages of their own and are now tabs of Settings. Their old addresses
 * (in alerts, bookmarks and shared links) go to the matching tab: /admin to the first role tab this user has, as it
 * did before, /admin/team-lead (keeping ?team=) and /my-team to Team Lead, /admin/developer to Site Dev.
 */
function OldAdminLink() {
  const { user } = useAuth();
  const { view = '' } = useParams();
  const [params] = useSearchParams();
  if (view === 'team-lead' || view === 'bd-team') {
    const team = view === 'bd-team' ? 'BD' : params.get('team');
    return <Navigate to={`${settingsPath('team-lead')}${team ? `&team=${encodeURIComponent(team)}` : ''}`} replace />;
  }
  if (view === 'developer') return <Navigate to={settingsPath('site-dev')} replace />;
  const tabs = settingsTabs(user);
  return <Navigate to={settingsPath((tabs[1] || tabs[0]).key)} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <ProcessingScanner always />;
  if (!user) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <ProcessingScanner />
      </>
    );
  }
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/profile" element={<Profile />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/events" element={<Events />} />
          <Route path="/travel" element={<Travel />} />
          <Route path="/priorities" element={<WeeklyPriorities />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/tickets/done" element={<DoneTickets />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/pipeline/process" element={<ProcessView />} />
          <Route path="/pipeline/c2c" element={<CloseToClosing />} />
          <Route path="/pipeline/sac" element={<SolutionArchitectCoordination />} />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/closed-deals" element={<ClosedDeals />} />
          <Route path="/crm" element={<Crm />} />
          <Route path="/solutions" element={<TechnicalSolutions />} />
          <Route path="/marketing" element={<Marketing />} />
          <Route path="/lessons" element={<LessonsLearned />} />
          <Route path="/playbook" element={<Playbook />} />
          <Route path="/compensation" element={<Compensation />} />
          <Route path="/retros" element={<Retros />} />
          <Route path="/retros/:id" element={<RetroBoard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<OldAdminLink />} />
          <Route path="/admin/:view" element={<OldAdminLink />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/my-team" element={<Navigate to="/settings?tab=team-lead" replace />} />
          <Route path="/member" element={<Navigate to="/settings" replace />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="*" element={<Navigate to="/priorities" replace />} />
        </Route>
      </Routes>
      <ProcessingScanner />
    </>
  );
}
