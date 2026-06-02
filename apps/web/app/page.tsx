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
  'White',
  'Black',
  'Blue',
  'Red',
  'Green',
  'Brown',
  'Silver',
  'Yellow',
  'Cream',
  'Pink',
  'Dark Blue',
  'Orange',
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
  const [gridCols, setGridCols] = useState<number>(4);
  const [gridRows, setGridRows] = useState<number>(3);
  const [lifestyleEnabled, setLifestyleEnabled] = useState<boolean>(false);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(false);
  const [videoPrompt, setVideoPrompt] = useState<string>('Cinematic showcase of the product under dynamic studio lighting');
  const [spinEnabled, setSpinEnabled] = useState<boolean>(false);
  const [cropsEnabled, setCropsEnabled] = useState<boolean>(true);
  const [customColors, setCustomColors] = useState<string[]>([...UC1_STANDARD_COLORS]);
  const [additionalContext, setAdditionalContext] = useState<string>('');

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
    const getIndustryDescription = (ind: string) => {
      switch (ind) {
        case 'Automotive': return 'vehicle (car/SUV/truck)';
        case '2-Wheeler': return '2-wheeler (bike/motorcycle/scooty/e-moped)';
        case 'Apparel': return 'clothing/apparel/jewelry/garment';
        case 'Footwear': return 'footwear (shoes/sneakers/formal/athletic)';
        case 'Electronics': return 'electronic device (laptop/smartphone)';
        case 'Furniture': return 'furniture (table/chair/sofa/decor)';
        default: return 'product';
      }
    };
    
    const industryDesc = getIndustryDescription(industry);
    const audienceDesc = targetAudience ? `Targeting: ${targetAudience.toLowerCase()} in ${targetMarket.toLowerCase()} market` : '';
    const purposeDesc = targetPurpose ? `Purpose: ${targetPurpose.toLowerCase()}` : '';
    const contextDesc = additionalContext ? `Context: ${additionalContext.trim()}` : '';

    const prompt = `Generate an identity-preserved catalog image of the ${industryDesc} [${modelName || 'Product'}] in [COLOR] color.
${audienceDesc ? audienceDesc + '\n' : ''}${purposeDesc ? purposeDesc + '\n' : ''}${contextDesc ? contextDesc + '\n' : ''}CRITICAL: Keep the product shape, geometry, proportions, camera angle, and structural details completely identical to the source image. Change only the color/texture to [COLOR].`;
    setPromptText(prompt);
  }, [industry, modelName, targetAudience, targetMarket, targetPurpose, additionalContext]);

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

      // 2. Save settings (no pipeline — user will trigger generation from Generate tab)
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
        videoPrompt,
        spinEnabled,
        cropsEnabled,
        additionalContext,
      };

      await fetch('/api/v1/jobs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, prompt: promptText, settings }),
      });

      setLoading(false);

      // Fetch jobs to get latest state
      const updatedJobsRes = await fetch('/api/v1/jobs');
      if (updatedJobsRes.ok) {
        const updatedJobs = await updatedJobsRes.json();
        setJobs(updatedJobs);
        const currentJob = updatedJobs.find((j: Job) => j.id === job.id);
        if (currentJob) setSelectedJob(currentJob);
      }

      // Navigate to generate tab so user can review prompt and trigger
      setActiveTab('generate');
    } catch (err: any) {
      setLoading(false);
      setUploadError(err.message || 'Workflow initialization failed');
    }
  };


  // Reset all state for a fresh job
  const handleStartNewJob = () => {
    setSelectedJob(null);
    setUploadFile(null);
    setUploadError('');
    setExportUrl(null);
    setModelName('');
    setFilenamePrefix('');
    setIndustry('Automotive');
    setTargetAudience('General consumers');
    setTargetMarket('India');
    setTargetPurpose('Product catalog');
    setGridCols(4);
    setGridRows(3);
    setLifestyleEnabled(false);
    setVideoEnabled(false);
    setVideoPrompt('Cinematic showcase of the product under dynamic studio lighting');
    setSpinEnabled(false);
    setCropsEnabled(true);
    setCustomColors([...UC1_STANDARD_COLORS]);
    setAdditionalContext('');
    setActiveTab('setup');
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
        // Navigate to review instead of history
        setActiveTab('review');
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
        return <DashboardHome userName={userName} jobs={jobs} onNavigate={setActiveTab} onSelectJob={setSelectedJob} onNewJob={handleStartNewJob} />;
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
            videoPrompt={videoPrompt}
            onVideoPromptChange={setVideoPrompt}
            spinEnabled={spinEnabled}
            onSpinChange={setSpinEnabled}
            cropsEnabled={cropsEnabled}
            onCropsChange={setCropsEnabled}
            customColors={customColors}
            onCustomColorsChange={setCustomColors}
            additionalContext={additionalContext}
            onAdditionalContextChange={setAdditionalContext}
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
        onTabChange={(tab) => {
          // When clicking "New Job" tab (setup), always reset state
          if (tab === 'setup') {
            handleStartNewJob();
          } else {
            setActiveTab(tab);
          }
        }}
        nightMode={nightMode}
        onToggleNight={() => setNightMode(!nightMode)}
        onProfileClick={() => setActiveTab('profile')}
        userInitials={userInitials}
      />
      <div className="main">{renderTab()}</div>
    </>
  );
}
