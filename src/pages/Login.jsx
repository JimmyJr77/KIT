import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import ProfileFields, { EMPTY_PROFILE } from '../components/ProfileFields.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(identifier, password);
      else await register({ ...profile, password });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-4">
      <form onSubmit={submit} className={`w-full ${mode === 'login' ? 'max-w-sm' : 'max-w-2xl'} rounded-2xl bg-white p-8 shadow-2xl`}>
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-xl font-bold text-white">K</div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">KIT</h1>
            <p className="text-sm text-slate-500">Knexus Intelligence Toolkit</p>
          </div>
        </div>

        {mode === 'login' ? (
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
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Activate an account that an administrator has approved.</p>
            <ProfileFields value={profile} onChange={setProfile} />
            <div className="sm:w-1/2 sm:pr-2">
              <label className="label">Password</label>
              <input className="input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>
        )}

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button className="btn-primary mt-6 w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Activate account'}
        </button>
        <button type="button" className="mt-3 w-full text-center text-sm text-brand-600 hover:underline"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'First time? Activate your approved account' : 'Back to sign in'}
        </button>
      </form>
    </div>
  );
}
