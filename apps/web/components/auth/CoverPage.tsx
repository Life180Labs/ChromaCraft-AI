'use client';

import React, { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { signIn } from 'next-auth/react';
import {
  TbBrandGoogle,
  TbBrandWindows,
  TbEye,
  TbLogin,
  TbUserPlus,
  TbBolt,
  TbClock,
  TbWorld,
} from 'react-icons/tb';

type CoverPageProps = {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string, name: string) => Promise<void>;
  loading: boolean;
  authError: string;
};

export const CoverPage: React.FC<CoverPageProps> = ({ onLogin, onSignup, loading, authError }) => {
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email, password);
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    onSignup(email, password, fullName);
  };

  return (
    <div className="page active" id="page-cover">
      <div className="cover">
        {/* LHS: Brand + Features + Comparison */}
        <div className="cover-lhs">
          <div className="cover-logo">
            <div className="cover-logo-icon">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="1" y="5" width="22" height="14" rx="3" stroke="rgba(255,255,255,.8)" strokeWidth="1.5" />
                <rect x="4" y="8" width="4" height="8" rx="1.5" fill="rgba(255,200,80,.9)" />
                <rect x="10" y="8" width="4" height="8" rx="1.5" fill="rgba(255,200,80,.65)" />
                <rect x="16" y="8" width="4" height="8" rx="1.5" fill="rgba(255,200,80,.4)" />
              </svg>
            </div>
            <div>
              <div className="cover-logo-text">Chroma<span>Craft</span> AI</div>
              <div className="logo-by-sm" style={{ color: 'rgba(255,220,160,.45)' }}>by Life180 Labs</div>
            </div>
          </div>

          <div className="cover-tagline">Product imagery.<br />Fraction of the cost.</div>
          <div className="cover-sub">AI color variants, lifestyle scenes &amp; videos — minutes, not days.</div>

          <div className="cover-features">
            <div className="cover-feat">
              <div className="cover-feat-icon"><TbBolt /></div>
              <div className="cover-feat-text"><strong>99% cheaper</strong>12 variants for $0.91 vs $285 at an agency</div>
            </div>
            <div className="cover-feat">
              <div className="cover-feat-icon"><TbClock /></div>
              <div className="cover-feat-text"><strong>9 minutes</strong>Full batch, QA, named files — automated end to end</div>
            </div>
            <div className="cover-feat">
              <div className="cover-feat-icon"><TbWorld /></div>
              <div className="cover-feat-text"><strong>Market-aware</strong>India, MENA, NA — right scenes, right people</div>
            </div>
          </div>

          {/* Comparison table — restored from HTML prototype */}
          <div className="cover-compare">
            <div className="cover-compare-title">vs the alternatives</div>
            <table className="ctable">
              <thead>
                <tr><th>Provider</th><th>Cost</th><th>Time</th><th>Scale</th></tr>
              </thead>
              <tbody>
                <tr className="us"><td>⚡ ChromaCraft AI</td><td>$0.91</td><td>9 min</td><td className="ctick">✓</td></tr>
                <tr><td>Agency</td><td>$250–350</td><td>5–7 days</td><td className="tcross">✗</td></tr>
                <tr><td>Freelancer</td><td>$60–100</td><td>2–4 days</td><td className="tcross">~</td></tr>
                <tr><td>DIY</td><td>8–16 hrs</td><td>1–2 days</td><td className="tcross">✗</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* RHS: Auth */}
        <div className="cover-rhs">
          <div className="auth-header">
            <div className="auth-title">Welcome</div>
            <div className="auth-sub">Sign in to your account or create a new one</div>
          </div>

          <div className="auth-tabs">
            <button className={`auth-tab ${authMode === 'login' ? 'active' : ''}`} onClick={() => setAuthMode('login')}>Sign in</button>
            <button className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`} onClick={() => setAuthMode('signup')}>Create account</button>
          </div>

          {authError && <div className="notice err" style={{ marginBottom: 12 }}>{authError}</div>}

          {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="auth-panel active">
              <div className="social-btns">
                <button type="button" className="social-btn" onClick={() => signIn('google')}><TbBrandGoogle style={{ color: '#4285F4', fontSize: 16 }} /> Google</button>
                <button type="button" className="social-btn" onClick={() => signIn('azure-ad')}><TbBrandWindows style={{ color: '#00A4EF', fontSize: 16 }} /> Microsoft</button>
              </div>
              <div className="auth-divider">or sign in with email</div>
              <div className="form-group">
                <label>Email address</label>
                <Input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Password</label>
                <div className="password-wrap">
                  <Input type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button className="pw-toggle" type="button" onClick={() => setShowPassword(!showPassword)}><TbEye /></button>
                </div>
              </div>
              <div className="forgot">Forgot password?</div>
              <Button type="submit" className="primary" style={{ width: '100%', justifyContent: 'center', padding: '10px' }} disabled={loading}>
                <TbLogin /> {loading ? 'Signing in...' : 'Sign in'}
              </Button>
              <div className="form-footer">Don&apos;t have an account? <a onClick={() => setAuthMode('signup')}>Create one free</a></div>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="auth-panel active">
              <div className="social-btns">
                <button type="button" className="social-btn" onClick={() => signIn('google')}><TbBrandGoogle style={{ color: '#4285F4', fontSize: 16 }} /> Google</button>
                <button type="button" className="social-btn" onClick={() => signIn('azure-ad')}><TbBrandWindows style={{ color: '#00A4EF', fontSize: 16 }} /> Microsoft</button>
              </div>
              <div className="auth-divider">or sign up with email</div>
              <div className="form-row">
                <div className="form-group"><label>First name</label><Input placeholder="Anirban" value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></div>
                <div className="form-group"><label>Last name</label><Input placeholder="G" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
              </div>
              <div className="form-group">
                <label>Work email</label>
                <Input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Password</label>
                <div className="password-wrap">
                  <Input type={showPassword ? 'text' : 'password'} placeholder="Min 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button className="pw-toggle" type="button" onClick={() => setShowPassword(!showPassword)}><TbEye /></button>
                </div>
              </div>
              <div className="terms-check">
                <input type="checkbox" id="terms-cb" defaultChecked />
                <label htmlFor="terms-cb">I agree to the <a style={{ color: 'var(--acc)', cursor: 'pointer' }}>Terms of Service</a> and <a style={{ color: 'var(--acc)', cursor: 'pointer' }}>Privacy Policy</a></label>
              </div>
              <Button type="submit" className="primary" style={{ width: '100%', justifyContent: 'center', padding: '10px' }} disabled={loading}>
                <TbUserPlus /> {loading ? 'Creating...' : 'Create free account'}
              </Button>
              <div className="form-footer">Already have an account? <a onClick={() => setAuthMode('login')}>Sign in</a></div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
