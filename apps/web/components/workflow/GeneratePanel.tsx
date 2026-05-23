'use client';

import React from 'react';
import { Button } from '../ui/Button';
import type { Job, Provider } from '../shared/types';

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
};

export const GeneratePanel: React.FC<GeneratePanelProps> = ({
  jobs, selectedJob, onSelectJob, promptText, onPromptChange,
  providers, selectedProviderId, onSelectProvider, loading, onStartGeneration,
}) => {
  return (
    <div className="screen active">
      <div className="sec">Generate Image Variants</div>
      <div className="card">
        <div className="field">
          <label>Job Selected</label>
          <select
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const j = jobs.find((x) => x.id === Number(e.target.value));
              if (j) onSelectJob(j);
            }}
          >
            <option value="">-- Choose Job --</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Prompt Builder</label>
          <textarea
            className="prompt-editor-area"
            value={promptText}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="Describe details of the background scene, styling, and color options..."
          />
        </div>

        <div className="field">
          <label>AI Provider Selection</label>
          <select
            value={selectedProviderId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onSelectProvider(val ? Number(val) : null);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name} {p.default ? '(default)' : ''}</option>
            ))}
            <option value="">Mock AI Engine (Pillow rendering)</option>
          </select>
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <Button variant="primary" onClick={onStartGeneration} disabled={loading || !selectedJob}>
            {loading ? 'Processing...' : 'Start Generating'}
          </Button>
        </div>
      </div>
    </div>
  );
};
