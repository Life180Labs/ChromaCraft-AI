'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  TbLoader, TbCheck, TbAlertCircle, TbPalette, TbPhoto,
  TbChevronRight, TbX, TbSparkles, TbPlayerPlay, TbBrandGoogle,
  TbRefresh, TbGrid3X3, TbVideo,
} from 'react-icons/tb';
import { Button } from '../ui/Button';
import type { Job, TabId, Provider } from '../shared/types';

type GeneratePanelProps = {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job) => void;
  promptText: string;
  onPromptChange: (v: string) => void;
  providers: Provider[];
  selectedProviderId: number | null;
  onSelectProvider: (id: number | null) => void;
  loading: boolean;
  onStartGeneration: () => void;
  onNavigate?: (tab: TabId) => void;
};

const COLOR_HEX: Record<string, string> = {
  'White': '#ffffff', 'Black': '#111111', 'Blue': '#2563eb', 'Red': '#dc2626',
  'Green': '#16a34a', 'Brown': '#78350f', 'Silver': '#9ca3af', 'Yellow': '#facc15',
  'Cream': '#fef3c7', 'Pink': '#db2777', 'Dark Blue': '#1e3a8a', 'Orange': '#ea580c',
};

type ColorStatus = 'queued' | 'generating' | 'done' | 'failed';

type ColorCard = {
  name: string;
  status: ColorStatus;
  assetId?: number;
  error?: string;
};

