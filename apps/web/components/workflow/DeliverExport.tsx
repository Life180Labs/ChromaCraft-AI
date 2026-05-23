'use client';

import React from 'react';
import { TbDownload, TbLink } from 'react-icons/tb';
import { Button } from '../ui/Button';
import type { Job } from '../shared/types';

type DeliverExportProps = {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job) => void;
  exportUrl: string | null;
  onExportUrl: () => void;
};

export const DeliverExport: React.FC<DeliverExportProps> = ({ jobs, selectedJob, onSelectJob, exportUrl, onExportUrl }) => {
  const completedJobs = jobs.filter(j => j.status === 'COMPLETED');

  return (
    <div className="screen active">
      <div className="sec">Deliver &amp; Export</div>
      <div className="card">
        <div className="field">
          <label>Select Completed Job</label>
          <select
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const j = jobs.find((x) => x.id === Number(e.target.value));
              if (j) onSelectJob(j);
            }}
          >
            <option value="">-- Choose Job --</option>
            {completedJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </div>

        {selectedJob && (
          <div className="btn-row" style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={() => window.open(`/api/v1/export?jobId=${selectedJob.id}&mode=stream`)}>
              <TbDownload /> Download ZIP Package
            </Button>
            <Button variant="outline" onClick={onExportUrl}>
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
};
