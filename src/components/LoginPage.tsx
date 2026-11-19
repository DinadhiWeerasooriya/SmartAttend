import React, { useState } from 'react';
import { ShieldCheck, QrCode, MapPin, Smartphone, ArrowRight, Eye, EyeOff } from 'lucide-react';
import type { AuthUser, UserRole } from '../types';
import { apiFetch, setAuthToken } from '../utils/api';
import { getOrCreateDeviceId } from '../utils/device';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  {
    role: 'student' as UserRole,
    label: 'Maya Patel (Student)',
    identifier: 'REG-2026-001',
    password: 'Student@123',
  },
  {
    role: 'student' as UserRole,
    label: "Liam O'Connor (Student)",
    identifier: 'REG-2026-002',
    password: 'Student@123',
  },
  {
    role: 'lecturer' as UserRole,
    label: 'Prof. Alan Sterling (Lecturer)',
    identifier: 'alan.sterling@smartattend.edu',
    password: 'Lecturer@123',
  },
  {
    role: 'admin' as UserRole,
    label: 'Dr. Eleanor Vance (Admin)',
    identifier: 'admin@smartattend.edu',
    password: 'Admin@123',
  },
];

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [roleTab, setRoleTab] = useState<UserRole>('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceId = getOrCreateDeviceId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
          password,
          deviceId,
        }),
      });
      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const applyDemo = (demo: (typeof DEMO_ACCOUNTS)[number]) => {
    setRoleTab(demo.role);
    setIdentifier(demo.identifier);
    setPassword(demo.password);
    setError(null);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      <OfflineIndicator />
      <div className="flex-1 flex flex-col lg:flex-row">
      {/* Left Navy University Overview Panel */}
      <div className="lg:w-5/12 bg-navy-950 text-white p-6 sm:p-10 lg:p-12 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight">SmartAttend</span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-10 leading-tight text-white">
            Verified University Attendance
          </h1>
          <p className="mt-4 text-slate-300 text-base leading-relaxed max-w-md">
            Preventing proxy attendance with 30-second dynamic QR tokens, classroom geolocation verification, and single-device student binding.
          </p>

          <div className="mt-10 space-y-5">
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-navy-900 border border-navy-700 flex items-center justify-center shrink-0 mt-0.5">
                <QrCode className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">30-Second Dynamic QR Codes</h2>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Tokens automatically renew every 30 seconds and immediately invalidate previous codes.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-navy-900 border border-navy-700 flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">On-Demand Location Verification</h2>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Location is requested strictly when marking attendance and matched against the classroom perimeter.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-navy-900 border border-navy-700 flex items-center justify-center shrink-0 mt-0.5">
                <Smartphone className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">One-to-One Device Association</h2>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Automatically links one browser-based device ID to the first student registration number used on it.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-navy-800 text-xs text-slate-400">
          Foundation Computing Project · SmartAttend Attendance Portal
        </div>
      </div>

      {/* Right Sign-In Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <h2 className="font-display text-2xl font-bold text-slate-900">Sign in to SmartAttend</h2>
            <p className="text-sm text-slate-600 mt-1">
              Select your university role and enter your credentials.
            </p>

            {/* Role Selector Tabs */}
            <div className="mt-6 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'student', label: 'Student' },
                  { id: 'lecturer', label: 'Lecturer' },
                  { id: 'admin', label: 'Admin' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setRoleTab(tab.id);
                    setError(null);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    roleTab === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {roleTab === 'student'
                    ? 'University Registration Number'
                    : roleTab === 'lecturer'
                    ? 'Lecturer Email or Staff ID'
                    : 'Administrator Email'}
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={
                    roleTab === 'student'
                      ? 'e.g. REG-2026-001'
                      : roleTab === 'lecturer'
                      ? 'e.g. alan.sterling@smartattend.edu'
                      : 'e.g. admin@smartattend.edu'
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {roleTab === 'student' && (
              <p className="mt-4 text-xs text-slate-500 leading-relaxed">
                Note: For demonstration, SmartAttend uses a browser-based device identifier stored in this browser profile. Clearing site data or switching browsers generates a new ID and does not guarantee physical hardware identity.
              </p>
            )}

            <div className="mt-4">
              <PWAInstallButton variant="card" />
            </div>
          </div>

          {/* Demo Accounts Quick-Fill */}
          <div className="mt-5 bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-700 mb-2.5">
              Demo Accounts (Click to Fill)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((demo) => (
                <button
                  key={demo.identifier}
                  type="button"
                  onClick={() => applyDemo(demo)}
                  className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900 truncate">{demo.label}</div>
                  <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                    {demo.identifier}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};
