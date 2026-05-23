'use client';

import React from 'react';
import { TbCheck, TbX } from 'react-icons/tb';
import { Button } from '../ui/Button';
import type { Job } from '../shared/types';

type ReviewQAProps = {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job) => void;
  onQAReview: (assetId: number, status: 'approved' | 'rejected') => void;
};

export const ReviewQA: React.FC<ReviewQAProps> = ({ jobs, selectedJob, onSelectJob, onQAReview }) => {
  const variants = selectedJob?.assets?.filter(a => a.type === 'variant') || [];

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

        {selectedJob && variants.length === 0 && (
          <p style={{ color: 'var(--tx3)', fontSize: 12 }}>No variants generated yet for this job.</p>
        )}

        {selectedJob && variants.length > 0 && (
          <div className="variant-grid-display" style={{ gridTemplateColumns: `repeat(${Math.min(variants.length, 4)}, 1fr)` }}>
            {variants.map((asset) => (
              <div key={asset.id} className={`variant-cell ${asset.status === 'approved' ? 'done' : asset.status === 'rejected' ? 'error' : 'pending'}`}>
                <div className="vc-body">
                  <div className="vc-car">🖼️</div>
                  <span className="vc-label">Variant #{asset.id}</span>
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
      </div>
    </div>
  );
};
