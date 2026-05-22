'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { TopBar } from '../components/layout/TopBar';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import {
  TbBrandGoogle,
  TbBrandWindows,
  TbEye,
  TbLogin,
  TbUserPlus,
  TbArrowLeft,
  TbCloud,
  TbDownload,
  TbLink,
  TbTrash,
  TbCheck,
  TbX,
  TbRefresh,
  TbChartBar,
  TbPlus,
  TbHistory,
  TbPackage,
  TbUpload,
  TbBolt,
  TbClock,
  TbWorld
} from 'react-icons/tb';

type Job = {
  id: number;
  name: string;
  status: 'PENDING' | 'PROCESSING' | 'QA_PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  assets?: Asset[];
};

type Asset = {
  id: number;
  type: string;
  path: string;
  status: 'pending' | 'done' | 'error' | 'approved' | 'rejected';
};

type Provider = {
  id: number;
  name: string;
  default: boolean;
};

export default function Home() {
  const { data: session, status: authStatus } = useSession();
  const [activeTab, setActiveTab] = useState<'home' | 'setup' | 'generate' | 'review' | 'deliver' | 'history'>('home');
  const [nightMode, setNightMode] = useState<boolean>(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Cover Page State
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');

  // Setup / Upload State
  const [jobName, setJobName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');

  // Generate State
  const [promptText, setPromptText] = useState('Luxury leather bag with clean minimalist studio lighting, high resolution, product shot');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);

  // Deliver State
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Sync Night Mode classes
  useEffect(() => {
    if (nightMode) {
      document.body.classList.add('night');
    } else {
      document.body.classList.remove('night');
    }
  }, [nightMode]);

  // Load jobs and providers when session is active
  useEffect(() => {
    if (session) {
      fetchJobs();
      fetchProviders();
    }
  }, [session]);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/v1/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (e) {
      console.error('Error fetching jobs:', e);
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/v1/providers');
      if (res.ok) {
        const data = await res.json();
        setProviders(data);
        const def = data.find((p: Provider) => p.default);
        if (def) setSelectedProviderId(def.id);
      }
    } catch (e) {
      console.error('Error fetching providers:', e);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    const result = await signIn('credentials', {
      redirect: false,
      email,
      password,
    });
    setLoading(false);
    if (result?.error) {
      setAuthError('Invalid email or password');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      setLoading(false);
      if (res.ok) {
        // Auto signin after successful signup
        await signIn('credentials', {
          redirect: false,
          email,
          password,
        });
      } else {
        const data = await res.json();
        setAuthError(data.error || 'Signup failed');
      }
    } catch (e) {
      setLoading(false);
      setAuthError('Signup failed');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError('Please select a file to upload');
      return;
    }
    setUploadError('');
    setLoading(true);

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('name', jobName || uploadFile.name);

    try {
      const res = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });
      setLoading(false);
      if (res.ok) {
        const data = await res.json();
        setSelectedJob(data.job);
        fetchJobs();
        setActiveTab('generate');
      } else {
        const data = await res.json();
        setUploadError(data.error || 'Upload failed');
      }
    } catch (e) {
      setLoading(false);
      setUploadError('Upload failed');
    }
  };

  const handleStartGeneration = async () => {
    if (!selectedJob) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJob.id,
          prompt: promptText,
          providerId: selectedProviderId,
        }),
      });
      setLoading(false);
      if (res.ok) {
        // Fetch fresh job details
        const updatedJobsRes = await fetch('/api/v1/jobs');
        if (updatedJobsRes.ok) {
          const updatedJobs = await updatedJobsRes.json();
          setJobs(updatedJobs);
          const currentJob = updatedJobs.find((j: Job) => j.id === selectedJob.id);
          if (currentJob) setSelectedJob(currentJob);
        }
        setActiveTab('history');
      }
    } catch (e) {
      setLoading(false);
      console.error('Error starting generation:', e);
    }
  };

  const handleQAReview = async (assetId: number, status: 'approved' | 'rejected') => {
    try {
      const res = await fetch('/api/v1/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, status }),
      });
      if (res.ok) {
        fetchJobs();
        if (selectedJob) {
          // Update selected job state locally
          const updatedAssets = selectedJob.assets?.map((a) =>
            a.id === assetId ? { ...a, status } : a
          );
          setSelectedJob({ ...selectedJob, assets: updatedAssets });
        }
      }
    } catch (e) {
      console.error('QA update failed:', e);
    }
  };

  const handleExportUrl = async () => {
    if (!selectedJob) return;
    try {
      const res = await fetch(`/api/v1/export?jobId=${selectedJob.id}&mode=url`);
      if (res.ok) {
        const data = await res.json();
        setExportUrl(data.url);
      }
    } catch (e) {
      console.error('Export URL generation failed:', e);
    }
  };

  // Switch tabs cleanly
  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <div className="screen active">
            <div className="sec">Dashboard</div>
            <div className="card">
              <div className="card-head">
                <TbChartBar style={{ marginRight: '8px', color: 'var(--acc)' }} />
                <div className="card-title">Welcome back, {session?.user?.name || 'User'}</div>
              </div>
              <div className="g3" style={{ marginBottom: 12 }}>
                <div className="ind-card" onClick={() => setActiveTab('setup')}>
                  <TbPlus style={{ fontSize: '18px', display: 'block', margin: '0 auto 4px' }} />
                  <span>New Project</span>
                </div>
                <div className="ind-card" onClick={() => setActiveTab('history')}>
                  <TbHistory style={{ fontSize: '18px', display: 'block', margin: '0 auto 4px' }} />
                  <span>Recent Jobs</span>
                </div>
                <div className="ind-card" onClick={() => setActiveTab('deliver')}>
                  <TbDownload style={{ fontSize: '18px', display: 'block', margin: '0 auto 4px' }} />
                  <span>Downloads</span>
                </div>
              </div>
            </div>

            <div className="sec">Recent Job Status</div>
            <div className="card">
              {jobs.length === 0 ? (
                <p style={{ color: 'var(--tx3)', fontSize: 12 }}>No jobs yet. Click "New Project" to start.</p>
              ) : (
                jobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="job-row" onClick={() => { setSelectedJob(job); setActiveTab('history'); }}>
                    <div className="job-ico">
                      <TbPackage />
                    </div>
                    <div className="job-info">
                      <div className="job-name">{job.name}</div>
                      <div className="job-meta">ID: {job.id} • Created: {new Date(job.createdAt).toLocaleDateString()}</div>
                    </div>
                    <span className={`badge ${job.status === 'COMPLETED' ? 'b-green' : job.status === 'FAILED' ? 'b-red' : 'b-amber'}`}>
                      {job.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'setup':
        return (
          <div className="screen active">
            <div className="sec">Upload Asset</div>
            <div className="card">
              <form onSubmit={handleUpload}>
                <div className="field">
                  <label>Project Name</label>
                  <Input placeholder="e.g. Leather Bag Shoot" value={jobName} onChange={(e) => setJobName(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Asset File</label>
                  <div className="uzone" onClick={() => document.getElementById('file-picker')?.click()}>
                    <TbUpload style={{ fontSize: '28px', display: 'block', margin: '0 auto 6px' }} />
                    <p>{uploadFile ? uploadFile.name : 'Click to select image file'}</p>
                    <small>Support JPG, PNG up to 10MB</small>
                  </div>
                  <input
                    id="file-picker"
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  />
                </div>
                {uploadError && <div className="notice err">{uploadError}</div>}
                <div className="btn-row" style={{ marginTop: 16 }}>
                  <Button type="submit" variant="primary" disabled={loading}>
                    Create & Upload
                  </Button>
                </div>
              </form>
            </div>
          </div>
        );

      case 'generate':
        return (
          <div className="screen active">
            <div className="sec">Generate Image Variants</div>
            <div className="card">
              <div className="field">
                <label>Job Selected</label>
                <select
                  value={selectedJob?.id || ''}
                  onChange={(e) => {
                    const j = jobs.find((x) => x.id === Number(e.target.value));
                    if (j) setSelectedJob(j);
                  }}
                >
                  <option value="">-- Choose Job --</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Prompt Builder</label>
                <textarea
                  className="prompt-editor-area"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Describe details of the background scene, styling, and color options..."
                />
              </div>

              <div className="field">
                <label>AI Provider Selection</label>
                <select
                  value={selectedProviderId || ''}
                  onChange={(e) => setSelectedProviderId(Number(e.target.value))}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} {p.default ? '(default)' : ''}</option>
                  ))}
                  <option value="">Mock AI Engine (Pillow rendering)</option>
                </select>
              </div>

              <div className="btn-row" style={{ marginTop: 16 }}>
                <Button variant="primary" onClick={handleStartGeneration} disabled={loading || !selectedJob}>
                  Start Generating
                </Button>
              </div>
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="screen active">
            <div className="sec">Review & QA</div>
            <div className="card">
              <div className="field">
                <label>Select Job to Review</label>
                <select
                  value={selectedJob?.id || ''}
                  onChange={(e) => {
                    const j = jobs.find((x) => x.id === Number(e.target.value));
                    if (j) setSelectedJob(j);
                  }}
                >
                  <option value="">-- Choose Job --</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
                  ))}
                </select>
              </div>

              {!selectedJob && <p style={{ color: 'var(--tx3)' }}>Please select a job first.</p>}

              {selectedJob && (
                <div className="variant-grid-display">
                  {selectedJob.assets?.filter(a => a.type === 'variant').map((asset) => (
                    <div key={asset.id} className="variant-cell done">
                      <div className="vc-body">
                        <div className="vc-car">🖼️</div>
                        <span className="vc-label">Variant #{asset.id}</span>
                        <span className="vc-status">{asset.status}</span>
                        <div className="btn-row" style={{ marginTop: 8 }}>
                          <Button variant="ghost" onClick={() => handleQAReview(asset.id, 'approved')}>
                            <TbCheck style={{ color: 'var(--suc)' }} /> Approve
                          </Button>
                          <Button variant="ghost" onClick={() => handleQAReview(asset.id, 'rejected')}>
                            <TbX style={{ color: 'var(--err)' }} /> Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case 'deliver':
        return (
          <div className="screen active">
            <div className="sec">Deliver & Export</div>
            <div className="card">
              <div className="field">
                <label>Select Completed Job</label>
                <select
                  value={selectedJob?.id || ''}
                  onChange={(e) => {
                    const j = jobs.find((x) => x.id === Number(e.target.value));
                    if (j) setSelectedJob(j);
                  }}
                >
                  <option value="">-- Choose Job --</option>
                  {jobs.filter(j => j.status === 'COMPLETED').map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </div>

              {selectedJob && (
                <div className="btn-row" style={{ marginTop: 16 }}>
                  <Button variant="primary" onClick={() => window.open(`/api/v1/export?jobId=${selectedJob.id}&mode=stream`)}>
                    <TbDownload /> Download ZIP Package
                  </Button>
                  <Button variant="outline" onClick={handleExportUrl}>
                    <TbLink /> Get Signed URL
                  </Button>
                </div>
              )}

              {exportUrl && (
                <div className="notice ok" style={{ marginTop: 16, wordBreak: 'break-all' }}>
                  <strong>Export URL:</strong> <a href={exportUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--acc)' }}>{exportUrl}</a>
                </div>
              )}
            </div>
          </div>
        );

      case 'history':
        return (
          <div className="screen active">
            <div className="sec">Jobs History</div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <Button variant="ghost" onClick={fetchJobs}><TbRefresh /> Refresh</Button>
              </div>
              {jobs.map((job) => (
                <div key={job.id} className="job-row" onClick={() => setSelectedJob(job)}>
                  <div className="job-ico"><TbHistory /></div>
                  <div className="job-info">
                    <div className="job-name">{job.name}</div>
                    <div className="job-meta">ID: {job.id} • Created: {new Date(job.createdAt).toLocaleDateString()}</div>
                  </div>
                  <span className={`badge ${job.status === 'COMPLETED' ? 'b-green' : job.status === 'FAILED' ? 'b-red' : 'b-amber'}`}>
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
    }
  };

  // If not logged in, render Cover Page
  if (authStatus !== 'authenticated') {
    return (
      <div className="page active" id="page-cover">
        <div className="cover">
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
          </div>
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
                  <button type="button" className="social-btn"><TbBrandGoogle style={{ color: '#4285F4', fontSize: 16 }} /> Google</button>
                  <button type="button" className="social-btn"><TbBrandWindows style={{ color: '#00A4EF', fontSize: 16 }} /> Microsoft</button>
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
                <Button type="submit" className="primary" style={{ width: '100%', justifyContent: 'center', padding: '10px' }} disabled={loading}>
                  <TbLogin /> {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="auth-panel active">
                <div className="social-btns">
                  <button type="button" className="social-btn"><TbBrandGoogle style={{ color: '#4285F4', fontSize: 16 }} /> Google</button>
                  <button type="button" className="social-btn"><TbBrandWindows style={{ color: '#00A4EF', fontSize: 16 }} /> Microsoft</button>
                </div>
                <div className="auth-divider">or sign up with email</div>
                <div className="form-group">
                  <label>First name</label>
                  <Input placeholder="Anirban" value={name} onChange={(e) => setName(e.target.value)} required />
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
                <Button type="submit" className="primary" style={{ width: '100%', justifyContent: 'center', padding: '10px' }} disabled={loading}>
                  <TbUserPlus /> {loading ? 'Creating...' : 'Create account'}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Once authenticated, show dashboard
  return (
    <>
      <TopBar
        nightMode={nightMode}
        onToggleNight={() => setNightMode(!nightMode)}
        onProfileClick={() => signOut()}
      />
      {/* Tab Nav Selector overrides default TopBar tabs for client-side navigation */}
      <div className="topbar" style={{ background: 'var(--bg2)', justifyContent: 'center' }}>
        <div className="nav-links" style={{ justifyContent: 'center' }}>
          <button className={`nav-tab ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>Dashboard</button>
          <button className={`nav-tab ${activeTab === 'setup' ? 'active' : ''}`} onClick={() => setActiveTab('setup')}>New Job</button>
          <button className={`nav-tab ${activeTab === 'generate' ? 'active' : ''}`} onClick={() => setActiveTab('generate')}>Generate</button>
          <button className={`nav-tab ${activeTab === 'review' ? 'active' : ''}`} onClick={() => setActiveTab('review')}>Review / QA</button>
          <button className={`nav-tab ${activeTab === 'deliver' ? 'active' : ''}`} onClick={() => setActiveTab('deliver')}>Deliver</button>
          <button className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Job History</button>
        </div>
      </div>

      <div className="main">{renderTabContent()}</div>
    </>
  );
}
