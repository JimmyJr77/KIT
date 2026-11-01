import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { PipedrivePullPanel } from '../components/PipedrivePanel.jsx';
import { ledTeams } from './MyTeam.jsx';

/** Members (not admins or team leads, who have their own pages): pull their own Pipedrive deals. */
export default function MemberAccess() {
  const { user } = useAuth();
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (ledTeams(user).length) return <Navigate to="/my-team" replace />;
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <PageHeader title="Member Access" subtitle="Bring your latest Pipedrive deals into KIT" />
      <PipedrivePullPanel scope="mine" />
    </div>
  );
}
