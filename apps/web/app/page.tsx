'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import type { TabId, Job, Provider } from '../components/shared/types';
import { TbLoader } from 'react-icons/tb';

// Feature components
import { CoverPage } from '../components/auth/CoverPage';
import { DashboardHome } from '../components/dashboard/DashboardHome';
import { UploadSetup } from '../components/workflow/UploadSetup';
import { GeneratePanel } from '../components/workflow/GeneratePanel';
import { ReviewQA } from '../components/workflow/ReviewQA';
import { DeliverExport } from '../components/workflow/DeliverExport';
import { JobHistory } from '../components/workflow/JobHistory';
import { ProfileSettings } from '../components/profile/ProfileSettings';

// Layout
import { TopBar } from '../components/layout/TopBar';

const UC1_STANDARD_COLORS = [
  'Pristine White',
  'Oberon Black',
  'Electric Blue',
  'Empress Red',
];

export default function Home() {
  const { data: session, status: authStatus, update } = useSession();

  // Navigation
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [nightMode, setNightMode] = useState(false);

  // Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Setup configuration state (Prototype Steps 1 to 5)
  const [industry, setIndustry] = useState<string>('Automotive');
  const [modelName, setModelName] = useState<string>('');
  const [filenamePrefix, setFilenamePrefix] = useState<string>('');
  const [targetAudience, setTargetAudience] = useState<string>('General consumers');
  const [targetMarket, setTargetMarket] = useState<string>('India');
  const [targetPurpose, setTargetPurpose] = useState<string>('Product catalog');
  
  // Output steps & color configuration
  const [gridCols, setGridCols] = useState<number>(2);
  const [gridRows, setGridRows] = useState<number>(2);
  const [lifestyleEnabled, setLifestyleEnabled] = useState<boolean>(false);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(false);
  const [spinEnabled, setSpinEnabled] = useState<boolean>(false);
  const [cropsEnabled, setCropsEnabled] = useState<boolean>(false);
  const [customColors, setCustomColors] = useState<string[]>([...UC1_STANDARD_COLORS]);

  // Upload/File variables
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');

  // Generate / Prompt
  const [promptText, setPromptText] = useState('Generate a photorealistic [] in [COLOR] paint.');
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

  // Update promptText dynamically when setup parameters change
  useEffect(() => {
    const prompt = `Generate a photorealistic [${modelName || 'Mitsubishi ASX'}] in [COLOR] paint.\nAudience: ${targetAudience.toLowerCase()} · ${targetMarket.toLowerCase()} market.\nUse: ${targetPurpose.toLowerCase()}.\nView: front-right three-quarter. Drive: LHD.\nPlate: white, blank. Background: pure white. No overlap.`;
    setPromptText(prompt);
  }, [modelName, targetAudience, targetMarket, targetPurpose]);

  // Polling effect for active job status during generation
  useEffect(() => {
    if (activeTab !== 'generate' && activeTab !== 'review') return;
    if (!selectedJob) return;
    if (selectedJob.status !== 'PENDING' && selectedJob.status !== 'PROCESSING') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/jobs');
        if (res.ok) {
          const data = await res.json();
          const safeData = Array.isArray(data) ? data : [];
          setJobs(safeData);
          const currentJob = safeData.find((j) => j.id === selectedJob.id);
          if (currentJob) {
            setSelectedJob(currentJob);
            if (currentJob.status !== 'PENDING' && currentJob.status !== 'PROCESSING') {
              clearInterval(interval);
            }
          }
        }
      } catch (e) {
        console.error('Polling error:', e);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeTab, selectedJob]);

  // ── API Handlers ──

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/v1/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(Array.isArray(data) ? data : []);
      } else {
        setJobs([]);
      }
    } catch (e) {
      console.error('Error fetching jobs:', e);
      setJobs([]);
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/v1/providers');
      if (res.ok) {
        const data = await res.json();
        const safeData = Array.isArray(data) ? data : [];
        setProviders(safeData);
        const def = safeData.find((p: Provider) => p.default);
        if (def) setSelectedProviderId(def.id);
      } else {
        setProviders([]);
      }
    } catch (e) {
      console.error('Error fetching providers:', e);
      setProviders([]);
    }
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
    if (!modelName || !industry || !targetAudience || !targetMarket) {
      setUploadError('Please complete all required fields (Product Name, Industry, Audience, Market).');
      return;
    }
    setUploadError('');
    setLoading(true);

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('name', modelName || uploadFile.name);

    try {
      // 1. Upload File & Create Job
      const uploadRes = await fetch('/api/v1/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json();
        setUploadError(errData.error || 'Upload failed');
        setLoading(false);
        return;
      }
      const uploadData = await uploadRes.json();
      const job = uploadData.job;

      // 2. Trigger Generation API immediately with unified settings
      const settings = {
        prefix: filenamePrefix || (modelName || uploadFile.name).trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, ''),
        colors: customColors.slice(0, gridCols * gridRows),
        cols: gridCols,
        rows: gridRows,
        industry,
        targetMarket,
        targetAudience,
        targetPurpose,
        lifestyleEnabled,
        videoEnabled,
        spinEnabled,
        cropsEnabled,
      };

      const selectedProvider = providers.find(p => p.id === selectedProviderId);
      const hasApiKey = selectedProvider && !selectedProvider.name.toLowerCase().includes('mock') && !!selectedProvider.hasApiKey;

      let success = false;
      let errMsg = '';

      if (hasApiKey) {
        const generateRes = await fetch('/api/v1/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            prompt: promptText,
            providerId: selectedProviderId,
            settings,
          }),
        });
        success = generateRes.ok;
        if (!success) {
          const errData = await generateRes.json().catch(() => ({}));
          errMsg = errData.error || 'Generation trigger failed';
        }
      } else {
        // Free/Puter flow - save prompt/settings but keep status PENDING
        const saveRes = await fetch('/api/v1/jobs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: job.id,
            prompt: promptText,
            settings,
          }),
        });
        success = saveRes.ok;
        if (!success) errMsg = 'Failed to save workflow settings';
      }

      setLoading(false);
      if (success) {
        // Fetch jobs to get latest processing state
        const updatedJobsRes = await fetch('/api/v1/jobs');
        if (updatedJobsRes.ok) {
          const updatedJobs = await updatedJobsRes.json();
          setJobs(updatedJobs);
          const currentJob = updatedJobs.find((j: Job) => j.id === job.id);
          if (currentJob) setSelectedJob(currentJob);
        }
        // Redirect to generate progress tab
        setActiveTab('generate');
      } else {
        setUploadError(errMsg);
      }
    } catch (err: any) {
      setLoading(false);
      setUploadError(err.message || 'Workflow initialization failed');
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

  const handleExportUrl = async (format?: string) => {
    if (!selectedJob) return;
    try {
      const formatParam = format ? `&format=${format}` : '&format=png';
      const res = await fetch(`/api/v1/export?jobId=${selectedJob.id}&mode=url${formatParam}`);
      if (res.ok) {
        const data = await res.json();
        setExportUrl(data.url);
      }
    } catch (e) { console.error('Export URL generation failed:', e); }
  };

  // ── Render ──

  if (authStatus === 'unauthenticated') {
    return <CoverPage onLogin={handleLogin} onSignup={handleSignup} loading={loading} authError={authError} />;
  }

  if (authStatus === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <TbLoader className="spin" size={32} style={{ color: 'var(--acc)' }} />
      </div>
    );
  }

  const userName = session?.user?.name || 'User';
  const userInitials = userName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const renderTab = () => {
    switch (activeTab) {
      case 'home':
        return <DashboardHome userName={userName} jobs={jobs} onNavigate={setActiveTab} onSelectJob={setSelectedJob} />;
      case 'setup':
        return (
          <UploadSetup
            uploadFile={uploadFile}
            onFileChange={setUploadFile}
            uploadError={uploadError}
            loading={loading}
            onSubmit={handleUpload}
            industry={industry}
            onIndustryChange={setIndustry}
            modelName={modelName}
            onModelNameChange={setModelName}
            filenamePrefix={filenamePrefix}
            onFilenamePrefixChange={setFilenamePrefix}
            targetAudience={targetAudience}
            onTargetAudienceChange={setTargetAudience}
            targetMarket={targetMarket}
            onTargetMarketChange={setTargetMarket}
            targetPurpose={targetPurpose}
            onTargetPurposeChange={setTargetPurpose}
            gridCols={gridCols}
            onGridColsChange={setGridCols}
            gridRows={gridRows}
            onGridRowsChange={setGridRows}
            lifestyleEnabled={lifestyleEnabled}
            onLifestyleChange={setLifestyleEnabled}
            videoEnabled={videoEnabled}
            onVideoChange={setVideoEnabled}
            spinEnabled={spinEnabled}
            onSpinChange={setSpinEnabled}
            cropsEnabled={cropsEnabled}
            onCropsChange={setCropsEnabled}
            customColors={customColors}
            onCustomColorsChange={setCustomColors}
            promptText={promptText}
            onPromptChange={setPromptText}
            selectedProviderId={selectedProviderId}
            onSelectProvider={setSelectedProviderId}
            providers={providers}
          />
        );
      case 'generate':
        return (
          <GeneratePanel
            jobs={jobs}
            selectedJob={selectedJob}
            onSelectJob={setSelectedJob}
            promptText={promptText}
            onPromptChange={setPromptText}
            providers={providers}
            selectedProviderId={selectedProviderId}
            onSelectProvider={setSelectedProviderId}
            loading={loading}
            onStartGeneration={handleStartGeneration}
            onNavigate={setActiveTab}
          />
        );
      case 'review':
        return <ReviewQA jobs={jobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} onQAReview={handleQAReview} onNavigate={setActiveTab} />;
      case 'deliver':
        return <DeliverExport jobs={jobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} exportUrl={exportUrl} onExportUrl={handleExportUrl} />;
      case 'history':
        return <JobHistory jobs={jobs} onRefresh={fetchJobs} onSelectJob={setSelectedJob} />;
      case 'profile':
        return (
          <ProfileSettings
            userName={userName}
            userEmail={session?.user?.email || ''}
            userInitials={userInitials}
            nightMode={nightMode}
            onToggleNight={() => setNightMode(!nightMode)}
            onSignOut={async () => {
              await signOut({ callbackUrl: '/' });
            }}
            onProvidersUpdated={fetchProviders}
            onProfileUpdated={(newName) => update({ name: newName })}
          />
        );
    }
  };

  return (
    <>
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        nightMode={nightMode}
        onToggleNight={() => setNightMode(!nightMode)}
        onProfileClick={() => setActiveTab('profile')}
        userInitials={userInitials}
      />
      <div className="main">{renderTab()}</div>
    </>
  );
}
