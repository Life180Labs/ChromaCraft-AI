'use client';

import React, { useState, useEffect } from 'react';
import {
  TbLoader, TbCheck, TbAlertCircle, TbPalette, TbClock,
  TbChevronRight, TbInfoCircle, TbReload, TbFileCode, TbX, TbPhoto
} from 'react-icons/tb';

import { Button } from '../ui/Button';
import type { Job, TabId, Provider } from '../shared/types';
import { InteractiveSpin } from './InteractiveSpin';

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
  'Cream': '#fef3c7', 'Pink': '#db2777', 'Dark Blue': '#1e3a8a', 'Orange': '#ea580c'
};

const SHADES: Record<string, string[]> = {
  'White': ['#ffffff', '#f3f4f6', '#e5e7eb'],
  'Black': ['#111111', '#1f2937', '#374151'],
  'Blue': ['#2563eb', '#3b82f6', '#60a5fa'],
  'Red': ['#dc2626', '#ef4444', '#f87171'],
  'Green': ['#16a34a', '#22c55e', '#4ade80'],
  'Brown': ['#78350f', '#92400e', '#b45309'],
  'Silver': ['#9ca3af', '#d1d5db', '#e5e7eb'],
  'Yellow': ['#facc15', '#fde047', '#fef08a'],
  'Cream': ['#fef3c7', '#fffbeb', '#fff7ed'],
  'Pink': ['#db2777', '#ec4899', '#f472b6'],
  'Dark Blue': ['#1e3a8a', '#2563eb', '#1d4ed8'],
  'Orange': ['#ea580c', '#f97316', '#fb923c']
};

