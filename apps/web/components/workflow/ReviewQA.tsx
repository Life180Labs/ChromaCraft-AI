'use client';

import React from 'react';
import { TbCheck, TbX, TbArrowRight } from 'react-icons/tb';
import { Button } from '../ui/Button';
import type { Job } from '../shared/types';

type ReviewQAProps = {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job) => void;
  onQAReview: (assetId: number, status: 'approved' | 'rejected') => void;
  onNavigate?: (tab: string) => void;
};

function assetLabel(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  return base.replace(/\.png$/i, '');
}

export const ReviewQA: React.FC<ReviewQAProps> = ({ jobs, selectedJob, onSelectJob, onQAReview, onNavigate }) => {
  const qaAssets = selectedJob?.assets?.filter(a => a.type === 'processed') || [];
  const allApproved = qaAssets.length > 0 && qaAssets.every(a => a.status === 'approved');

  return (
    <div className="screen active">
      <div className="sec">Review &amp; QA</div>
      <div className="card">
        <div className="field">
          <label>Select Job to Review</label>
          <select
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const j = jobs.find((x) => x.id === Number(e.target.value));
              if (j) onSelectJob(j);
            }}
          >
            <option value="">-- Choose Job --</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name} ({j.status})</option>
            ))}
          </select>
        </div>

        {!selectedJob && <p style={{ color: 'var(--tx3)' }}>Please select a job first.</p>}

        {selectedJob && qaAssets.length === 0 && (
          <p style={{ color: 'var(--tx3)', fontSize: 12 }}>No processed catalog images ready for QA yet.</p>
        )}

        {selectedJob && qaAssets.length > 0 && (
          <div className="variant-grid-display" style={{ gridTemplateColumns: `repeat(${Math.min(qaAssets.length, 4)}, 1fr)` }}>
            {qaAssets.map((asset) => (
              <div key={asset.id} className={`variant-cell ${asset.status === 'approved' ? 'done' : asset.status === 'rejected' ? 'error' : 'pending'}`}>
                <div className="vc-body">
                  <div className="vc-car" style={{ height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px', overflow: 'hidden' }}>
                    <img 
                      src={`/api/v1/assets?id=${asset.id}`} 
                      alt={assetLabel(asset.path)} 
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} 
                    />
                  </div>
                  <span className="vc-label" style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{assetLabel(asset.path)}</span>
                  <span className="vc-status">{asset.status}</span>
                  <div className="btn-row" style={{ marginTop: 8 }}>
                    <Button variant="ghost" onClick={() => onQAReview(asset.id, 'approved')}>
                      <TbCheck style={{ color: 'var(--suc)' }} /> Approve
                    </Button>
                    <Button variant="ghost" onClick={() => onQAReview(asset.id, 'rejected')}>
                      <TbX style={{ color: 'var(--err)' }} /> Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Go to Delivery button (TC_REVIEW_005) */}
        {selectedJob && allApproved && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button variant="primary" onClick={() => onNavigate?.('deliver')}>
              Go to Delivery <TbArrowRight size={14} style={{ marginLeft: '4px' }} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
