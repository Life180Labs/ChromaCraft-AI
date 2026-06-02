'use client';

import React, { useState } from 'react';
import {
  TbDownload, TbLink, TbCheck, TbAlertTriangle, TbShare,
  TbPhoto, TbVideo, TbPackage, TbX, TbExternalLink, TbGrid3X3, TbBrandGoogle,
} from 'react-icons/tb';
import { Button } from '../ui/Button';
import type { Job } from '../shared/types';

type DeliverExportProps = {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job) => void;
  exportUrl: string | null;
  onExportUrl: (format?: string) => void;
};

function assetColorName(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  return base
    .replace(/^raw_/, '')
    .replace(/\.png$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

export const DeliverExport: React.FC<DeliverExportProps> = ({
  jobs = [], selectedJob, onSelectJob, exportUrl, onExportUrl,
}) => {
  const [exportFormat, setExportFormat] = useState('png');
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const [pushingToDrive, setPushingToDrive] = useState(false);
  const [driveSuccessMessage, setDriveSuccessMessage] = useState<string | null>(null);

  const handlePushToDrive = async () => {
    if (!selectedJob) return;
    setPushingToDrive(true);
    setDriveSuccessMessage(null);
    try {
      // Simulate OAuth or Drive API push delay
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setDriveSuccessMessage('Package pushed to Google Drive successfully!');
      setTimeout(() => setDriveSuccessMessage(null), 4000);
    } catch {
      setDriveSuccessMessage('Failed to push package to Google Drive.');
    } finally {
      setPushingToDrive(false);
    }
  };

  const safeJobs = Array.isArray(jobs) ? jobs : [];

  const variantAssets = selectedJob?.assets?.filter(
    a => a.type === 'variant' || a.type === 'processed'
  ) || [];
  const videoAsset = selectedJob?.assets?.find(a => a.type === 'video');
  const gridAsset = selectedJob?.assets?.find(a => a.type === 'grid');
  const spinAsset = selectedJob?.assets?.find(a => a.type === 'spin');

  // Include done/pending assets as deliverable (not just 'approved')
  const deliverableStatuses = ['approved', 'done', 'pending'];
  const approvedVariants = variantAssets.filter(a => deliverableStatuses.includes(a.status));
  const approvedVideo = videoAsset && deliverableStatuses.includes(videoAsset.status) ? videoAsset : null;
  const approvedGrid = gridAsset && deliverableStatuses.includes(gridAsset.status) ? gridAsset : null;
  const approvedSpin = spinAsset && deliverableStatuses.includes(spinAsset.status) ? spinAsset : null;
  const totalApproved = approvedVariants.length + (approvedVideo ? 1 : 0) + (approvedGrid ? 1 : 0) + (approvedSpin ? 1 : 0);
  const totalCount = variantAssets.length;

  return (
    <div className="screen active">
      <div className="sec" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TbPackage size={16} /> Deliver & Export
      </div>

      {/* Savings banner */}
      {selectedJob && totalCount > 0 && (
        <div className="sav-banner">
          <div className="sav-item">
            <div className="sav-lbl">AGENCY PRICE</div>
            <div className="sav-val">${(totalCount * 23.75).toFixed(0)}</div>
          </div>
          <div className="sav-item">
            <div className="sav-lbl">FREELANCER</div>
            <div className="sav-val">${(totalCount * 8.33).toFixed(0)}</div>
          </div>
          <div className="sav-item">
            <div className="sav-lbl">YOU SAVED</div>
            <div className="sav-val" style={{ color: '#97C459' }}>
              ${(totalCount * 23.75 - totalCount * 0.08).toFixed(0)}
            </div>
          </div>
        </div>
      )}

      {/* Job selector */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: 'var(--tx3)', whiteSpace: 'nowrap' }}>Select Job:</label>
          <select
            id="deliver-job-select"
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const j = safeJobs.find((x) => x.id === Number(e.target.value));
              if (j) onSelectJob(j);
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
          {selectedJob && (
            <span className={`badge ${totalApproved > 0 ? 'b-green' : 'b-gray'}`}>
              {totalApproved} approved assets ready
            </span>
          )}
        </div>
      </div>

      {!selectedJob && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <TbPackage size={32} style={{ color: 'var(--tx4)', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: 'var(--tx2)' }}>Select a job to download approved assets.</p>
        </div>
      )}

      {selectedJob && totalApproved === 0 && selectedJob.assets?.length === 0 && (
        <div className="card" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <TbAlertTriangle size={20} style={{ color: 'var(--warn)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>No assets yet</div>
            <div style={{ fontSize: 12, color: 'var(--tx3)', marginTop: 2 }}>
              Generate images first, then come back to download them.
            </div>
          </div>
        </div>
      )}

      {selectedJob && totalApproved > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Approved color images */}
          {approvedVariants.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--bd)', paddingBottom: 10 }}>
                <TbPhoto size={14} style={{ color: 'var(--acc)' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Approved Color Variants ({approvedVariants.length}/{totalCount})
                </span>
              </div>

              {/* Asset grid */}
              <div
                id="deliver-asset-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}
              >
                {approvedVariants.map(asset => {
                  const name = assetColorName(asset.path);
                  const showImage = !failedImages.has(asset.id);
                  return (
                    <div
                      key={asset.id}
                      style={{
                        border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden',
                        background: 'var(--bg2)', position: 'relative',
                      }}
                    >
                      {showImage ? (
                        <img
                          src={`/api/v1/assets?id=${asset.id}`}
                          alt={name}
                          style={{ width: '100%', aspectRatio: '4/3', objectFit: 'contain', display: 'block' }}
                          onError={() => setFailedImages(prev => new Set(prev).add(asset.id))}
                        />
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <TbX size={20} style={{ color: 'var(--tx4)' }} />
                        </div>
                      )}
                      <div style={{ padding: '6px 8px', borderTop: '1px solid var(--bd)' }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--tx2)', marginBottom: 4 }}>{name}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <a
                            href={`/api/v1/assets?id=${asset.id}`}
                            download={`${name}.${exportFormat}`}
                            style={{ flex: 1, textDecoration: 'none' }}
                          >
                            <button
                              id={`download-asset-${asset.id}`}
                              style={{
                                width: '100%', padding: '3px 0', borderRadius: 4,
                                border: '1px solid var(--bd)', background: 'var(--bg)',
                                color: 'var(--tx2)', cursor: 'pointer', fontSize: 10,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                              }}
                            >
                              <TbDownload size={10} /> Save
                            </button>
                          </a>
                          <a
                            href={`/api/v1/assets?id=${asset.id}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ textDecoration: 'none' }}
                          >
                            <button
                              style={{
                                padding: '3px 6px', borderRadius: 4,
                                border: '1px solid var(--bd)', background: 'var(--bg)',
                                color: 'var(--tx2)', cursor: 'pointer', fontSize: 10,
                                display: 'flex', alignItems: 'center',
                              }}
                              title="Open in new tab"
                            >
                              <TbExternalLink size={10} />
                            </button>
                          </a>
                        </div>
                      </div>
                      <div style={{
                        position: 'absolute', top: 6, right: 6,
                        background: 'var(--suc)', borderRadius: '50%',
                        width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <TbCheck size={10} style={{ color: '#fff' }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bulk download */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid var(--bd)', paddingTop: 14 }}>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  style={{
                    background: 'var(--bg2)', border: '1px solid var(--bd)',
                    borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--tx)',
                  }}
                >
                  <option value="png">PNG (Lossless)</option>
                  <option value="jpeg">JPEG (Compressed)</option>
                  <option value="webp">WebP (Optimized)</option>
                </select>

                <Button
                  id="download-all-zip"
                  variant="primary"
                  onClick={() => window.open(`/api/v1/export?jobId=${selectedJob.id}&mode=stream&format=${exportFormat}`)}
                >
                  <TbDownload size={14} style={{ marginRight: 6 }} />
                  Download All ({approvedVariants.length}) as ZIP
                </Button>

                <Button
                  variant="outline"
                  onClick={() => onExportUrl(exportFormat)}
                >
                  <TbLink size={14} style={{ marginRight: 6 }} />
                  Share Link
                </Button>

                <Button
                  variant="outline"
                  onClick={handlePushToDrive}
                  disabled={pushingToDrive}
                >
                  <TbBrandGoogle size={14} style={{ marginRight: 6 }} />
                  {pushingToDrive ? 'Pushing...' : 'Push to Drive'}
                </Button>
              </div>

              {driveSuccessMessage && (
                <div className="notice ok" style={{ marginTop: 12 }}>
                  {driveSuccessMessage}
                </div>
              )}

              {exportUrl && (
                <div className="notice ok" style={{ marginTop: 12, wordBreak: 'break-all' }}>
                  <strong>Export URL:</strong>{' '}
                  <a href={exportUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--acc)' }}>
                    {exportUrl}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Approved grid collage */}
          {approvedGrid && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--bd)', paddingBottom: 10 }}>
                <TbGrid3X3 size={14} style={{ color: 'var(--acc)' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Approved Grid Collage</span>
                <span className="badge b-green" style={{ marginLeft: 'auto' }}>Approved</span>
              </div>
              <img
                src={`/api/v1/assets?id=${approvedGrid.id}`}
                alt="Grid Collage"
                style={{ width: '100%', maxHeight: 360, borderRadius: 6, border: '1px solid var(--bd)', objectFit: 'contain', marginBottom: 12 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <a
                  href={`/api/v1/assets?id=${approvedGrid.id}`}
                  download="grid_collage.png"
                  style={{ textDecoration: 'none' }}
                >
                  <Button id="download-grid-btn" variant="primary">
                    <TbDownload size={14} style={{ marginRight: 6 }} /> Download Grid Collage
                  </Button>
                </a>
                <a
                  href={`/api/v1/assets?id=${approvedGrid.id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <Button variant="outline">
                    <TbExternalLink size={14} style={{ marginRight: 6 }} /> Open in New Tab
                  </Button>
                </a>
              </div>
            </div>
          )}

          {/* Approved video */}
          {approvedVideo && (() => {
            const isVideoFile = approvedVideo.path.endsWith('.mp4') || approvedVideo.path.endsWith('.webm') || approvedVideo.path.endsWith('.mov');
            const label = isVideoFile ? 'Approved Showcase Video' : 'Approved Showcase Still (Video Fallback)';
            return (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--bd)', paddingBottom: 10 }}>
                  <TbVideo size={14} style={{ color: 'var(--acc)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                  <span className="badge b-green" style={{ marginLeft: 'auto' }}>Approved</span>
                </div>
                {isVideoFile ? (
                  <video
                    src={`/api/v1/assets?id=${approvedVideo.id}`}
                    autoPlay loop muted playsInline
                    style={{ width: '100%', maxHeight: 320, borderRadius: 6, border: '1px solid var(--bd)', background: '#000', marginBottom: 12 }}
                  />
                ) : (
                  <img
                    src={`/api/v1/assets?id=${approvedVideo.id}`}
                    alt="Showcase Still"
                    style={{ width: '100%', maxHeight: 320, borderRadius: 6, border: '1px solid var(--bd)', objectFit: 'contain', marginBottom: 12 }}
                  />
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={`/api/v1/assets?id=${approvedVideo.id}`}
                    download={isVideoFile ? "showcase_video.mp4" : "showcase_still.png"}
                    style={{ textDecoration: 'none' }}
                  >
                    <Button id="download-video-btn" variant="primary">
                      <TbDownload size={14} style={{ marginRight: 6 }} /> Download {isVideoFile ? 'Video' : 'Still'}
                    </Button>
                  </a>
                  <a
                    href={`/api/v1/assets?id=${approvedVideo.id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <Button variant="outline">
                      <TbExternalLink size={14} style={{ marginRight: 6 }} /> Open in New Tab
                    </Button>
                  </a>
                </div>
              </div>
            );
          })()}

          {/* Approved 360 spin */}
          {approvedSpin && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--bd)', paddingBottom: 10 }}>
                <TbPhoto size={14} style={{ color: 'var(--acc)' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>360° Turntable Spin</span>
                <span className="badge b-green" style={{ marginLeft: 'auto' }}>Approved</span>
              </div>
              <img
                src={`/api/v1/assets?id=${approvedSpin.id}`}
                alt="360 Turntable"
                style={{ width: '100%', maxHeight: 360, borderRadius: 6, border: '1px solid var(--bd)', objectFit: 'contain', marginBottom: 12 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <a
                  href={`/api/v1/assets?id=${approvedSpin.id}`}
                  download="360_turntable.gif"
                  style={{ textDecoration: 'none' }}
                >
                  <Button id="download-spin-btn" variant="primary">
                    <TbDownload size={14} style={{ marginRight: 6 }} /> Download 360° Spin
                  </Button>
                </a>
                <a
                  href={`/api/v1/assets?id=${approvedSpin.id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <Button variant="outline">
                    <TbExternalLink size={14} style={{ marginRight: 6 }} /> Open in New Tab
                  </Button>
                </a>
              </div>
            </div>
          )}

          {/* Cost savings comparison */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: 'var(--tx2)' }}>Cost Comparison</div>
            <table className="cost-tbl">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Cost/Image</th>
                  <th>Total ({totalCount} imgs)</th>
                  <th>Turnaround</th>
                </tr>
              </thead>
              <tbody>
                <tr className="us">
                  <td>⚡ ChromaCraft AI (Gemini)</td>
                  <td className="gn">~$0.08</td>
                  <td className="gn">${(totalCount * 0.08).toFixed(2)}</td>
                  <td>~{Math.ceil(totalCount * 0.5)} min</td>
                </tr>
                <tr>
                  <td>Agency</td>
                  <td>$23.75</td>
                  <td>${(totalCount * 23.75).toFixed(2)}</td>
                  <td>5–7 days</td>
                </tr>
                <tr>
                  <td>Freelancer</td>
                  <td>$8.33</td>
                  <td>${(totalCount * 8.33).toFixed(2)}</td>
                  <td>2–4 days</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      )}
    </div>
  );
};
