'use client';

import React from 'react';
import { TbHistory, TbRefresh, TbPackage } from 'react-icons/tb';
import { Button } from '../ui/Button';
import type { Job } from '../shared/types';

type JobHistoryProps = {
  jobs: Job[];
  onRefresh: () => void;
  onSelectJob: (job: Job) => void;
};

export const JobHistory: React.FC<JobHistoryProps> = ({ jobs, onRefresh, onSelectJob }) => {
  return (
    <div className="screen active">
      <div className="sec">Jobs History</div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button variant="ghost" onClick={onRefresh}><TbRefresh /> Refresh</Button>
        </div>
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--tx3)', fontSize: 12 }}>No jobs yet.</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="job-row" onClick={() => onSelectJob(job)}>
              <div className="job-ico"><TbHistory /></div>
              <div className="job-info">
                <div className="job-name">{job.name}</div>
                <div className="job-meta">ID: {job.id} · Created: {new Date(job.createdAt).toLocaleDateString()}</div>
              </div>
              <span className={`badge ${job.status === 'COMPLETED' ? 'b-green' : job.status === 'FAILED' ? 'b-red' : 'b-amber'}`}>
                {job.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
