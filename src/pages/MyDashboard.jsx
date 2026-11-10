import { useAuth } from '../lib/auth.jsx';
import BdDashboard from '../components/BdDashboard.jsx';
import PriorityAccounts from '../components/PriorityAccounts.jsx';
import MarketingSpend from '../components/MarketingSpend.jsx';

/**
 * Your own dashboard. BD: your priority accounts and priority tickets at the top, then the same views as the BD team
 * dashboard for just you (to-do highlights, top-level metrics, BD numbers, report card). Everyone else gets their
 * to-do highlights, and the Marketing team its spend.
 */
export default function MyDashboard() {
  const { user } = useAuth();
  const onMarketing = (user.teams || []).some((t) => t.name === 'Marketing');
  return (
    <BdDashboard director={user.id} self header={(d) => d.isDirector && <PriorityAccounts readOnly />}>
      {onMarketing && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-slate-900">Marketing spend</h2>
          <MarketingSpend entries={false} />
        </section>
      )}
    </BdDashboard>
  );
}