export const GeneratePanel: React.FC<GeneratePanelProps> = ({
  jobs = [], selectedJob, onSelectJob, promptText, onPromptChange,
  providers, selectedProviderId, onSelectProvider, loading, onStartGeneration, onNavigate,
}) => {
  const safeJobs = Array.isArray(jobs) ? jobs : [];

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [genSuccess, setGenSuccess] = useState('');
  const [colorCards, setColorCards] = useState<ColorCard[]>([]);
  const [imageModel, setImageModel] = useState('gemini-2.0-flash-preview-image-generation');
  const [videoModel, setVideoModel] = useState('veo-2.0-generate-001');
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  // Prompt preview edit
  const [showPromptEdit, setShowPromptEdit] = useState(false);

  const metadata = selectedJob?.generation?.metadata || {};
  const configuredColors: string[] = metadata.colors || Object.keys(COLOR_HEX);
  const gridCols = metadata.cols || 4;

  // Load model settings
  useEffect(() => {
    fetch('/api/v1/settings')
      .then(r => r.json())
      .then(d => {
        if (d.geminiImageModel) setImageModel(d.geminiImageModel);
        if (d.geminiVideoModel) setVideoModel(d.geminiVideoModel);
      })
      .catch(() => {});
  }, []);

  // Sync color cards from job assets
  useEffect(() => {
    if (!selectedJob) { setColorCards([]); return; }
    const cards: ColorCard[] = configuredColors.map(name => {
      const safeSlug = name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
      const asset = selectedJob.assets?.find(a =>
        (a.type === 'variant' || a.type === 'processed') &&
        (a.path.toLowerCase().includes(`raw_${safeSlug}`) || a.path.toLowerCase().includes(`_${safeSlug}.png`))
      );
      const status: ColorStatus = asset
        ? (asset.status === 'done' || asset.status === 'approved' || asset.status === 'pending' ? 'done' : 'failed')
        : (selectedJob.status === 'COMPLETED' || selectedJob.status === 'FAILED' ? 'queued' : 'queued');
      return { name, status, assetId: asset?.id };
    });
    setColorCards(cards);
  }, [selectedJob]);

  const handleGenerate = async () => {
    if (!selectedJob) return;
    setIsGenerating(true);
    setGenError('');
    setGenSuccess('');

    // Mark all as queued
    setColorCards(configuredColors.map(name => ({ name, status: 'queued' })));

    // Simulate per-color "generating" UI (since the real API is one round-trip)
    // Show each color as "generating" sequentially while API runs
    const animInterval = setInterval(() => {
      setColorCards(prev => {
        const firstQueued = prev.findIndex(c => c.status === 'queued');
        if (firstQueued === -1) { clearInterval(animInterval); return prev; }
        return prev.map((c, i) => i === firstQueued ? { ...c, status: 'generating' } : c);
      });
    }, 800);

    try {
      const settings = {
        ...metadata,
        colors: configuredColors,
        imageModel,
        videoModel,
        // Ensure videoPrompt is always explicitly included
        videoPrompt: metadata.videoPrompt || 'Cinematic showcase of the product under dynamic studio lighting',
      };

      const res = await fetch('/api/v1/generate-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJob.id,
          prompt: promptText,
          settings,
        }),
      });

      clearInterval(animInterval);

      const data = await res.json();

      if (!res.ok) {
        setGenError(data.error || 'Generation failed');
        setColorCards(prev => prev.map(c => ({ ...c, status: c.status === 'generating' ? 'failed' : c.status })));
        return;
      }

      // Refresh job to get new assets
      const jobsRes = await fetch('/api/v1/jobs');
      if (jobsRes.ok) {
        const updatedJobs = await jobsRes.json();
        const updatedJob = updatedJobs.find((j: Job) => j.id === selectedJob.id);
        if (updatedJob) onSelectJob(updatedJob);
      }

      setGenSuccess(`✓ Generated ${data.generated}/${data.total} color variants. Review your results in the Review tab.`);
      if (data.failed?.length > 0) {
        setGenError(`${data.failed.length} color(s) failed: ${data.failed.map((f: any) => f.color).join(', ')}`);
      }
      // Auto-navigate to review tab after successful generation
      onNavigate?.('review');
      onStartGeneration();
    } catch (err: any) {
      clearInterval(animInterval);
      setGenError(err.message || 'Generation failed');
      setColorCards(prev => prev.map(c => ({ ...c, status: 'failed' as ColorStatus })));
    } finally {
      setIsGenerating(false);
    }
  };

  const getStatusIcon = (status: ColorStatus) => {
    switch (status) {
      case 'generating': return <TbLoader className="spin" size={18} style={{ color: 'var(--acc)' }} />;
      case 'done':       return <TbCheck size={16} style={{ color: 'var(--suc)' }} />;
      case 'failed':     return <TbAlertCircle size={16} style={{ color: 'var(--err)' }} />;
      default:           return null;
    }
  };

  const isJobRunning = selectedJob?.status === 'PROCESSING' || selectedJob?.status === 'PENDING';
  const isCompleted = selectedJob?.status === 'COMPLETED';
  const doneCount = colorCards.filter(c => c.status === 'done').length;

  const videoAsset = selectedJob?.assets?.find(a => a.type === 'video');
  const gridAsset = selectedJob?.assets?.find(a => a.type === 'grid');
  const spinAsset = selectedJob?.assets?.find(a => a.type === 'spin');

  const gridStatus = gridAsset 
    ? 'done' 
    : (isGenerating ? 'generating' : (selectedJob?.status === 'FAILED' ? 'failed' : 'queued'));

  const videoStatus = videoAsset 
    ? 'done' 
    : (isGenerating ? 'generating' : (selectedJob?.status === 'FAILED' ? 'failed' : 'queued'));

  const spinStatus = spinAsset 
    ? 'done' 
    : (isGenerating ? 'generating' : (selectedJob?.status === 'FAILED' ? 'failed' : 'queued'));

  return (
    <div className="screen active">

      {/* ─── Job selector ───────────────────────────────────── */}
      <div className="cost-bar" style={{ padding: '10px 14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '11px', color: 'var(--tx3)' }}>Generation Job:</label>
          <select
            id="gen-job-select"
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const j = safeJobs.find((x) => x.id === Number(e.target.value));
              if (j) onSelectJob(j);
            }}
            style={{
              background: 'var(--bg)', border: '1px solid var(--bd)',
              borderRadius: '4px', padding: '4px 8px', fontSize: '12px', color: 'var(--tx)',
            }}
          >
            <option value="">-- Select Job --</option>
            {safeJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
            ))}
          </select>

          {selectedJob && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span className={`badge ${isCompleted ? 'b-green' : isJobRunning ? 'b-amber' : 'b-gray'}`}>
                {isCompleted ? `Complete · ${doneCount}/${configuredColors.length}` : selectedJob.status}
              </span>
            </div>
          )}
        </div>
      </div>

      {!selectedJob ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
          <TbPhoto size={32} style={{ color: 'var(--tx4)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--tx2)' }}>Select a job from the Setup tab to begin generation.</p>
          <Button variant="primary" style={{ marginTop: 12 }} onClick={() => onNavigate?.('setup')}>
            Go to Setup <TbChevronRight size={14} style={{ marginLeft: 4 }} />
          </Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>

          {/* ─── Left: Color grid ─────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Prompt preview */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TbSparkles size={14} style={{ color: 'var(--acc)' }} /> Generation Prompt
                </span>
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--acc)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setShowPromptEdit(v => !v)}
                >
                  {showPromptEdit ? 'Collapse' : 'Edit prompt'}
                </button>
              </div>
              {showPromptEdit ? (
                <textarea
                  id="gen-prompt-textarea"
                  value={promptText}
                  onChange={(e) => onPromptChange(e.target.value)}
                  rows={5}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 6,
                    padding: '8px 10px', fontSize: 11, color: 'var(--tx)', lineHeight: 1.5,
                    fontFamily: 'monospace', outline: 'none',
                  }}
                />
              ) : (
                <div style={{
                  background: 'var(--bg2)', borderRadius: 6, padding: '8px 10px',
                  fontSize: 11, color: 'var(--tx2)', lineHeight: 1.5,
                  fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 80, overflow: 'hidden',
                }}>
                  {promptText.replace(/\[COLOR\]/gi, configuredColors[0] || 'White').slice(0, 280)}
                  {promptText.length > 280 && '…'}
                </div>
              )}
            </div>

            {/* Color variant grid */}
            <div
              id="color-variant-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(gridCols, 4)}, 1fr)`,
                gap: 12,
              }}
            >
              {colorCards.map((card, idx) => {
                const hex = COLOR_HEX[card.name] || '#888';
                const asset = card.assetId
                  ? selectedJob.assets?.find(a => a.id === card.assetId)
                  : null;
                const showImage = card.status === 'done' && asset && !failedImages.has(asset.id);

                return (
                  <div
                    key={idx}
                    className={`variant-cell ${card.status === 'failed' ? 'error' : card.status === 'done' ? 'done' : card.status === 'generating' ? 'generating' : 'pending'}`}
                    style={{ position: 'relative', overflow: 'hidden' }}
                  >
                    <div className="vc-swatch" style={{ background: hex }} />
                    <div className="vc-body">
                      {showImage ? (
                        <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 4 }}>
                          <img
                            src={`/api/v1/assets?id=${asset!.id}`}
                            alt={card.name}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
                            onError={() => setFailedImages(prev => new Set(prev).add(asset!.id))}
                          />
                        </div>
                      ) : card.status === 'generating' ? (
                        <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <TbLoader className="spin" size={24} style={{ color: 'var(--acc)' }} />
                        </div>
                      ) : (
                        <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: hex, border: '2px solid var(--bd)' }} />
                        </div>
                      )}
                      <div className="vc-label">{card.name}</div>
                      <div className="vc-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        {getStatusIcon(card.status)}
                        {card.status === 'done' ? 'Done' : card.status === 'failed' ? 'Failed' : card.status === 'generating' ? 'Generating…' : 'Queued'}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Grid Collage Card */}
              <div
                className={`variant-cell ${gridStatus === 'failed' ? 'error' : gridStatus === 'done' ? 'done' : gridStatus === 'generating' ? 'generating' : 'pending'}`}
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                <div className="vc-swatch" style={{ background: 'var(--acc)' }} />
                <div className="vc-body">
                  {gridAsset ? (
                    <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 4 }}>
                      <img
                        src={`/api/v1/assets?id=${gridAsset.id}`}
                        alt="Grid Collage"
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
                      />
                    </div>
                  ) : gridStatus === 'generating' ? (
                    <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TbLoader className="spin" size={24} style={{ color: 'var(--acc)' }} />
                    </div>
                  ) : (
                    <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TbGrid3X3 size={32} style={{ color: 'var(--tx3)' }} />
                    </div>
                  )}
                  <div className="vc-label">Grid Collage</div>
                  <div className="vc-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    {getStatusIcon(gridStatus as ColorStatus)}
                    {gridStatus === 'done' ? 'Done' : gridStatus === 'failed' ? 'Failed' : gridStatus === 'generating' ? 'Generating…' : 'Queued'}
                  </div>
                </div>
              </div>

              {/* Showcase Video Card */}
              {(metadata.videoEnabled || videoAsset) && (
                <div
                  className={`variant-cell ${videoStatus === 'failed' ? 'error' : videoStatus === 'done' ? 'done' : videoStatus === 'generating' ? 'generating' : 'pending'}`}
                  style={{ position: 'relative', overflow: 'hidden' }}
                >
                  <div className="vc-swatch" style={{ background: '#7c3aed' }} />
                  <div className="vc-body">
                    {videoAsset ? (
                      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 4 }}>
                        <video
                          src={`/api/v1/assets?id=${videoAsset.id}`}
                          autoPlay loop muted playsInline
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
                        />
                      </div>
                    ) : videoStatus === 'generating' ? (
                      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TbLoader className="spin" size={24} style={{ color: 'var(--acc)' }} />
                      </div>
                    ) : (
                      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TbVideo size={32} style={{ color: 'var(--tx3)' }} />
                      </div>
                    )}
                    <div className="vc-label">Showcase Video</div>
                    <div className="vc-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      {getStatusIcon(videoStatus as ColorStatus)}
                      {videoStatus === 'done' ? 'Done' : videoStatus === 'failed' ? 'Failed' : videoStatus === 'generating' ? 'Generating…' : 'Queued'}
                    </div>
                  </div>
                </div>
              )}

              {/* 360° Spin Card */}
              {(metadata.spinEnabled || spinAsset) && (
                <div
                  className={`variant-cell ${spinStatus === 'failed' ? 'error' : spinStatus === 'done' ? 'done' : spinStatus === 'generating' ? 'generating' : 'pending'}`}
                  style={{ position: 'relative', overflow: 'hidden' }}
                >
                  <div className="vc-swatch" style={{ background: '#ec4899' }} />
                  <div className="vc-body">
                    {spinAsset ? (
                      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 4 }}>
                        <img
                          src={`/api/v1/assets?id=${spinAsset.id}`}
                          alt="360° Spin"
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
                        />
                      </div>
                    ) : spinStatus === 'generating' ? (
                      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TbLoader className="spin" size={24} style={{ color: 'var(--acc)' }} />
                      </div>
                    ) : (
                      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TbSparkles size={32} style={{ color: 'var(--tx3)' }} />
                      </div>
                    )}
                    <div className="vc-label">360° Spin</div>
                    <div className="vc-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      {getStatusIcon(spinStatus as ColorStatus)}
                      {spinStatus === 'done' ? 'Done' : spinStatus === 'failed' ? 'Failed' : spinStatus === 'generating' ? 'Generating…' : 'Queued'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error/success messages */}
            {genError && (
              <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid var(--err)', borderRadius: 6, fontSize: 12, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TbAlertCircle size={14} /> {genError}
              </div>
            )}
            {genSuccess && !genError && (
              <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid var(--suc)', borderRadius: 6, fontSize: 12, color: 'var(--suc)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TbCheck size={14} /> {genSuccess}
              </div>
            )}

            {/* Navigate to review */}
            {isCompleted && doneCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" onClick={() => onNavigate?.('review')}>
                  Review Generated Images <TbChevronRight size={14} style={{ marginLeft: 4 }} />
                </Button>
              </div>
            )}
          </div>

          {/* ─── Right: Controls ──────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Model info */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TbBrandGoogle size={14} style={{ color: 'var(--acc)' }} /> Gemini Model
              </div>
              <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 6 }}>Image Model</div>
              <div style={{
                background: 'var(--bg2)', borderRadius: 4, padding: '6px 10px',
                fontSize: 10, fontFamily: 'monospace', color: 'var(--tx2)',
                marginBottom: 12, wordBreak: 'break-all',
              }}>
                {imageModel}
              </div>
              <div style={{ fontSize: 10, color: 'var(--tx4)', lineHeight: 1.5 }}>
                Change model in <strong>Profile → Generation Model Settings</strong>
              </div>
            </div>

            {/* Colors summary */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TbPalette size={14} style={{ color: 'var(--acc)' }} /> Colors ({configuredColors.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {configuredColors.map(c => (
                  <div
                    key={c}
                    title={c}
                    style={{
                      width: 20, height: 20, borderRadius: 4,
                      background: COLOR_HEX[c] || '#888',
                      border: '1px solid var(--bd)',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Generate button */}
            <div className="card" style={{ padding: 16 }}>
              <Button
                id="start-generation-btn"
                variant="primary"
                onClick={handleGenerate}
                disabled={isGenerating || loading}
                style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 13 }}
              >
                {isGenerating ? (
                  <><TbLoader className="spin" size={16} style={{ marginRight: 8 }} /> Generating…</>
                ) : isCompleted ? (
                  <><TbRefresh size={16} style={{ marginRight: 8 }} /> Regenerate</>
                ) : (
                  <><TbPlayerPlay size={16} style={{ marginRight: 8 }} /> Generate with Gemini</>
                )}
              </Button>
              {isGenerating && (
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--tx3)', textAlign: 'center', lineHeight: 1.5 }}>
                  Calling Gemini API for each color variant. This may take a few minutes…
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};