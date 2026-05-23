'use client';

import React from 'react';
import type { TabId } from '../shared/types';

type WorkflowTabsProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
};

const tabs: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Dashboard' },
  { id: 'setup', label: 'New Job' },
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review / QA' },
  { id: 'deliver', label: 'Deliver' },
  { id: 'history', label: 'Job History' },
];

export const WorkflowTabs: React.FC<WorkflowTabsProps> = ({ activeTab, onTabChange }) => {
  return (
    <div className="topbar" style={{ background: 'var(--bg2)', justifyContent: 'center' }}>
      <div className="nav-links" style={{ justifyContent: 'center' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
};
