import { Blocks } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';

/** Placeholder: the catalog of technical solutions we offer will be set up here. */
export default function TechnicalSolutions() {
  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Technical Solutions" subtitle="Details on the technical solutions we offer." />
      <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
        <Blocks size={28} className="mx-auto mb-2 text-slate-300" />
        <p className="font-medium text-slate-600">Coming soon</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
          This is where the technical solutions we offer will be set up: what each one does, who it’s for, and the details BD needs to pitch it.
        </p>
      </div>
    </div>
  );
}
