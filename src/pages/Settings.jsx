import { Check, X } from 'lucide-react';
import { useApi } from '../lib/data.js';
import PageHeader from '../components/PageHeader.jsx';

export default function Settings() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader title="Settings" subtitle="How KIT is connected and configured" />
      <IntegrationsPanel />
    </div>
  );
}

function IntegrationsPanel() {
  const { data } = useApi('/ai/status');
  if (!data) return null;
  const items = [
    ['Gemini', data.gemini, data.model],
    ['Airfare MCP', data.airfare],
    ['Rental Car MCP', data.rentalCar],
    ['GSA Per Diem API', data.gsaApi],
    ['Google Workspace', data.googleWorkspace],
  ];
  return (
    <div className="panel">
      <h2 className="section-title mb-3">Integrations</h2>
      <div className="flex flex-wrap gap-2">
        {items.map(([name, on, extra]) => (
          <span key={name} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {on ? <Check size={13} /> : <X size={13} />} {name}{extra ? ` · ${extra}` : ''}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">Configure in the server <code>.env</code> file. See README.</p>
    </div>
  );
}
