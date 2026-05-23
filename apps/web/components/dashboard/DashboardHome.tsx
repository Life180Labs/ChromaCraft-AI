'use client';

import React from 'react';
import { TbPlus, TbHistory, TbPackage, TbSparkles, TbArrowRight } from 'react-icons/tb';
import type { Job, TabId } from '../shared/types';

type DashboardHomeProps = {
  userName: string;
  jobs: Job[];
  onNavigate: (tab: TabId) => void;
  onSelectJob: (job: Job) => void;
};

export const DashboardHome: React.FC<DashboardHomeProps> = ({ userName, jobs, onNavigate, onSelectJob }) => {
  const completedCount = jobs.filter(j => j.status === 'COMPLETED').length;
  const totalAssets = jobs.reduce((acc, j) => acc + (j.assets?.length || 0), 0);

  return (
    <div className="screen active">
      {/* Greeting header — matches prototype home screen */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '20px', fontWeight: 500, color: 'var(--tx)' }}>
            Welcome back, {userName} 👋
          </div>
          <div style={{ fontSize: '12px', color: 'var(--tx3)', marginTop: '2px' }}>
            Life180 Labs · Free plan · <a style={{ color: 'var(--acc)', cursor: 'pointer' }}>Upgrade</a>
          </div>
        </div>
        <button className="btn primary" onClick={() => onNavigate('setup')}>
          <TbPlus /> New job
        </button>
      </div>

      {/* Stats grid — restored from prototype */}
      <div className="g3" style={{ marginBottom: '20px' }}>
        <div className="profile-stat">
          <div className="profile-stat-val">{jobs.length}</div>
          <div className="profile-stat-lbl">Jobs this month</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-val">{totalAssets}</div>
          <div className="profile-stat-lbl">Images generated</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-val" style={{ color: 'var(--suc)' }}>${completedCount * 165}</div>
          <div className="profile-stat-lbl">Saved vs agency</div>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="sec">Recent jobs</div>
      <div className="card">
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--tx3)', fontSize: 12 }}>No jobs yet. Click &quot;New job&quot; to start.</p>
        ) : (
          <>
            {jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="job-row" onClick={() => { onSelectJob(job); onNavigate('history'); }}>
                <div className="job-ico"><TbPackage /></div>
                <div className="job-info">
                  <div className="job-name">{job.name}</div>
                  <div className="job-meta">ID: {job.id} · Created: {new Date(job.createdAt).toLocaleDateString()}</div>
                </div>
                <span className={`badge ${job.status === 'COMPLETED' ? 'b-green' : job.status === 'FAILED' ? 'b-red' : 'b-amber'}`}>
                  {job.status}
                </span>
              </div>
            ))}
            <div className="divider" />
            <button className="btn ghost sm" onClick={() => onNavigate('history')}>
              View all jobs <TbArrowRight />
            </button>
          </>
        )}
      </div>

      {/* Quick start cards — restored from prototype */}
      <div className="sec">Quick start</div>
      <div className="g2">
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => onNavigate('setup')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 36, height: 36, background: 'var(--acc-bg)', borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TbSparkles style={{ color: 'var(--acc-tx)', fontSize: 18 }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--tx)' }}>New job</div>
              <div style={{ fontSize: 11, color: 'var(--tx3)' }}>Upload a product &amp; generate</div>
            </div>
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => onNavigate('history')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 36, height: 36, background: 'var(--bg3)', borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TbHistory style={{ color: 'var(--tx3)', fontSize: 18 }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--tx)' }}>Job history</div>
              <div style={{ fontSize: 11, color: 'var(--tx3)' }}>Re-run or download past work</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
