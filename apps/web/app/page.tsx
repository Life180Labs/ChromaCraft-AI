'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import type { TabId, Job, Provider } from '../components/shared/types';

// Feature components
import { CoverPage } from '../components/auth/CoverPage';
import { DashboardHome } from '../components/dashboard/DashboardHome';
import { UploadSetup } from '../components/workflow/UploadSetup';
import { GeneratePanel } from '../components/workflow/GeneratePanel';
import { ReviewQA } from '../components/workflow/ReviewQA';
import { DeliverExport } from '../components/workflow/DeliverExport';
import { JobHistory } from '../components/workflow/JobHistory';

// Layout
import { TopBar } from '../components/layout/TopBar';
import { WorkflowTabs } from '../components/layout/WorkflowTabs';

export default function Home() {
  const { data: session, status: authStatus } = useSession();

  // Navigation
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [nightMode, setNightMode] = useState(false);

  // Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Upload
  const [jobName, setJobName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');

  // Generate
  const [promptText, setPromptText] = useState('Luxury leather bag with clean minimalist studio lighting, high resolution, product shot');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);

  // Deliver
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // ── Effects ──

  useEffect(() => {
    if (nightMode) document.body.classList.add('night');
    else document.body.classList.remove('night');
  }, [nightMode]);

  useEffect(() => {
    if (session) { fetchJobs(); fetchProviders(); }
  }, [session]);

  // ── API Handlers ──

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/v1/jobs');
      if (res.ok) setJobs(await res.json());
    } catch (e) { console.error('Error fetching jobs:', e); }
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
    } catch (e) { console.error('Error fetching providers:', e); }
  };

  const handleLogin = async (email: string, password: string) => {
    setAuthError('');
    setLoading(true);
    const result = await signIn('credentials', { redirect: false, email, password });
    setLoading(false);
    if (result?.error) setAuthError('Invalid email or password');
  };

  const handleSignup = async (email: string, password: string, name: string) => {
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
        await signIn('credentials', { redirect: false, email, password });
      } else {
        const data = await res.json();
        setAuthError(data.error || 'Signup failed');
      }
    } catch {
      setLoading(false);
      setAuthError('Signup failed');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) { setUploadError('Please select a file to upload'); return; }
    setUploadError('');
    setLoading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('name', jobName || uploadFile.name);
    try {
      const res = await fetch('/api/v1/upload', { method: 'POST', body: formData });
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
    } catch {
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
        body: JSON.stringify({ jobId: selectedJob.id, prompt: promptText, providerId: selectedProviderId }),
      });
      setLoading(false);
      if (res.ok) {
        const updatedJobsRes = await fetch('/api/v1/jobs');
        if (updatedJobsRes.ok) {
          const updatedJobs = await updatedJobsRes.json();
          setJobs(updatedJobs);
          const currentJob = updatedJobs.find((j: Job) => j.id === selectedJob.id);
          if (currentJob) setSelectedJob(currentJob);
        }
        setActiveTab('history');
      }
    } catch {
      setLoading(false);
      console.error('Error starting generation');
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
          const updatedAssets = selectedJob.assets?.map((a) =>
            a.id === assetId ? { ...a, status } : a
          );
          setSelectedJob({ ...selectedJob, assets: updatedAssets });
        }
      }
    } catch (e) { console.error('QA update failed:', e); }
  };

  const handleExportUrl = async () => {
    if (!selectedJob) return;
    try {
      const res = await fetch(`/api/v1/export?jobId=${selectedJob.id}&mode=url`);
      if (res.ok) {
        const data = await res.json();
        setExportUrl(data.url);
      }
    } catch (e) { console.error('Export URL generation failed:', e); }
  };

  // ── Render ──

  if (authStatus !== 'authenticated') {
    return <CoverPage onLogin={handleLogin} onSignup={handleSignup} loading={loading} authError={authError} />;
  }

  const userName = session?.user?.name || 'User';
  const userInitials = userName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const renderTab = () => {
    switch (activeTab) {
      case 'home':
        return <DashboardHome userName={userName} jobs={jobs} onNavigate={setActiveTab} onSelectJob={setSelectedJob} />;
      case 'setup':
        return <UploadSetup jobName={jobName} onJobNameChange={setJobName} uploadFile={uploadFile} onFileChange={setUploadFile} uploadError={uploadError} loading={loading} onSubmit={handleUpload} />;
      case 'generate':
        return <GeneratePanel jobs={jobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} promptText={promptText} onPromptChange={setPromptText} providers={providers} selectedProviderId={selectedProviderId} onSelectProvider={setSelectedProviderId} loading={loading} onStartGeneration={handleStartGeneration} />;
      case 'review':
        return <ReviewQA jobs={jobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} onQAReview={handleQAReview} />;
      case 'deliver':
        return <DeliverExport jobs={jobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} exportUrl={exportUrl} onExportUrl={handleExportUrl} />;
      case 'history':
        return <JobHistory jobs={jobs} onRefresh={fetchJobs} onSelectJob={setSelectedJob} />;
    }
  };

  return (
    <>
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        nightMode={nightMode}
        onToggleNight={() => setNightMode(!nightMode)}
        onProfileClick={() => signOut()}
        userInitials={userInitials}
      />
      <WorkflowTabs activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="main">{renderTab()}</div>
    </>
  );
}
