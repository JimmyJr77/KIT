import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import MyDashboard from './MyDashboard.jsx';
import CompanyDashboard from './CompanyDashboard.jsx';

const TABS = [
  ['me', 'My dashboard', MyDashboard, 'Your priority accounts, to-dos, numbers and report card.'],
  ['company', 'Company dashboard', CompanyDashboard, 'Any team, or anyone on it: to-dos, pipeline, bookings, revenue, expenses, book-to-bill and report cards.'],
];

/** Two dashboards: your own, and the company's (by team, or one person). The tab is in the URL. */
export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  // Old links to the Financials tab land on the Company dashboard.
  const key = params.get('tab') === 'financials' ? 'company' : params.get('tab');
  const tab = TABS.find(([k]) => k === key) || TABS[0];
  const Body = tab[2];
  return (
    <div className="space-y-6 p-8">
      <PageHeader title="Dashboard" subtitle={tab[3]}>
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="tablist" aria-label="Dashboards">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab[0] === k} onClick={() => setParams(k === 'me' ? {} : { tab: k })}
              className={`rounded px-3 whitespace-nowrap ${tab[0] === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>
      <Body key={tab[0]} />
    </div>
  );
}