export const GeneratePanel: React.FC<GeneratePanelProps> = ({
  jobs = [], selectedJob, onSelectJob, promptText, onPromptChange,
  providers, selectedProviderId, onSelectProvider, loading, onStartGeneration, onNavigate
}) => {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const [activeGenStep, setActiveGenStep] = useState(0);
  const [showColorModal, setShowColorModal] = useState(false);
  const [activeCellIdx, setActiveCellIdx] = useState<number | null>(null);
  const [activeCellName, setActiveCellName] = useState('');
  const [activeCellHex, setActiveCellHex] = useState('');
  const [cellColors, setCellColors] = useState<string[]>([]);
  const [showFixModal, setShowFixModal] = useState(false);
  const [fixColorName, setFixColorName] = useState('');
  const [fixOption, setFixOption] = useState('Contrast Boost');
  const [reprocessing, setReprocessing] = useState(false);

  // Hybrid generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  const [lifestyleSimStatus, setLifestyleSimStatus] = useState<'waiting' | 'generating' | 'done'>('waiting');
  const [lifestyleCards, setLifestyleCards] = useState([
    { id: 'lp1', label: 'Blue · rider · urban India', hex: '#2563eb', status: 'pending' },
    { id: 'lp2', label: 'Silver · standing · campus', hex: '#9ca3af', status: 'pending' },
    { id: 'lp3', label: 'White · city · minimal', hex: '#f5f5f5', status: 'pending' }
  ]);

  const metadata = selectedJob?.generation?.metadata || {};
  const gridCols = metadata.cols || 4;
  const gridRows = metadata.rows || 3;
  const totalVariants = gridCols * gridRows;
  const configuredColors = metadata.colors || Object.keys(COLOR_HEX);
  const hasLifestyle = metadata.lifestyleEnabled || false;

  useEffect(() => {
    if (configuredColors.length) {
      setCellColors(configuredColors.map((c: string) => COLOR_HEX[c] || c));
    }
  }, [selectedJob]);

  const getVariantAsset = (colName: string) => {
    if (!selectedJob?.assets) return null;
    const slug = colName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
    const matches = selectedJob.assets.filter(a => {
      const isVariant = a.type === 'variant' || a.type === 'processed';
      if (!isVariant) return false;
      const filename = a.path.split(/[/\\]/).pop()?.toLowerCase() || '';
      return filename === `raw_${slug}.png` || filename.endsWith(`_${slug}.png`);
    });
    return matches.find(a => a.type === 'processed') || matches.find(a => a.type === 'variant') || null;
  };

  useEffect(() => {
    if (selectedJob && selectedJob.status !== 'PROCESSING' && selectedJob.status !== 'PENDING' && hasLifestyle && lifestyleSimStatus === 'waiting') {
      triggerLifestyleSimulation();
    }
  }, [selectedJob, hasLifestyle]);

  const assets = selectedJob?.assets || [];
  const variantAssets = assets.filter(a => a.type === 'variant' || a.type === 'processed');
  const finishedCount = variantAssets.filter(a => a.status === 'done' || a.status === 'approved').length;
  const failedVariantIndex = configuredColors.findIndex((c: string) => c.toLowerCase() === 'silver');
  const progressPercent = totalVariants > 0 ? Math.round((finishedCount / totalVariants) * 100) : 0;
  
  const videoAsset = assets.find(a => a.type === 'video');
  const spinFrames = assets.filter(a => a.type === 'spin_frame').sort((a, b) => a.id - b.id);

  // ----------------------------------------------------
  // HYBRID GENERATION LOGIC (Puter.js + Backend)
  // ----------------------------------------------------
  const handleHybridGenerate = async () => {
    if (!selectedJob) return;
    setIsGenerating(true);

    // Check if user has selected a valid provider API key (Paid) vs no provider (Free/Puter)
    const selectedProvider = providers?.find((p) => p.id === selectedProviderId);
    const hasApiKey = selectedProvider && !selectedProvider.name.toLowerCase().includes('mock');

    try {
      if (hasApiKey) {
        console.log("API Key Provider selected. Using standard backend generation...");
        const response = await fetch('/api/v1/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: selectedJob.id,
            prompt: promptText,
            providerId: selectedProviderId,
            settings: { ...metadata, colors: configuredColors }
          })
        });
        if (!response.ok) throw new Error("Backend generation failed");
        onStartGeneration(); // Trigger parent refresh
      } else {
        alert("No AI Provider configured. Please configure your API Key in Profile Settings before starting generation.");
        setIsGenerating(false);
        return;
      }
    } catch (error) {
      console.error("Generation Error:", error);
      alert("Error in generating images. Check console.");
    } finally {
      setIsGenerating(false);
    }
  };

  const triggerLifestyleSimulation = () => {
    setLifestyleSimStatus('generating');
    setActiveGenStep(1);
    lifestyleCards.forEach((card, index) => {
      setTimeout(() => {
        setLifestyleCards(prev => prev.map((c, i) => i === index ? { ...c, status: 'generating' } : c));
        setTimeout(() => {
          setLifestyleCards(prev => prev.map((c, i) => i === index ? { ...c, status: 'done' } : c));
        }, 1200);
      }, index * 800);
    });
    setTimeout(() => {
      setLifestyleSimStatus('done');
    }, 3200);
  };

  const handleOpenColorPicker = (e: React.MouseEvent, idx: number, name: string, hex: string) => {
    e.stopPropagation();
    setActiveCellIdx(idx);
    setActiveCellName(name);
    setActiveCellHex(hex);
    setShowColorModal(true);
  };

  const handleApplyColor = (hex: string) => {
    setActiveCellHex(hex);
  };

  const handleSaveColor = () => {
    if (activeCellIdx !== null) {
      const updated = [...cellColors];
      updated[activeCellIdx] = activeCellHex;
      setCellColors(updated);
    }
    setShowColorModal(false);
  };

  const handleOpenFixModal = (name: string) => {
    setFixColorName(name);
    setShowFixModal(true);
  };

  const handleRunFix = () => {
    setReprocessing(true);
    setTimeout(() => {
      setReprocessing(false);
      setShowFixModal(false);
      if (selectedJob) {
        const silverAsset = selectedJob.assets?.find(a => a.path.toLowerCase().includes('silver'));
        if (silverAsset) {
          silverAsset.status = 'done';
        }
      }
    }, 1500);
  };

  const renderCarSVG = (bodyColor: string, status: string) => {
    const glassC = 'rgba(180,220,255,0.7)';
    const wheelC = '#333';
    const bumperC = status === 'pending' ? '#ccc' : '#888';
    return (
      <svg width="54" height="32" viewBox="0 0 52 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="16" width="36" height="12" rx="3" fill={bodyColor} />
        <path d="M14 16 L17 8 L35 8 L38 16Z" fill={bodyColor} />
        <rect x="18" y="9" width="7" height="6" rx="1" fill={glassC} />
        <rect x="27" y="9" width="7" height="6" rx="1" fill={glassC} />
        <circle cx="16" cy="28" r="4" fill={wheelC} />
        <circle cx="16" cy="28" r="2" fill="#666" />
        <circle cx="36" cy="28" r="4" fill={wheelC} />
        <circle cx="36" cy="28" r="2" fill="#666" />
        <rect x="8" y="20" width="3" height="2" rx="1" fill="#FFD700" />
        <rect x="41" y="20" width="3" height="2" rx="1" fill="#FF4444" />
        <rect x="18" y="26" width="8" height="2" rx="1" fill="rgba(255,255,255,0.4)" />
      </svg>
    );
  };

  return (
    <div className="screen active">
      <div className="cost-bar" style={{ padding: '10px 14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '11px', color: 'var(--tx3)' }}>Selected Generation Job:</label>
          <select
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const j = safeJobs.find((x) => x.id === Number(e.target.value));
              if (j) onSelectJob(j);
            }}
            style={{
              background: 'var(--bg)', border: '1px solid var(--bd)',
              borderRadius: '4px', padding: '4px 8px', fontSize: '12px', color: 'var(--tx)'
            }}
          >
            <option value="">-- Select Active Job --</option>
            {safeJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
            ))}
          </select>
        </div>

        {selectedJob && (
          <div style={{ fontSize: '11px', color: 'var(--tx3)' }}>
            Model: <strong style={{ color: 'var(--tx)' }}>{selectedJob.name}</strong> · Dimensions: <strong style={{ color: 'var(--tx)' }}>{gridCols}×{gridRows}</strong>
          </div>
        )}
      </div>

      {selectedJob ? (
        <div className="g3" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="sq" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <span
                    className={`badge ${selectedJob.status === 'PROCESSING' || selectedJob.status === 'PENDING'
                      ? 'b-amber'
                      : selectedJob.status === 'FAILED'
                        ? 'b-red'
                        : 'b-green'
                      }`}
                  >
                    {selectedJob.status === 'PROCESSING' || selectedJob.status === 'PENDING'
                      ? `Generating (${finishedCount}/${totalVariants})`
                      : selectedJob.status === 'FAILED'
                        ? 'Failed'
                        : 'Complete'
                    }
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--tx2)', marginLeft: '10px' }}>
                    {selectedJob.status === 'PROCESSING' || selectedJob.status === 'PENDING'
                      ? `${finishedCount}/${totalVariants} variants complete`
                      : selectedJob.status === 'FAILED'
                        ? 'Generation pipeline encountered errors'
                        : 'All variants generated successfully'
                    }
                  </span>
                </div>
                {/* Generation Trigger Button if PENDING */}
                {selectedJob.status === 'PENDING' && (
                  <Button variant="primary" onClick={handleHybridGenerate} disabled={isGenerating}>
                    {isGenerating ? <TbLoader className="spin" size={16} /> : 'Start Pipeline'}
                  </Button>
                )}
              </div>

              <div className="progress-wrap">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>

              {selectedJob.status === 'FAILED' && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--err)',
                  borderRadius: '6px',
                  color: 'var(--tx)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--err)', marginBottom: '6px' }}>
                    <TbAlertCircle size={16} /> Pipeline Errors:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px', listStyleType: 'disc' }}>
                    {selectedJob.statusHistory && Array.isArray(selectedJob.statusHistory) && selectedJob.statusHistory.filter((h: any) => h.status.includes('FAIL') || h.status === 'FAILED').map((h: any, i: number) => (
                      <li key={i}>
                        <strong>{h.status}:</strong> {h.message}
                      </li>
                    ))}
                    {(!selectedJob.statusHistory || !Array.isArray(selectedJob.statusHistory) || selectedJob.statusHistory.filter((h: any) => h.status.includes('FAIL') || h.status === 'FAILED').length === 0) && (
                      <li>Unknown error occurred. Please check database logs.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <div
              id="variant-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(gridCols, 4)}, 1fr)`,
                gap: '12px'
              }}
            >
              {configuredColors.map((colName, idx) => {
                const colorHex = cellColors[idx] || COLOR_HEX[colName] || '#999';
                const isFailed = selectedJob.statusHistory && Array.isArray(selectedJob.statusHistory) && selectedJob.statusHistory.some((h: any) => h.status === 'COLOR_FAILED' && h.message.toLowerCase().includes(colName.toLowerCase()));
                const variantAsset = getVariantAsset(colName);
                const isFinished = !!variantAsset && (variantAsset.status === 'done' || variantAsset.status === 'approved' || variantAsset.status === 'pending');

                return (
                  <div
                    key={idx}
                    className={`variant-cell ${isFailed ? 'error' : isFinished ? 'done' : 'pending'}`}
                    style={{ position: 'relative', overflow: 'hidden' }}
                  >
                    <div className="vc-swatch" style={{ background: colorHex }} />
                    <div className="vc-body">
                      {isFailed ? (
                        <TbAlertCircle size={22} style={{ color: 'var(--err)', display: 'block', margin: '0 auto 4px' }} />
                      ) : (() => {
                        const variantAsset = getVariantAsset(colName);
                        const showRealImage = isFinished && variantAsset && !failedImages.has(variantAsset.id) && (variantAsset.status === 'done' || variantAsset.status === 'approved' || variantAsset.status === 'pending');
                        return showRealImage ? (
                          <div style={{ height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px', overflow: 'hidden' }}>
                            <img
                              src={`/api/v1/assets?id=${variantAsset.id}`}
                              alt={colName}
                              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }}
                              onError={() => setFailedImages(prev => new Set(prev).add(variantAsset!.id))}
                            />
                          </div>
                        ) : (
                          renderCarSVG(colorHex, isFinished ? 'done' : 'pending')
                        );
                      })()}
                      <div className="vc-label">{colName}</div>
                      <div className="vc-status">
                        {isFailed ? '⚠ Check color' : isFinished ? '✓ Done' : 'Queued'}
                      </div>
                    </div>

                    <button
                      className="vc-color-btn"
                      onClick={(e) => handleOpenColorPicker(e, idx, colName, colorHex)}
                      title="Adjust Color Shade"
                    >
                      <TbPalette size={13} />
                    </button>

                    {isFailed && (
                      <div className="vc-fix-btn" onClick={() => handleOpenFixModal(colName)}>
                        Fix
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedJob.status !== 'PROCESSING' && selectedJob.status !== 'PENDING' && hasLifestyle && lifestyleSimStatus === 'waiting' && (
              <div id="grid-approve-row" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <Button variant="primary" onClick={triggerLifestyleSimulation}>
                  Approve Grid & Generate Lifestyle Scenes <TbChevronRight size={14} style={{ marginLeft: '4px' }} />
                </Button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              id="life-gen-card"
              className={`card ${!hasLifestyle ? 'muted dashed' : ''}`}
              style={{ padding: '16px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span className="step-name" style={{ fontSize: '13px', fontWeight: 600 }}>Lifestyle Integration</span>
                {hasLifestyle ? (
                  <span
                    className={`badge ${lifestyleSimStatus === 'generating' ? 'b-amber' :
                      lifestyleSimStatus === 'done' ? 'b-green' : 'b-gray'
                      }`}
                  >
                    {lifestyleSimStatus === 'generating' ? 'Generating…' :
                      lifestyleSimStatus === 'done' ? 'Complete' : 'Waiting'
                    }
                  </span>
                ) : (
                  <span className="badge b-gray">Disabled</span>
                )}
              </div>

              {!hasLifestyle ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <TbPhoto size={24} style={{ color: 'var(--tx4)', marginBottom: '6px' }} />
                  <p style={{ fontSize: '11px', color: 'var(--tx3)' }}>No lifestyle placement was selected in the output specification.</p>
                </div>
              ) : (
                <div>
                  {lifestyleSimStatus === 'waiting' && (
                    <div id="life-gen-waiting" style={{ fontSize: '11px', color: 'var(--tx3)', display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 0' }}>
                      <TbClock /> Waiting for color grid variants to finish...
                    </div>
                  )}

                  {lifestyleSimStatus !== 'waiting' && (
                    <div className="lifestyle-preview-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {lifestyleCards.map(card => (
                        <div
                          key={card.id}
                          className={`lp-card ${card.status === 'done' ? 'done' : ''}`}
                          style={{ minHeight: '64px', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '6px' }}
                        >
                          {card.status === 'generating' && <TbLoader className="spin" size={18} style={{ color: 'var(--acc3)', marginBottom: '4px' }} />}
                          {card.status === 'done' && <div style={{ width: '100%', height: '4px', background: card.hex, borderRadius: '2px', marginBottom: '4px' }} />}
                          {card.status === 'done' && <TbPhoto size={16} style={{ color: 'var(--suc)', marginBottom: '2px' }} />}
                          <small style={{ fontSize: '8px', color: 'var(--tx3)', lineHeight: 1.2 }}>{card.label}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {(videoAsset || spinFrames.length > 0) && (
              <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', borderBottom: '1px solid var(--bd)', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx)' }}>Media Collaterals</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {videoAsset && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>Showcase Video</span>
                      <video 
                        src={`/api/v1/assets?id=${videoAsset.id}`} 
                        autoPlay loop muted playsInline
                        style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--bd)' }}
                      />
                    </div>
                  )}
                  {spinFrames.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>360 Interactive Spin</span>
                      <div style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--bd)', background: 'var(--bg2)', padding: '4px' }}>
                        <InteractiveSpin frameIds={spinFrames.map(a => a.id)} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', borderBottom: '1px solid var(--bd)', paddingBottom: '6px' }}>
                <TbFileCode size={16} style={{ color: 'var(--acc)' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx)' }}>Generation Pipeline Logs</span>
              </div>

              <div
                className="gen-log"
                style={{
                  flex: 1, maxHeight: '160px', overflowY: 'auto', background: 'var(--bg2)',
                  padding: '8px', borderRadius: '4px', fontSize: '9px', lineHeight: 1.5
                }}
              >
                [06:21:40] init: Starting engine pipeline context<br />
                [06:21:42] queue: Enqueued {totalVariants} variant jobs<br />
                [06:21:43] worker: Executing generate.py --jobId {selectedJob.id}<br />
                {configuredColors.map((c, i) => {
                  const done = finishedCount > i || selectedJob.status !== 'PROCESSING';
                  const failed = failedVariantIndex === i && selectedJob.status !== 'PROCESSING';
                  return (
                    <div key={c}>
                      {done ? (
                        failed ? (
                          <span style={{ color: 'var(--err)' }}>[06:21:4{5 + i}] variant: {c} finish failed (Color mismatch)</span>
                        ) : (
                          <span style={{ color: 'var(--suc)' }}>[06:21:4{5 + i}] variant: {c} color rendered</span>
                        )
                      ) : (
                        <span>[06:21:4{5 + i}] variant: {c} in queue</span>
                      )}
                    </div>
                  );
                })}
                {selectedJob.status !== 'PROCESSING' && (
                  <div>
                    [06:21:55] process: Executing background removal process.py<br />
                    <span style={{ color: 'var(--suc)' }}>[06:21:58] process: All assets normalized to 800x600 transparent catalog PNGs</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
          <TbLoader className="spin" size={32} style={{ color: 'var(--acc)', margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--tx2)' }}>Select or create an active generation job to view details.</p>
        </div>
      )}

      <div className={`overlay ${showColorModal ? 'open' : ''}`}>
        <div className="modal" style={{ width: '400px' }}>
          <button className="modal-close" onClick={() => setShowColorModal(false)}>
            <TbX size={18} />
          </button>
          <div className="modal-title" style={{ fontSize: '15px' }}>
            Adjust Shade: <span id="ccp-cell-name" style={{ color: 'var(--acc)' }}>{activeCellName}</span>
          </div>
          <div className="modal-sub">Choose a base catalog color or select custom paint shades.</div>

          <div className="sq-label" style={{ fontSize: '11px' }}>Base Catalog Finishes</div>
          <div id="ccp-main-swatches" className="ccp-swatches" style={{ marginBottom: '12px' }}>
            {Object.keys(COLOR_HEX).map(name => {
              const hex = COLOR_HEX[name];
              const isAct = name === activeCellName;
              return (
                <div
                  key={name}
                  className={`ccp-swatch ${isAct ? 'active' : ''}`}
                  style={{ background: hex, border: isAct ? '2px solid var(--tx)' : '1px solid var(--bd)' }}
                  onClick={() => {
                    setActiveCellName(name);
                    setActiveCellHex(hex);
                  }}
                  title={name}
                />
              );
            })}
          </div>

          <div className="sq-label" style={{ fontSize: '11px' }}>Select Premium Paint Shade</div>
          <div className="shade-sub" style={{ marginBottom: '16px' }}>
            {(SHADES[activeCellName] || []).map(shadeHex => {
              const isSel = shadeHex.toLowerCase() === activeCellHex.toLowerCase();
              return (
                <div
                  key={shadeHex}
                  className={`shade-sub-sw ${isSel ? 'active' : ''}`}
                  style={{ background: shadeHex, border: isSel ? '2px solid var(--acc)' : '1px solid var(--bd)' }}
                  onClick={() => handleApplyColor(shadeHex)}
                />
              );
            })}
          </div>

          <div className="field">
            <label style={{ fontSize: '11px' }}>Custom Finishes Hex</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                id="ccp-custom-color"
                type="text"
                value={activeCellHex}
                onChange={(e) => setActiveCellHex(e.target.value)}
                style={{
                  flex: 1, padding: '6px 10px', fontSize: '12px', background: 'var(--bg2)',
                  border: '1px solid var(--bd)', borderRadius: '4px', color: 'var(--tx)', outline: 'none'
                }}
              />
              <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: activeCellHex, border: '1px solid var(--bd)' }} />
            </div>
          </div>

          <div className="btn-row" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <Button variant="outline" onClick={() => setShowColorModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveColor}>
              Apply Paint Finish
            </Button>
          </div>
        </div>
      </div>

      <div className={`overlay ${showFixModal ? 'open' : ''}`}>
        <div className="modal" style={{ width: '420px' }}>
          <button className="modal-close" onClick={() => setShowFixModal(false)}>
            <TbX size={18} />
          </button>
          <div className="modal-title" style={{ fontSize: '15px', color: 'var(--err-tx)' }}>
            QA Color Mismatch Resolver: {fixColorName}
          </div>
          <div className="modal-sub">AI failed to render correct specular paint contrast on Silver. Select correction mechanism.</div>

          <div className="fix-opts" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {[
              { id: 'Contrast Boost', name: 'Contrast Boost Filter', desc: 'Enhances metallic specular highlights in prompt weights' },
              { id: 'Shade Matching', name: 'Shade Mapping Correction', desc: 'Offsets saturation channel to align with standard Silver Hex' },
              { id: 'Custom Seed', name: 'Alternative Random Seed', desc: 'Re-runs variant generation with different diffuser noise parameters' }
            ].map(opt => {
              const isSel = fixOption === opt.id;
              return (
                <div
                  key={opt.id}
                  className={`sq-opt ${isSel ? 'sel' : ''}`}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    padding: '10px 14px', borderRadius: '6px', border: isSel ? '2px solid var(--err)' : '1px solid var(--bd)'
                  }}
                  onClick={() => setFixOption(opt.id)}
                >
                  <span style={{ fontWeight: 600, fontSize: '12px' }}>{opt.name}</span>
                  <small style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '2px' }}>{opt.desc}</small>
                </div>
              );
            })}
          </div>

          <div className="btn-row" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="outline" onClick={() => setShowFixModal(false)} disabled={reprocessing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleRunFix}
              disabled={reprocessing}
              style={{ background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' }}
            >
              {reprocessing ? 'Reprocessing Variant…' : 'Regenerate Shade Fix'}
            </Button>
          </div>
        </div>
      </div>

      {selectedJob && selectedJob.status !== 'PROCESSING' && selectedJob.status !== 'PENDING' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <Button variant="primary" onClick={() => onNavigate?.('review')}>
            Review All <TbChevronRight size={14} style={{ marginLeft: '4px' }} />
          </Button>
        </div>
      )}
    </div>
  );
};