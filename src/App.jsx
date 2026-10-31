import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
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
import Settings from './pages/Settings.jsx';
import AdminAccess from './pages/AdminAccess.jsx';
import MyTeam from './pages/MyTeam.jsx';
import Reports from './pages/Reports.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-screen place-items-center text-slate-400">Loading…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/profile" element={<Profile />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/events" element={<Events />} />
        <Route path="/travel" element={<Travel />} />
        <Route path="/priorities" element={<WeeklyPriorities />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/delivery" element={<Delivery />} />
        <Route path="/crm" element={<Crm />} />
        <Route path="/solutions" element={<TechnicalSolutions />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<AdminAccess />} />
        <Route path="/my-team" element={<MyTeam />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="*" element={<Navigate to="/priorities" replace />} />
      </Route>
    </Routes>
  );
}
