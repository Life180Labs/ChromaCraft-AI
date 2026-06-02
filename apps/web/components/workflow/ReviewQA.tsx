'use client';

import React, { useState, useEffect } from 'react';
import {
  TbCheck, TbX, TbArrowRight, TbPhoto, TbVideo, TbLoader,
  TbDownload, TbInfoCircle, TbGrid3X3, TbChevronRight, TbRefresh,
} from 'react-icons/tb';
import { Button } from '../ui/Button';
import { InteractiveSpin } from './InteractiveSpin';
import type { Job, TabId } from '../shared/types';

type ReviewQAProps = {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job) => void;
  onQAReview: (assetId: number, status: 'approved' | 'rejected') => void;
  onNavigate?: (tab: TabId) => void;
};

function assetColorName(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  return base
    .replace(/^raw_/, '')
    .replace(/\.png$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

const COLOR_HEX: Record<string, string> = {
  'White': '#ffffff', 'Black': '#111111', 'Blue': '#2563eb', 'Red': '#dc2626',
  'Green': '#16a34a', 'Brown': '#78350f', 'Silver': '#9ca3af', 'Yellow': '#facc15',
  'Cream': '#fef3c7', 'Pink': '#db2777', 'Dark Blue': '#1e3a8a', 'Orange': '#ea580c',
};

export const ReviewQA: React.FC<ReviewQAProps> = ({
  jobs = [], selectedJob, onSelectJob, onQAReview, onNavigate,
}) => {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  // Reset preview panel when job changes (e.g. after generation navigates here)
  useEffect(() => {
    setSelectedAssetId(null);
    setFailedImages(new Set());
  }, [selectedJob?.id]);

  const variantAssets = selectedJob?.assets?.filter(
    a => a.type === 'variant' || a.type === 'processed'
  ) || [];
  const videoAsset = selectedJob?.assets?.find(a => a.type === 'video');
  const gridAsset = selectedJob?.assets?.find(a => a.type === 'grid');
  const spinAsset = selectedJob?.assets?.find(a => a.type === 'spin');
  const spinFrameAssets = selectedJob?.assets?.filter(a => a.type === 'spin-frame') || [];

  const approvedCount = variantAssets.filter(a => a.status === 'approved').length;
  const rejectedCount = variantAssets.filter(a => a.status === 'rejected').length;
  const pendingCount = variantAssets.length - approvedCount - rejectedCount;
  const allReviewable = variantAssets.length > 0 || !!videoAsset || !!gridAsset || !!spinAsset || spinFrameAssets.length > 0;
  const anyApproved = approvedCount > 0 || 
    (videoAsset?.status === 'approved') || 
    (gridAsset?.status === 'approved') ||
    (spinAsset?.status === 'approved');

  const handleApproveAll = () => {
    variantAssets.forEach(a => {
      if (a.status !== 'approved') onQAReview(a.id, 'approved');
    });
  };

  const handleRejectAll = () => {
    variantAssets.forEach(a => {
      if (a.status !== 'rejected') onQAReview(a.id, 'rejected');
    });
  };

  const selectedAsset = selectedJob?.assets?.find(a => a.id === selectedAssetId) || null;

  return (
    <div className="screen active">
      <div className="sec" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TbPhoto size={16} /> Review & QA
      </div>

      {/* Job selector */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--tx3)', whiteSpace: 'nowrap' }}>Select Job:</label>
            <select
              id="review-job-select"
              value={selectedJob?.id || ''}
              onChange={(e) => {
                const j = safeJobs.find((x) => x.id === Number(e.target.value));
                if (j) { onSelectJob(j); setSelectedAssetId(null); }
              }}
              style={{
                flex: 1, background: 'var(--bg)', border: '1px solid var(--bd)',
                borderRadius: 4, padding: '5px 10px', fontSize: 12, color: 'var(--tx)',
              }}
            >
              <option value="">-- Choose Job --</option>
              {safeJobs.map((j) => (
                <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
              ))}
            </select>
          </div>

          {allReviewable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--tx3)' }}>
                <span style={{ color: 'var(--suc)' }}>{approvedCount} ✓</span>
                {' · '}
                <span style={{ color: 'var(--err)' }}>{rejectedCount} ✗</span>
                {' · '}
                <span style={{ color: 'var(--tx3)' }}>{pendingCount} pending</span>
              </span>
              <Button variant="ghost" size="sm" onClick={handleApproveAll}>Approve All</Button>
              <Button variant="ghost" size="sm" onClick={handleRejectAll}>Reject All</Button>
            </div>
          )}
        </div>
      </div>

      {!selectedJob && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <TbPhoto size={32} style={{ color: 'var(--tx4)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--tx2)' }}>Select a completed job to review its generated images.</p>
        </div>
      )}

      {selectedJob && variantAssets.length === 0 && !gridAsset && !videoAsset && !spinAsset && spinFrameAssets.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <TbLoader className="spin" size={28} style={{ color: 'var(--acc)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--tx2)' }}>
            No generated images found yet.
            {selectedJob.status === 'PENDING' && ' Start generation in the Generate tab.'}
          </p>
          {selectedJob.status === 'PENDING' && (
            <Button variant="primary" style={{ marginTop: 12 }} onClick={() => onNavigate?.('generate')}>
              Go to Generate
            </Button>
          )}
        </div>
      )}

      {selectedJob && (variantAssets.length > 0 || gridAsset || videoAsset || spinAsset || spinFrameAssets.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedAssetId ? '1fr 340px' : '1fr', gap: 20 }}>

          {/* ─── Grid of color variants ─────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Section: Color grid */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--bd)', paddingBottom: 10 }}>
                <TbGrid3X3 size={14} style={{ color: 'var(--acc)' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Color Variants ({variantAssets.length})</span>
              </div>
              <div
                id="review-color-grid"
                style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(variantAssets.length, 4)}, 1fr)`, gap: 12 }}
              >
                {variantAssets.map((asset) => {
                  const colorName = assetColorName(asset.path);
                  const hex = COLOR_HEX[colorName] || '#888';
                  const isSelected = selectedAssetId === asset.id;
                  const showImage = !failedImages.has(asset.id);

                  return (
                    <div
                      key={asset.id}
                      id={`review-asset-${asset.id}`}
                      className={`variant-cell ${asset.status === 'approved' ? 'done' : asset.status === 'rejected' ? 'error' : 'pending'}`}
                      style={{
                        cursor: 'pointer',
                        outline: isSelected ? '2px solid var(--acc)' : 'none',
                        outlineOffset: 2,
                        transition: 'outline 0.15s',
                      }}
                      onClick={() => setSelectedAssetId(isSelected ? null : asset.id)}
                    >
                      <div className="vc-swatch" style={{ background: hex }} />
                      <div className="vc-body">
                        {showImage ? (
                          <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 6 }}>
                            <img
                              src={`/api/v1/assets?id=${asset.id}`}
                              alt={colorName}
                              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
                              onError={() => setFailedImages(prev => new Set(prev).add(asset.id))}
                            />
                          </div>
                        ) : (
                          <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: hex, border: '2px solid var(--bd)' }} />
                          </div>
                        )}
                        <div className="vc-label">{colorName}</div>
                        <div className="vc-status">
                          {asset.status === 'approved' ? '✓ Approved' : asset.status === 'rejected' ? '✗ Rejected' : 'Pending'}
                        </div>
                        {/* Quick approve/reject buttons */}
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                          <button
                            id={`approve-${asset.id}`}
                            title="Approve"
                            onClick={(e) => { e.stopPropagation(); onQAReview(asset.id, 'approved'); }}
                            style={{
                              flex: 1, padding: '3px 0', borderRadius: 4, border: 'none',
                              background: asset.status === 'approved' ? 'var(--suc)' : 'var(--bg2)',
                              color: asset.status === 'approved' ? '#fff' : 'var(--tx3)',
                              cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                            }}
                          >
                            <TbCheck size={12} /> OK
                          </button>
                          <button
                            id={`reject-${asset.id}`}
                            title="Reject"
                            onClick={(e) => { e.stopPropagation(); onQAReview(asset.id, 'rejected'); }}
                            style={{
                              flex: 1, padding: '3px 0', borderRadius: 4, border: 'none',
                              background: asset.status === 'rejected' ? 'var(--err)' : 'var(--bg2)',
                              color: asset.status === 'rejected' ? '#fff' : 'var(--tx3)',
                              cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                            }}
                          >
                            <TbX size={12} /> No
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section: Grid Image (if exists) */}
            {gridAsset && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                  <TbGrid3X3 size={14} style={{ color: 'var(--acc)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Grid Image Collage</span>
                  <span className={`badge ${gridAsset.status === 'approved' ? 'b-green' : gridAsset.status === 'rejected' ? 'b-red' : 'b-gray'}`} style={{ marginLeft: 'auto' }}>
                    {gridAsset.status === 'approved' ? 'Approved' : gridAsset.status === 'rejected' ? 'Rejected' : 'Pending'}
                  </span>
                </div>
                <img
                  src={`/api/v1/assets?id=${gridAsset.id}`}
                  alt="Grid Collage"
                  style={{ width: '100%', maxHeight: 400, borderRadius: 6, border: '1px solid var(--bd)', objectFit: 'contain' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button
                    id="approve-grid"
                    variant={gridAsset.status === 'approved' ? 'primary' : 'outline'}
                    onClick={() => onQAReview(gridAsset.id, 'approved')}
                  >
                    <TbCheck size={14} style={{ marginRight: 4 }} /> Approve Grid
                  </Button>
                  <Button
                    id="reject-grid"
                    variant="outline"
                    onClick={() => onQAReview(gridAsset.id, 'rejected')}
                    style={gridAsset.status === 'rejected' ? { borderColor: 'var(--err)', color: 'var(--err)' } : {}}
                  >
                    <TbX size={14} style={{ marginRight: 4 }} /> Reject Grid
                  </Button>
                </div>
              </div>
            )}

            {/* Section: Video (if exists) */}
            {videoAsset && (() => {
              const isVideoFile = videoAsset.path.endsWith('.mp4') || videoAsset.path.endsWith('.webm') || videoAsset.path.endsWith('.mov');
              const label = isVideoFile ? 'Showcase Video' : 'Showcase Still (Video Fallback)';
              return (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                    <TbVideo size={14} style={{ color: 'var(--acc)' }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                    <span className={`badge ${videoAsset.status === 'approved' ? 'b-green' : videoAsset.status === 'rejected' ? 'b-red' : 'b-gray'}`} style={{ marginLeft: 'auto' }}>
                      {videoAsset.status === 'approved' ? 'Approved' : videoAsset.status === 'rejected' ? 'Rejected' : 'Pending'}
                    </span>
                  </div>
                  {isVideoFile ? (
                    <video
                      src={`/api/v1/assets?id=${videoAsset.id}`}
                      autoPlay loop muted playsInline controls
                      style={{ width: '100%', maxHeight: 300, borderRadius: 6, border: '1px solid var(--bd)', background: '#000' }}
                    />
                  ) : (
                    <img
                      src={`/api/v1/assets?id=${videoAsset.id}`}
                      alt="Showcase Still"
                      style={{ width: '100%', maxHeight: 300, borderRadius: 6, border: '1px solid var(--bd)', objectFit: 'contain' }}
                    />
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <Button
                      id="approve-video"
                      variant={videoAsset.status === 'approved' ? 'primary' : 'outline'}
                      onClick={() => onQAReview(videoAsset.id, 'approved')}
                    >
                      <TbCheck size={14} style={{ marginRight: 4 }} /> Approve {isVideoFile ? 'Video' : 'Still'}
                    </Button>
                    <Button
                      id="reject-video"
                      variant="outline"
                      onClick={() => onQAReview(videoAsset.id, 'rejected')}
                      style={videoAsset.status === 'rejected' ? { borderColor: 'var(--err)', color: 'var(--err)' } : {}}
                    >
                      <TbX size={14} style={{ marginRight: 4 }} /> Reject
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Section: 360 Spin Showcase (if exists) */}
            {(spinAsset || spinFrameAssets.length > 0) && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                  <TbRefresh size={14} style={{ color: 'var(--acc)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>360° Turntable Spin</span>
                  {spinFrameAssets.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--tx3)', marginLeft: 4 }}>({spinFrameAssets.length} frames)</span>
                  )}
                  {spinAsset && (
                    <span className={`badge ${spinAsset.status === 'approved' ? 'b-green' : spinAsset.status === 'rejected' ? 'b-red' : 'b-gray'}`} style={{ marginLeft: 'auto' }}>
                      {spinAsset.status === 'approved' ? 'Approved' : spinAsset.status === 'rejected' ? 'Rejected' : 'Pending'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  {spinFrameAssets.length > 1 ? (
                    <div style={{ width: '100%', height: 360, border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
                      <InteractiveSpin frameIds={spinFrameAssets.map(a => a.id)} />
                    </div>
                  ) : spinAsset ? (
                    <img
                      src={`/api/v1/assets?id=${spinAsset.id}`}
                      alt="360 Turntable"
                      style={{ width: '100%', maxHeight: 400, borderRadius: 6, border: '1px solid var(--bd)', objectFit: 'contain' }}
                    />
                  ) : null}
                  {spinAsset && (
                    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                      <Button
                        id="approve-spin"
                        variant={spinAsset.status === 'approved' ? 'primary' : 'outline'}
                        onClick={() => onQAReview(spinAsset.id, 'approved')}
                        style={{ flex: 1 }}
                      >
                        <TbCheck size={14} style={{ marginRight: 4 }} /> Approve Spin
                      </Button>
                      <Button
                        id="reject-spin"
                        variant="outline"
                        onClick={() => onQAReview(spinAsset.id, 'rejected')}
                        style={spinAsset.status === 'rejected' ? { flex: 1, borderColor: 'var(--err)', color: 'var(--err)' } : { flex: 1 }}
                      >
                        <TbX size={14} style={{ marginRight: 4 }} /> Reject Spin
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Go to deliver */}
            {anyApproved && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button id="go-to-deliver-btn" variant="primary" onClick={() => onNavigate?.('deliver')}>
                  Go to Delivery <TbArrowRight size={14} style={{ marginLeft: 4 }} />
                </Button>
              </div>
            )}
          </div>

          {/* ─── Right: Image preview panel ───────────────── */}
          {selectedAsset && (
            <div className="card" style={{ padding: 16, position: 'sticky', top: 20, height: 'fit-content' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{assetColorName(selectedAsset.path)}</span>
                <button
                  onClick={() => setSelectedAssetId(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', display: 'flex' }}
                >
                  <TbX size={16} />
                </button>
              </div>
              <img
                src={`/api/v1/assets?id=${selectedAsset.id}`}
                alt={assetColorName(selectedAsset.path)}
                style={{ width: '100%', borderRadius: 6, border: '1px solid var(--bd)', marginBottom: 12 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                <Button
                  variant={selectedAsset.status === 'approved' ? 'primary' : 'outline'}
                  onClick={() => onQAReview(selectedAsset.id, 'approved')}
                  style={{ justifyContent: 'center' }}
                >
                  <TbCheck size={14} style={{ marginRight: 4 }} />
                  {selectedAsset.status === 'approved' ? 'Approved ✓' : 'Approve'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onQAReview(selectedAsset.id, 'rejected')}
                  style={selectedAsset.status === 'rejected'
                    ? { justifyContent: 'center', borderColor: 'var(--err)', color: 'var(--err)' }
                    : { justifyContent: 'center' }
                  }
                >
                  <TbX size={14} style={{ marginRight: 4 }} />
                  {selectedAsset.status === 'rejected' ? 'Rejected ✗' : 'Reject'}
                </Button>
                <a
                  href={`/api/v1/assets?id=${selectedAsset.id}`}
                  download={`${assetColorName(selectedAsset.path)}.png`}
                  style={{ textDecoration: 'none' }}
                >
                  <Button variant="ghost" style={{ width: '100%', justifyContent: 'center' }}>
                    <TbDownload size={14} style={{ marginRight: 4 }} /> Download
                  </Button>
                </a>
              </div>
              <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--bg2)', borderRadius: 6, fontSize: 10, color: 'var(--tx4)', fontFamily: 'monospace' }}>
                Asset ID: {selectedAsset.id}<br />
                Status: {selectedAsset.status}<br />
                Type: {selectedAsset.type}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
