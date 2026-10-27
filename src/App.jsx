import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import Travel from './pages/Travel.jsx';
import WeeklyPriorities from './pages/WeeklyPriorities.jsx';
import Tickets from './pages/Tickets.jsx';
import Dashboard from './pages/Dashboard.jsx';

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
        <Route path="/travel" element={<Travel />} />
        <Route path="/priorities" element={<WeeklyPriorities />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="*" element={<Navigate to="/priorities" replace />} />
      </Route>
    </Routes>
  );
}
