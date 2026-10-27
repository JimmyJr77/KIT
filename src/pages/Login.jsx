import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ProfileFields, { EMPTY_PROFILE } from '../components/ProfileFields.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // login | register | request
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState({ first_name: '', last_name: '', email: '', reason: '' });
  const [sent, setSent] = useState(null); // the reply to an access request
  const go = (m) => { setMode(m); setError(''); setSent(null); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(identifier, password);
      else if (mode === 'request') setSent(await api.post('/auth/request-access', request));
      else await register({ ...profile, password });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-4">
      <form onSubmit={submit} className={`w-full ${mode === 'register' ? 'max-w-2xl' : mode === 'request' ? 'max-w-md' : 'max-w-sm'} rounded-2xl bg-white p-8 shadow-2xl`}>
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-xl font-bold text-white">K</div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">KIT</h1>
            <p className="text-sm text-slate-500">Knexus Intelligence Toolkit</p>
          </div>
        </div>

        {mode === 'login' && (
          <div className="space-y-4">
            <div>
              <label className="label">Email, phone, or username</label>
              <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus required autoCapitalize="none" />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>
        )}
        {mode === 'register' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Activate an account that an administrator has approved.</p>
            <ProfileFields value={profile} onChange={setProfile} />
            <div className="sm:w-1/2 sm:pr-2">
              <label className="label">Password</label>
              <input className="input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>
        )}
        {mode === 'request' && (sent ? (
          <div className="space-y-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {sent.approved
              ? <p><span className="font-semibold">{request.email}</span> is already approved. Activate your account to get started.</p>
              : <p>Request sent. An administrator will review it, and once approved you can activate your account with <span className="font-semibold">{request.email}</span>.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Ask an administrator for access to KIT.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="rq-first">First name</label>
                <input id="rq-first" className="input" value={request.first_name} onChange={(e) => setRequest({ ...request, first_name: e.target.value })} autoFocus required />
              </div>
              <div>
                <label className="label" htmlFor="rq-last">Last name</label>
                <input id="rq-last" className="input" value={request.last_name} onChange={(e) => setRequest({ ...request, last_name: e.target.value })} required />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="rq-email">Work email</label>
              <input id="rq-email" className="input" type="email" value={request.email} onChange={(e) => setRequest({ ...request, email: e.target.value })} required autoCapitalize="none" />
            </div>
            <div>
              <label className="label" htmlFor="rq-reason">Team or reason <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea id="rq-reason" rows={2} className="input resize-none" value={request.reason} onChange={(e) => setRequest({ ...request, reason: e.target.value })} placeholder="e.g. Joining the BD team" />
            </div>
          </div>
        ))}

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {mode === 'request' && sent ? (
          <button type="button" className="btn-primary mt-6 w-full" onClick={() => go(sent.approved ? 'register' : 'login')}>
            {sent.approved ? 'Activate account' : 'Back to sign in'}
          </button>
        ) : (
          <button className="btn-primary mt-6 w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'request' ? 'Request access' : 'Activate account'}
          </button>
        )}
        {mode === 'login' ? (
          <div className="mt-3 space-y-1.5 text-center text-sm">
            <button type="button" className="block w-full text-brand-600 hover:underline" onClick={() => go('register')}>First time? Activate your approved account</button>
            <button type="button" className="block w-full text-slate-500 hover:text-brand-600 hover:underline" onClick={() => go('request')}>Don’t have access? Request it</button>
          </div>
        ) : !(mode === 'request' && sent) && (
          <button type="button" className="mt-3 w-full text-center text-sm text-brand-600 hover:underline" onClick={() => go('login')}>Back to sign in</button>
        )}
      </form>
    </div>
  );
}
