import { useState, type FormEvent } from 'react';
import { Flame, Lock, User, ShieldAlert } from 'lucide-react';
import { api, setToken } from '../api';

interface LoginScreenProps {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(username, password);
      setToken(res.token);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#111622]/90 border border-slate-800/80 shadow-2xl shadow-black/60 p-8 backdrop-blur-xl">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/40 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/10">
            <Flame className="w-7 h-7 text-amber-400" />
          </div>
          <h1 className="font-nordic text-2xl font-bold tracking-wider text-amber-100">
            POK-VALHEIM
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Multi-Realm Linux Docker Server Manager
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-sm text-red-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-1.5">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 pl-10 pr-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter admin password"
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 pl-10 pr-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-slate-950 font-semibold py-2.5 text-sm transition shadow-lg shadow-amber-500/20 cursor-pointer"
          >
            {loading ? 'Signing in...' : 'Enter Mead Hall'}
          </button>
        </form>
      </div>
    </div>
  );
}
